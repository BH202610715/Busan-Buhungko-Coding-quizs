import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Home,
  Menu,
  Play,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { allQuestions, questionById, type Level, type QuizSession } from "@/lib/quiz-session";

type SessionUpdater = (update: (current: QuizSession) => QuizSession) => void;
type Props = { session: QuizSession; onUpdate: SessionUpdater; onHome: () => void };
type RunResult = { output: string; error: string | null };
type RunStatus = "idle" | "loading" | "running";
type WorkerMessage =
  | { id: string; type: "status"; status: "loading" | "running" }
  | { id: string; type: "result"; output: string; error: string | null };

function levelClass(level: Level) {
  return `level-${level === "상" ? "high" : level === "중" ? "mid" : "low"}`;
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function QuizSession({ session, onUpdate, onHome }: Props) {
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runMessage, setRunMessage] = useState("");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const nextRunIdRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);

  const questionId = session.questionIds[session.currentIndex] ?? session.questionIds[0];
  const question = questionById.get(questionId) ?? allQuestions[0];
  const draft = session.drafts[question.id] ?? "";
  const lineCount = Math.max(1, draft.split("\n").length);
  const completed = useMemo(() => new Set(session.completedIds), [session.completedIds]);
  const revealed = useMemo(() => new Set(session.revealedIds), [session.revealedIds]);
  const isRevealed = revealed.has(question.id);
  const allDone = session.questionIds.every((id) => completed.has(id));
  const visibleQuestions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return session.questionIds
      .map((id) => questionById.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => !query || `${item.id} ${item.topic} ${item.prompt}`.toLocaleLowerCase().includes(query));
  }, [search, session.questionIds]);
  const elapsed = formatDuration(((session.finishedAt ?? now) - session.startedAt));

  useEffect(() => {
    if (session.mode !== "test" || session.finishedAt !== null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session.mode, session.finishedAt]);

  useEffect(() => {
    setShowHint(false);
    setRunResult(null);
    setRunStatus("idle");
    setRunMessage("");
  }, [question.id]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    workerRef.current?.terminate();
  }, []);

  const stopWorker = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    readyRef.current = false;
  };

  const updateDraft = (value: string) => {
    setRunResult(null);
    onUpdate((current) => ({ ...current, drafts: { ...current.drafts, [question.id]: value } }));
  };

  const moveTo = (index: number) => {
    const safeIndex = Math.min(Math.max(index, 0), session.questionIds.length - 1);
    onUpdate((current) => ({ ...current, currentIndex: safeIndex }));
    setMobileNavOpen(false);
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const editor = event.currentTarget;
    if (event.key === "Tab") {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const nextValue = `${draft.slice(0, start)}    ${draft.slice(end)}`;
      updateDraft(nextValue);
      requestAnimationFrame(() => { editor.selectionStart = editor.selectionEnd = start + 4; });
      return;
    }
    if (event.key === "Enter") {
      const lineStart = draft.lastIndexOf("\n", editor.selectionStart - 1) + 1;
      const indent = draft.slice(lineStart, editor.selectionStart).match(/^\s*/)?.[0] ?? "";
      if (indent) {
        event.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const insertion = `\n${indent}`;
        updateDraft(`${draft.slice(0, start)}${insertion}${draft.slice(end)}`);
        requestAnimationFrame(() => { editor.selectionStart = editor.selectionEnd = start + insertion.length; });
      }
    }
  };

  const runCode = () => {
    if (!draft.trim()) {
      toast.error("먼저 실행할 코드를 작성해 주세요.");
      editorRef.current?.focus();
      return;
    }

    let worker = workerRef.current;
    if (!worker) {
      try {
        worker = new Worker(new URL("../python-runner.worker.ts", import.meta.url), { type: "module" });
        workerRef.current = worker;
      } catch (error) {
        setRunResult({ output: "", error: error instanceof Error ? error.message : "실행기를 시작할 수 없어요." });
        return;
      }
    }

    const id = String(++nextRunIdRef.current);
    setRunResult(null);
    setRunStatus("loading");
    setRunMessage("브라우저 안에서 Python 실행기를 준비하고 있어요. 첫 실행은 조금 걸릴 수 있어요.");
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);

    const setTimeoutGuard = (milliseconds: number) => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        stopWorker();
        setRunStatus("idle");
        setRunMessage("");
        setRunResult({ output: "", error: "실행 시간이 길어 중단했어요. 짧은 코드로 다시 시도해 주세요." });
      }, milliseconds);
    };

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "status") {
        if (message.status === "loading") {
          setRunStatus("loading");
          setRunMessage("Python 실행기를 불러오는 중이에요.");
        } else {
          readyRef.current = true;
          setRunStatus("running");
          setRunMessage("코드를 실행하고 있어요.");
          setTimeoutGuard(5000);
        }
        return;
      }
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setRunStatus("idle");
      setRunMessage("");
      setRunResult({ output: message.output, error: message.error });
    };

    worker.onerror = (event) => {
      event.preventDefault();
      stopWorker();
      setRunStatus("idle");
      setRunMessage("");
      setRunResult({ output: "", error: "실행기를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요." });
    };

    setTimeoutGuard(readyRef.current ? 5000 : 90000);
    worker.postMessage({ id, code: draft });
  };

  const revealAnswer = () => {
    const completedIds = new Set(session.completedIds);
    const revealedIds = new Set(session.revealedIds);
    completedIds.add(question.id);
    revealedIds.add(question.id);
    const nextCompleted = [...completedIds];
    const everyQuestionDone = session.questionIds.every((id) => completedIds.has(id));
    const finishedAt = everyQuestionDone ? session.finishedAt ?? Date.now() : session.finishedAt;
    onUpdate((current) => ({ ...current, completedIds: nextCompleted, revealedIds: [...revealedIds], finishedAt }));
    toast.success("참고 답을 열었어요. 직접 작성한 코드와 비교해 보세요.");
  };

  const copySolution = async () => {
    try {
      await navigator.clipboard.writeText(question.solution);
      toast.success("참고 풀이를 복사했어요.");
    } catch {
      toast.error("복사할 수 없어요. 코드를 직접 선택해 복사해 주세요.");
    }
  };

  const finishSession = () => {
    onUpdate((current) => ({ ...current, finishedAt: current.finishedAt ?? Date.now(), showSummary: true }));
    setConfirmFinish(false);
  };

  const showSummary = () => onUpdate((current) => ({ ...current, showSummary: true, finishedAt: current.finishedAt ?? Date.now() }));

  const modeLabel = session.mode === "test" ? "테스트" : "연습";
  const progressPercent = Math.round((completed.size / session.questionIds.length) * 100);

  if (session.showSummary) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><Code2 size={21} strokeWidth={2.4} /></div><div className="brand-text"><span className="brand-overline">PYTHON / PRACTICE</span><strong>코드연습장</strong></div></div>
          <button className="button button-outline" type="button" onClick={onHome}><Home size={15} /> 메인 화면</button>
        </header>
        <main className="summary-main">
          <div className="summary-card">
            <span className="eyebrow">ROUND {String(session.round).padStart(2, "0")} · {modeLabel.toUpperCase()}</span>
            <div className="summary-mark"><Check size={30} /></div>
            <h1>{allDone ? "선택한 문제를 모두 마쳤어요." : `${modeLabel}를 종료했어요.`}</h1>
            <p>자동 채점은 하지 않아요. 각 문제에서 공개한 참고 답과 직접 작성한 코드를 비교해 보세요.</p>
            <div className="summary-stats">
              <div><span>완료 문항</span><strong>{completed.size}<i> / {session.questionIds.length}</i></strong></div>
              {session.mode === "test" && <div><span>테스트 시간</span><strong className="summary-time">{elapsed}</strong></div>}
              <div><span>난이도</span><strong>{session.difficulty}</strong></div>
            </div>
            <div className="summary-actions">
              <button className="button button-primary" type="button" onClick={onHome}><Home size={15} /> 메인 화면으로</button>
              <button className="button button-outline" type="button" onClick={() => onUpdate((current) => ({ ...current, showSummary: false, currentIndex: Math.max(0, current.currentIndex) }))}>문제 다시 보기 <ArrowRight size={15} /></button>
            </div>
          </div>
        </main>
        <footer className="site-footer"><span>PYTHON PRACTICE / 300</span><span>직접 작성한 코드는 이 기기에 저장됩니다.</span></footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><Code2 size={21} strokeWidth={2.4} /></div><div className="brand-text"><span className="brand-overline">PYTHON / PRACTICE</span><strong>코드연습장</strong></div></div>
        <div className="session-top-meta">
          <span className={`mode-badge ${session.mode === "test" ? "mode-test" : "mode-practice"}`}>{session.mode === "test" ? "TEST MODE" : "PRACTICE MODE"}</span>
          <span className="session-count-label">{completed.size} / {session.questionIds.length} 완료</span>
        </div>
        <div className="topbar-actions">
          {session.mode === "test" && <div className={`timer-pill ${session.finishedAt !== null ? "timer-stopped" : ""}`} aria-label={`경과 시간 ${elapsed}`}><Clock3 size={15} /><strong>{elapsed}</strong></div>}
          {session.mode === "test" && <button className="button button-outline end-test-button" type="button" onClick={() => setConfirmFinish(true)}>테스트 종료</button>}
          <button className="button button-outline home-button" type="button" onClick={onHome}><Home size={15} /> 메인</button>
          <button className="icon-button mobile-menu-button" type="button" aria-label="문제 목록 열기" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
        </div>
      </header>

      <main className="workspace">
        <aside className={`question-sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
          <div className="sidebar-heading">
            <div><span className="eyebrow">ROUND {String(session.round).padStart(2, "0")}</span><h2>{modeLabel} 문제 <span>{session.questionIds.length}</span></h2></div>
            <button className="icon-button close-sidebar-button" type="button" aria-label="문제 목록 닫기" onClick={() => setMobileNavOpen(false)}><X size={18} /></button>
          </div>
          <div className="sidebar-progress">
            <div className="progress-copy"><span>진행 상황</span><strong>{completed.size}<i> / {session.questionIds.length}</i></strong></div>
            <div className="progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
          </div>
          <label className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="번호, 주제, 문제 검색" aria-label="문제 검색" />{search && <button type="button" aria-label="검색어 지우기" onClick={() => setSearch("")}><X size={14} /></button>}</label>
          <div className="filter-row"><span>{session.difficulty} 난이도</span><span>{session.questionIds.length}문항</span></div>
          <nav className="question-list" aria-label="회차 문제 선택">
            {visibleQuestions.map((item) => {
              const index = session.questionIds.indexOf(item.id);
              return <button key={item.id} type="button" className={`question-list-item ${item.id === question.id ? "active" : ""}`} onClick={() => moveTo(index)}>
                <span className="list-status">{completed.has(item.id) ? <Check size={13} /> : <span />}</span>
                <span className="list-item-main"><span className="list-item-top"><strong>{item.id}</strong><i className={`mini-level ${levelClass(item.level)}`}>{item.level}</i></span><small>{item.topic}</small></span>
                {item.id === question.id && <ChevronRight className="active-chevron" size={14} />}
              </button>;
            })}
            {visibleQuestions.length === 0 && <div className="empty-list">검색 결과가 없어요.</div>}
          </nav>
          <div className="sidebar-foot"><span className="keycap">Py</span> 작성 코드는 자동 저장돼요</div>
        </aside>
        {mobileNavOpen && <button className="sidebar-backdrop" type="button" aria-label="목록 닫기" onClick={() => setMobileNavOpen(false)} />}

        <section className="practice-area">
          <div className="page-intro session-intro">
            <div><span className="eyebrow">{session.mode === "test" ? `TEST · ${elapsed}` : "WRITE · PRACTICE · LEARN"}</span><h1>{session.mode === "test" ? "한 문제씩 풀고, 답을 확인하세요." : "코드를 실행하고 풀이를 비교하세요."}</h1><p>{session.mode === "test" ? "문제를 마칠 때마다 참고 답이 공개됩니다." : "작성한 코드는 브라우저 안에서 실행됩니다."}</p></div>
            <div className="intro-mark" aria-hidden="true"><span>{String(session.currentIndex + 1).padStart(2, "0")}</span><span>→</span><span>{String(session.questionIds.length).padStart(2, "0")}</span></div>
          </div>

          <div className="practice-grid">
            <article className="question-panel">
              <div className="question-panel-top"><div className="question-ident"><span className="question-number">{question.id}</span><span className={`difficulty-badge ${levelClass(question.level)}`}>{question.level}</span></div><div className="question-counter">{String(session.currentIndex + 1).padStart(3, "0")} <span>/ {session.questionIds.length}</span></div></div>
              <div className="question-topic"><span className="topic-dot" />{question.topic}</div>
              <h2 className="question-prompt">{question.prompt}</h2>
              {session.mode === "practice" && !isRevealed && <div className="question-tools"><button className={`text-tool ${showHint ? "is-open" : ""}`} type="button" onClick={() => setShowHint((value) => !value)}><CircleHelp size={15} /> {showHint ? "힌트 닫기" : "힌트 보기"}<ChevronDown size={13} className={showHint ? "rotate" : ""} /></button></div>}
              {showHint && session.mode === "practice" && <div className="hint-panel"><BookOpen size={15} /><p>{question.hint}</p></div>}
              {isRevealed && <div className="solution-panel answer-panel"><div className="solution-heading"><span>ANSWER · REFERENCE SOLUTION</span><button type="button" onClick={copySolution}><Copy size={14} /> 복사</button></div><pre><code>{question.solution}</code></pre><p>직접 작성한 코드와 결과를 비교해 보세요. 다른 올바른 풀이도 있을 수 있어요.</p></div>}
            </article>

            <section className="editor-panel" aria-label="Python 코드 편집기">
              <div className="editor-toolbar"><div className="file-tab"><span className="python-dot">Py</span><span>solution.py</span><i /></div><span className="editor-language">Python 3</span></div>
              <div className="editor-body"><div className="line-gutter" ref={gutterRef} aria-hidden="true">{Array.from({ length: lineCount }, (_, index) => <span key={index}>{String(index + 1).padStart(2, "0")}</span>)}</div><textarea ref={editorRef} className="code-editor" value={draft} onChange={(event) => updateDraft(event.target.value)} onKeyDown={handleEditorKeyDown} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" aria-label={`${question.id} Python 코드 입력`} placeholder={'# 코드를 여기에 작성하세요\n'} /></div>
              <div className="editor-footer"><span><span className="saved-dot" /> 자동 저장</span><span>Tab 들여쓰기 <b>·</b> {lineCount}줄</span></div>
              <div className="runner-toolbar"><button className="button button-primary run-button" type="button" onClick={runCode} disabled={runStatus !== "idle"}><Play size={15} fill="currentColor" />{runStatus === "idle" ? "코드 실행" : runStatus === "loading" ? "실행기 준비 중" : "실행 중"}</button><span><ShieldCheck size={13} /> 브라우저 안에서 실행 · 코드 전송 없음</span></div>
              {(runStatus !== "idle" || runResult) && <div className={`execution-result ${runResult?.error ? "execution-error" : ""}`} aria-live="polite"><div className="execution-title"><span>{runResult?.error ? "실행 오류" : "실행 결과"}</span>{runStatus !== "idle" && <i className="execution-spinner" />}</div>{runStatus !== "idle" && <p className="execution-message">{runMessage}</p>}{runResult && <><pre>{runResult.output || (runResult.error ? "" : "출력이 없어요. print()로 결과를 표시해 보세요.")}</pre>{runResult.error && <p className="execution-error-text">{runResult.error}</p>}</>}</div>}
              <p className="runner-note">현재 Coding 학습 범위의 기초 문법만 실행할 수 있어요. import, 반복문, 함수 정의는 제한됩니다.</p>
            </section>
          </div>

          <div className="bottom-controls session-controls">
            <div className="nav-controls"><button className="button button-outline" type="button" onClick={() => moveTo(session.currentIndex - 1)} disabled={session.currentIndex === 0}><ArrowLeft size={16} /> 이전</button><button className="button button-outline" type="button" onClick={() => moveTo(session.currentIndex + 1)} disabled={session.currentIndex >= session.questionIds.length - 1}><ArrowRight size={16} /> 다음 문제</button></div>
            <div className="answer-controls">
              {!isRevealed && <button className="button button-primary reveal-button" type="button" onClick={revealAnswer}><Check size={16} /> 제출하고 정답 보기</button>}
              {isRevealed && allDone && <button className="button button-primary" type="button" onClick={showSummary}>결과 확인 <ArrowRight size={16} /></button>}
              {isRevealed && !allDone && <span className="answer-open-note"><Check size={14} /> 답을 확인했어요</span>}
            </div>
          </div>
          {session.mode === "test" && <button className="button button-outline mobile-end-test" type="button" onClick={() => setConfirmFinish(true)}>테스트 종료</button>}
          <div className="practice-footnote"><ShieldCheck size={14} /> 코드는 이 기기의 브라우저에서만 실행돼요. 실행 결과를 확인한 뒤 제출하면 참고 답이 공개됩니다.</div>
        </section>
      </main>

      {confirmFinish && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="finish-title"><button className="icon-button modal-close" type="button" aria-label="닫기" onClick={() => setConfirmFinish(false)}><X size={17} /></button><span className="eyebrow">TEST SESSION</span><h2 id="finish-title">테스트를 지금 끝낼까요?</h2><p>완료하지 않은 문제는 미완료로 남고, 타이머가 멈춥니다. 완료한 문제의 참고 답은 다시 볼 수 있어요.</p><div className="modal-actions"><button className="button button-outline" type="button" onClick={() => setConfirmFinish(false)}>계속 풀기</button><button className="button button-primary" type="button" onClick={finishSession}>테스트 종료</button></div></section></div>}
      <footer className="site-footer"><span>PYTHON PRACTICE / 300</span><span>작성한 코드는 이 기기에 자동 저장됩니다.</span></footer>
    </div>
  );
}
