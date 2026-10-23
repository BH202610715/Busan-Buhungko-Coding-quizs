import questionData from "@/data/questions.json";

export type Level = "상" | "중" | "하";
export type Difficulty = "전체" | Level;
export type SessionMode = "practice" | "test";

export type Question = {
  id: string;
  level: Level;
  topic: string;
  prompt: string;
  hint: string;
  solution: string;
};

export type QuizSession = {
  version: 2;
  round: number;
  mode: SessionMode;
  difficulty: Difficulty;
  questionIds: string[];
  currentIndex: number;
  completedIds: string[];
  revealedIds: string[];
  drafts: Record<string, string>;
  startedAt: number;
  finishedAt: number | null;
  showSummary: boolean;
};

export const SESSION_STORAGE_KEY = "pycode.session.v2";
export const LEGACY_STORAGE_KEY = "pycode.practice.v1";
export const allQuestions = questionData as Question[];
export const questionById = new Map(allQuestions.map((question) => [question.id, question]));

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanDrafts(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id, code]) => questionById.has(id) && typeof code === "string")
      .map(([id, code]) => [id, (code as string).slice(0, 12_000)]),
  );
}

export function readLegacyPractice(): { drafts: Record<string, string>; round: number } {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { drafts: {}, round: 0 };
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved)) return { drafts: {}, round: 0 };
    return {
      drafts: cleanDrafts(saved.drafts),
      round: typeof saved.round === "number" && Number.isFinite(saved.round) ? saved.round : 0,
    };
  } catch {
    return { drafts: {}, round: 0 };
  }
}

export function readSavedSession(): QuizSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 2) return null;
    if (value.mode !== "practice" && value.mode !== "test") return null;
    if (!(value.difficulty === "전체" || value.difficulty === "상" || value.difficulty === "중" || value.difficulty === "하")) return null;
    if (!Array.isArray(value.questionIds) || value.questionIds.length < 1) return null;
    const questionIds = value.questionIds.filter((id): id is string => typeof id === "string" && questionById.has(id));
    if (questionIds.length !== value.questionIds.length || new Set(questionIds).size !== questionIds.length) return null;
    if (typeof value.currentIndex !== "number" || !Number.isInteger(value.currentIndex)) return null;
    if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) return null;
    if (value.finishedAt !== null && (typeof value.finishedAt !== "number" || !Number.isFinite(value.finishedAt))) return null;
    const currentIndex = Math.min(Math.max(value.currentIndex, 0), questionIds.length - 1);
    const withinSession = (items: unknown) => Array.isArray(items)
      ? [...new Set(items.filter((id): id is string => typeof id === "string" && questionIds.includes(id)))]
      : [];
    return {
      version: 2,
      round: typeof value.round === "number" && Number.isFinite(value.round) ? value.round : 1,
      mode: value.mode,
      difficulty: value.difficulty,
      questionIds,
      currentIndex,
      completedIds: withinSession(value.completedIds),
      revealedIds: withinSession(value.revealedIds),
      drafts: cleanDrafts(value.drafts),
      startedAt: value.startedAt,
      finishedAt: value.finishedAt as number | null,
      showSummary: value.showSummary === true,
    };
  } catch {
    return null;
  }
}

export function createQuizSession(options: {
  mode: SessionMode;
  difficulty: Difficulty;
  count: number;
  round: number;
  drafts?: Record<string, string>;
}): QuizSession {
  const pool = allQuestions.filter((question) => options.difficulty === "전체" || question.level === options.difficulty);
  const questionIds = shuffled(pool).slice(0, Math.min(options.count, pool.length)).map((question) => question.id);
  return {
    version: 2,
    round: options.round,
    mode: options.mode,
    difficulty: options.difficulty,
    questionIds,
    currentIndex: 0,
    completedIds: [],
    revealedIds: [],
    drafts: options.drafts ?? {},
    startedAt: Date.now(),
    finishedAt: null,
    showSummary: false,
  };
}
