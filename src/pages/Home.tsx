import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  Code2,
  Layers3,
  Play,
  RotateCcw,
  Target,
  X,
} from "lucide-react";
import QuizSession from "@/pages/QuizSession";
import {
  allQuestions,
  createQuizSession,
  readLegacyPractice,
  readSavedSession,
  SESSION_STORAGE_KEY,
  type Difficulty,
  type Level,
  type QuizSession as QuizSessionState,
  type SessionMode,
} from "@/lib/quiz-session";

const difficultyOptions: Difficulty[] = ["전체", "하", "중", "상"];
const allCountOptions = [5, 10, 20, 50, 100, 300];
const levelCountOptions = [5, 10, 20, 50, 100];

function modeLabel(mode: SessionMode) {
  return mode === "test" ? "테스트" : "연습";
}

export default function Home() {
  const [session, setSession] = useState<QuizSessionState | null>(readSavedSession);
  const [isInSession, setIsInSession] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("전체");
  const [questionCount, setQuestionCount] = useState(10);
  const [pendingMode, setPendingMode] = useState<SessionMode | null>(null);

  const poolSize = useMemo(
    () => allQuestions.filter((question) => difficulty === "전체" || question.level === difficulty).length,
    [difficulty],
  );
  const countOptions = difficulty === "전체" ? allCountOptions : levelCountOptions;

  useEffect(() => {
    if (!session) return;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Keep the current session usable if local storage is unavailable.
    }
  }, [session]);

  const startSession = (mode: SessionMode) => {
    if (session && session.finishedAt === null) {
      setPendingMode(mode);
      return;
    }
    beginSession(mode);
  };

  const beginSession = (mode: SessionMode) => {
    const legacy = readLegacyPractice();
    const drafts = { ...legacy.drafts, ...(session?.drafts ?? {}) };
    const round = Math.max(session?.round ?? 0, legacy.round) + 1;
    const nextSession = createQuizSession({ mode, difficulty, count: questionCount, round, drafts });
    setSession(nextSession);
    setPendingMode(null);
    setIsInSession(true);
  };

  const updateSession = (update: (current: QuizSessionState) => QuizSessionState) => {
    setSession((current) => current ? update(current) : current);
  };

  const resumeSession = () => setIsInSession(true);

  const selectedCount = session?.questionIds.length ?? 0;
  const completedCount = session?.completedIds.length ?? 0;

  if (isInSession && session) {
    return <QuizSession session={session} onUpdate={updateSession} onHome={() => setIsInSession(false)} />;
  }

  return (
    <div className="app-shell landing-shell">
      <header className="topbar landing-topbar">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><Code2 size={21} strokeWidth={2.4} /></div><div className="brand-text"><span className="brand-overline">PYTHON / PRACTICE</span><strong>코드연습장</strong></div></div>
        <div className="topbar-meta"><span className="live-dot" /> 학습 기록은 이 기기에 저장됩니다</div>
        <div className="topbar-actions"><span className="bank-count"><Layers3 size={14} /> 300문항</span></div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-copy"><span className="eyebrow">PYTHON · 300 QUESTIONS</span><h1>연습은 차근차근,<br /><em>테스트는 실전처럼.</em></h1><p>난이도와 문제 수를 고르고, 직접 작성한 코드를 실행해 보세요.</p></div>
          <div className="hero-index" aria-hidden="true"><span className="hero-index-label">LEARN BY WRITING</span><strong>300</strong><span>새로운 코딩 문제</span><div className="hero-index-line" /></div>
        </section>

        <section className="session-setup" aria-labelledby="setup-title">
          <div className="setup-heading"><div><span className="eyebrow">START A SESSION</span><h2 id="setup-title">이번 회차를 설정하세요.</h2><p>선택한 조건에 맞춰 문제가 무작위로 배치돼요.</p></div><div className="setup-step">01 <span>/</span> 03</div></div>

          <div className="setting-block">
            <div className="setting-label"><span className="setting-number">01</span><div><strong>난이도</strong><small>원하는 단계 또는 전체를 고르세요.</small></div><span className="setting-meta">{poolSize}문항 선택 가능</span></div>
            <div className="choice-row difficulty-choices" role="group" aria-label="난이도 선택">
              {difficultyOptions.map((option) => <button key={option} type="button" className={`choice-chip ${difficulty === option ? "is-selected" : ""} ${option !== "전체" ? `chip-${option === "상" ? "high" : option === "중" ? "mid" : "low"}` : ""}`} aria-pressed={difficulty === option} onClick={() => { setDifficulty(option); setQuestionCount((current) => Math.min(current, option === "전체" ? 300 : 100)); }}><span>{option}</span>{option !== "전체" && <small>{allQuestions.filter((question) => question.level === option).length}</small>}</button>)}
            </div>
          </div>

          <div className="setting-block count-setting">
            <div className="setting-label"><span className="setting-number">02</span><div><strong>문제 수</strong><small>한 회차에서 풀 문항 수를 정하세요.</small></div><span className="setting-meta">중복 없이 무작위</span></div>
            <div className="choice-row count-choices" role="group" aria-label="문제 수 선택">
              {countOptions.map((count) => <button key={count} type="button" className={`choice-chip count-chip ${questionCount === count ? "is-selected" : ""}`} aria-pressed={questionCount === count} onClick={() => setQuestionCount(count)}>{count}<small>문제</small></button>)}
            </div>
          </div>

          <div className="mode-divider"><span className="setting-number">03</span><div><strong>모드를 선택하세요.</strong><small>각 모드는 별도 버튼으로 시작합니다.</small></div></div>
          <div className="mode-grid">
            <article className="mode-card practice-mode-card">
              <div className="mode-card-icon"><BookOpen size={19} /></div><span className="mode-kicker">PRACTICE MODE</span><h3>연습하기</h3><p>힌트를 보고 코드를 실행해 보세요. 문제를 마치면 참고 답이 열립니다.</p><button className="button button-primary mode-start-button" type="button" onClick={() => startSession("practice")}><Play size={15} fill="currentColor" /> 연습 시작 <ArrowRight size={15} /></button>
            </article>
            <article className="mode-card test-mode-card">
              <div className="mode-card-icon"><Target size={19} /></div><span className="mode-kicker">TEST MODE</span><h3>테스트하기</h3><p>테스트 타이머를 켜고 문제를 풀어요. 한 문제를 마칠 때마다 답을 확인할 수 있어요.</p><button className="button button-primary mode-start-button" type="button" onClick={() => startSession("test")}><Clock3 size={15} /> 테스트 시작 <ArrowRight size={15} /></button>
            </article>
          </div>
          <div className="setup-footnote"><Check size={14} /><span>작성한 코드는 자동 저장되고, 실행 결과는 화면에서 바로 확인할 수 있어요.</span></div>
        </section>

        {session && <section className="resume-card" aria-label="저장된 회차">
          <div className="resume-icon"><RotateCcw size={17} /></div><div className="resume-copy"><span className="eyebrow">SAVED SESSION · ROUND {String(session.round).padStart(2, "0")}</span><strong>{session.finishedAt === null ? `${modeLabel(session.mode)} 진행 중` : session.showSummary ? `${modeLabel(session.mode)} 결과 저장됨` : `${modeLabel(session.mode)} 완료`}</strong><small>{session.difficulty} 난이도 · {selectedCount}문제 · {completedCount}문제 완료</small></div><button className="button button-outline resume-button" type="button" onClick={resumeSession}>{session.finishedAt === null ? "이어서 하기" : session.showSummary ? "결과 다시 보기" : "마지막 문제 보기"}<ArrowRight size={15} /></button>
        </section>}

        <div className="landing-footer-note"><span>SMALL STEPS, REAL SKILLS</span><span>정답보다 먼저, 직접 작성한 코드의 결과를 확인해 보세요.</span></div>
      </main>

      <footer className="site-footer"><span>PYTHON PRACTICE / 300</span><span>작은 코드가 쌓여 실력이 됩니다.</span></footer>

      {pendingMode && <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="new-session-title"><button className="icon-button modal-close" type="button" aria-label="닫기" onClick={() => setPendingMode(null)}><X size={17} /></button><span className="eyebrow">SAVED SESSION</span><h2 id="new-session-title">진행 중인 회차가 있어요.</h2><p>새 {modeLabel(pendingMode)}를 시작하면 현재 회차의 완료 상태는 새 회차로 바뀝니다. 작성 코드는 저장된 채로 유지돼요.</p><div className="modal-actions"><button className="button button-outline" type="button" onClick={() => { setPendingMode(null); resumeSession(); }}>이어서 풀기</button><button className="button button-primary" type="button" onClick={() => beginSession(pendingMode)}>{modeLabel(pendingMode)} 새로 시작</button></div></section></div>}
    </div>
  );
}
