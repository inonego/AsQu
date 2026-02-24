import { EventEmitter } from "node:events";
import type {
  Question,
  QuestionAnswer,
  QuestionStatus,
  Priority,
  AnswerInfo,
  DeniedInfo,
  GetAnswersResult,
} from "./types.js";
import { logger } from "./logger.js";

// Short ID: base36 timestamp (last 6 digits) + counter
// e.g., "k1w3a1", "k1w3a2" — unique per process, no collision across restarts
function timePrefix(): string {
  return Date.now().toString(36).slice(-5);
}

interface Waiter {
  questionIds: string[];
  requireAll: boolean;
  resolve: (result: GetAnswersResult) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class QuestionStore extends EventEmitter {
  private questions = new Map<string, Question>();
  private waiters: Waiter[] = [];
  private idPrefix = timePrefix();
  private idCounter = 0;

  addQuestion(
    sessionId: string,
    params: {
      text: string;
      header?: string;
      choices?: { label: string; description?: string; markdown?: string; multiSelect?: boolean }[];
      multiSelect?: boolean;
      allowOther?: boolean;
      instant?: boolean;
      context?: string;
      priority?: Priority;
    }
  ): Question {
    const question: Question = {
      id: `${this.idPrefix}${++this.idCounter}`,
      sessionId,
      text: params.text,
      header: params.header,
      choices: params.choices,
      multiSelect: params.multiSelect ?? false,
      allowOther: params.allowOther ?? true,
      instant: params.instant ?? false,
      context: params.context,
      priority: params.priority ?? "normal",
      status: "pending",
      created_at: Date.now(),
    };

    this.questions.set(question.id, question);
    this.emit("question_added", question);
    logger.debug(`Question added: ${question.id} [${question.priority}]`);
    return question;
  }

  applyAnswer(questionId: string, answer: QuestionAnswer): boolean {
    const question = this.questions.get(questionId);
    if (!question || question.status !== "pending") {
      logger.warn(`Cannot answer question ${questionId}: not found or not pending`);
      return false;
    }

    question.status = "answered";
    question.answered_at = Date.now();
    question.answer = answer;

    logger.debug(`Question answered: ${questionId}`);
    this.emit("question_answered", question);
    this.checkWaiters();
    return true;
  }

  applyDenied(questionIds: string[], reason: string): string[] {
    const denied: string[] = [];
    for (const id of questionIds) {
      const question = this.questions.get(id);
      if (question && question.status === "pending") {
        question.status = "denied";
        question.dismiss_reason = reason;
        denied.push(id);
      }
    }

    if (denied.length > 0) {
      logger.debug(`Questions denied: ${denied.join(", ")} (${reason})`);
      this.emit("questions_denied", denied, reason);
      this.checkWaiters();
    }
    return denied;
  }

  dismissQuestions(questionIds: string[], reason?: string): string[] {
    const dismissed: string[] = [];
    for (const id of questionIds) {
      const question = this.questions.get(id);
      if (question && question.status === "pending") {
        question.status = "dismissed";
        question.dismiss_reason = reason;
        dismissed.push(id);
      }
    }

    if (dismissed.length > 0) {
      logger.debug(`Questions dismissed: ${dismissed.join(", ")}`);
      this.emit("questions_dismissed", dismissed, reason);
    }
    return dismissed;
  }

  getQuestion(id: string): Question | undefined {
    return this.questions.get(id);
  }

  getQuestionsByStatus(status?: QuestionStatus): Question[] {
    const all = Array.from(this.questions.values());
    if (!status) return all;
    return all.filter((q) => q.status === status);
  }

  getQuestionsBySession(sessionId: string): Question[] {
    return Array.from(this.questions.values()).filter(
      (q) => q.sessionId === sessionId
    );
  }

  getPendingCount(): number {
    return Array.from(this.questions.values()).filter(
      (q) => q.status === "pending"
    ).length;
  }

  // Non-blocking: check current state of given question IDs
  getAnswers(questionIds: string[]): GetAnswersResult {
    const answered: AnswerInfo[] = [];
    const denied: DeniedInfo[] = [];
    const pending: string[] = [];

    for (const id of questionIds) {
      const q = this.questions.get(id);
      if (!q) continue;

      if (q.status === "answered" && q.answer) {
        answered.push({ id: q.id, text: q.text, answer: q.answer });
      } else if (q.status === "denied") {
        denied.push({
          id: q.id,
          text: q.text,
          reason: q.dismiss_reason ?? "unknown",
        });
      } else if (q.status === "pending") {
        pending.push(q.id);
      }
    }

    return { answered, denied, pending, timed_out: false };
  }

  // Blocking: wait for answers with timeout
  waitForAnswers(
    questionIds: string[],
    requireAll: boolean,
    timeoutSeconds?: number
  ): Promise<GetAnswersResult> {
    // Check if already resolved
    const current = this.getAnswers(questionIds);
    const allDone = current.pending.length === 0;
    const anyDone = current.answered.length > 0 || current.denied.length > 0;
    const instantDone = current.answered.some(a => this.questions.get(a.id)?.instant)
      || current.denied.some(d => this.questions.get(d.id)?.instant);

    const isResolved = requireAll
      ? allDone || instantDone
      : anyDone;

    if (isResolved) {
      return Promise.resolve(current);
    }

    return new Promise<GetAnswersResult>((resolve) => {
      const waiter: Waiter = {
        questionIds,
        requireAll,
        resolve,
      };

      if (timeoutSeconds && timeoutSeconds > 0) {
        waiter.timer = setTimeout(() => {
          this.removeWaiter(waiter);
          const result = this.getAnswers(questionIds);
          result.timed_out = true;
          resolve(result);
        }, timeoutSeconds * 1000);
      }

      this.waiters.push(waiter);
    });
  }

  private checkWaiters(): void {
    const toRemove: Waiter[] = [];

    for (const waiter of this.waiters) {
      const result = this.getAnswers(waiter.questionIds);
      const allDone = result.pending.length === 0;
      const anyDone = result.answered.length > 0 || result.denied.length > 0;
      const instantDone = result.answered.some(a => this.questions.get(a.id)?.instant)
        || result.denied.some(d => this.questions.get(d.id)?.instant);

      const isResolved = waiter.requireAll
        ? allDone || instantDone
        : anyDone;

      if (isResolved) {
        toRemove.push(waiter);
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.resolve(result);
      }
    }

    for (const w of toRemove) {
      this.removeWaiter(w);
    }
  }

  private removeWaiter(waiter: Waiter): void {
    const idx = this.waiters.indexOf(waiter);
    if (idx !== -1) {
      this.waiters.splice(idx, 1);
    }
  }
}
