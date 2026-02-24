// === Data Model Types ===

export type Priority = "critical" | "high" | "normal" | "low";
export type QuestionStatus = "pending" | "answered" | "expired" | "dismissed" | "denied";
export type SessionStatus = "connected" | "idle";

export interface QuestionChoice {
  label: string;
  description?: string;
  markdown?: string;
  multiSelect?: boolean;
}

export interface Question {
  id: string;
  sessionId: string;
  text: string;
  header?: string;
  choices?: QuestionChoice[];
  multiSelect: boolean;
  allowOther: boolean;
  instant: boolean;
  context?: string;
  priority: Priority;
  status: QuestionStatus;
  created_at: number;
  answered_at?: number;
  answer?: QuestionAnswer;
  dismiss_reason?: string;
}

export interface ChoiceDetail {
  confidence?: number;
  note?: string;
}

export interface QuestionAnswer {
  selectedIndices: number[];
  choiceDetails: Record<number, ChoiceDetail>;
  otherText?: string;
  freeformText?: string;
}

export interface Session {
  id: string;
  name: string;
  cwd: string;
  connectedAt: number;
  status: SessionStatus;
}

// === IPC Protocol Types ===

// MCP Server -> Tauri (pipe server)
export interface IpcNewQuestion {
  type: "new_question";
  question: Question;
  sessionName: string;
  sessionCwd: string;
}

export interface IpcNewQuestionsBatch {
  type: "new_questions_batch";
  questions: Question[];
  sessionName: string;
  sessionCwd: string;
}

export interface IpcDismissQuestions {
  type: "dismiss_questions";
  questionIds: string[];
  reason?: string;
}

export type IpcClientMessage = IpcNewQuestion | IpcNewQuestionsBatch | IpcDismissQuestions;

// Tauri (pipe server) -> MCP Server
export interface IpcAnswer {
  type: "answer";
  questionId: string;
  answer: QuestionAnswer;
}

export interface IpcDenied {
  type: "denied";
  questionIds: string[];
  reason: string;
}

export type IpcServerMessage = IpcAnswer | IpcDenied;

// === Config Types ===

export interface AsQuConfig {
  pipe: {
    name: string;
  };
  ui: {
    theme: "dark" | "light";
    autoFocus: boolean;
    autoHide: boolean;
  };
  tauriPath: string;
}

// === MCP Tool Result Types ===

export interface AskResult {
  ids: string[];
  pending: number;
}

export interface AnswerInfo {
  id: string;
  text: string;
  answer: QuestionAnswer;
}

export interface DeniedInfo {
  id: string;
  text: string;
  reason: string;
}

export interface GetAnswersResult {
  answered: AnswerInfo[];
  denied: DeniedInfo[];
  pending: string[];
  timed_out: boolean;
}

export interface QuestionInfo {
  id: string;
  text: string;
  header?: string;
  priority: Priority;
  status: QuestionStatus;
  created_at: number;
  answered_at?: number;
}

export interface ListQuestionsResult {
  questions: QuestionInfo[];
  total: number;
}
