// Application state & shared constants/helpers

export const state = {
  sessions: new Map(),
  questions: new Map(),
  activeSessionId: null,
  activeTab: 'pending',
  activeQuestionId: null,
  focusedChoiceIdx: null,
  historyDetailId: null,
  // Per-question answer state:
  // questionId -> { selected: Set<number>, details: Map<number, {confidenceOn, confidence, note}>, otherText, freeformText }
  answers: new Map(),
};

export const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
export const PRIORITY_COLORS = {
  critical: 'var(--critical)',
  high: 'var(--high)',
  normal: 'var(--normal)',
  low: 'var(--low)',
};

// === Helpers ===

export function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function getPendingQuestions(sessionId) {
  return Array.from(state.questions.values())
    .filter(q => q.status === 'pending' && (!sessionId || q.sessionId === sessionId))
    .sort((a, b) => a.created_at - b.created_at);
}

export function getHistoryQuestions(sessionId) {
  return Array.from(state.questions.values())
    .filter(q => q.status !== 'pending' && (!sessionId || q.sessionId === sessionId))
    .sort((a, b) => (b.answered_at || b.created_at) - (a.answered_at || a.created_at));
}

export function getAnswerState(qId) {
  if (!state.answers.has(qId)) {
    state.answers.set(qId, {
      selected: new Set(),
      details: new Map(),
      otherText: '',
      freeformText: '',
    });
  }
  return state.answers.get(qId);
}

export function isChoiceMulti(q, idx) {
  if (q.choices && q.choices[idx] && q.choices[idx].multiSelect !== undefined) {
    return q.choices[idx].multiSelect;
  }
  return q.multiSelect;
}

export function isChoiceLocked(qId, idx) {
  const ans = getAnswerState(qId);
  const d = ans.details.get(idx);
  if (!d) return false;
  return (d.confidenceOn && d.confidence > 0) || (d.note && d.note.trim());
}
