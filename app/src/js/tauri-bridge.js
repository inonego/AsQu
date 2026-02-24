import { state } from './state.js';
import { renderAll } from './app.js';

export function setupTauriEvents() {
  if (!window.__TAURI__) return;
  const { listen } = window.__TAURI__.event;

  listen('question_added', (event) => {
    const { question, session } = event.payload;
    state.sessions.set(session.id, session);
    state.questions.set(question.id, question);
    if (!state.activeSessionId) state.activeSessionId = session.id;
    renderAll();
  });

  listen('questions_batch', (event) => {
    const { questions, session } = event.payload;
    console.log('[AsQu DEBUG] questions_batch payload:', JSON.stringify(questions[0], null, 2));
    state.sessions.set(session.id, session);
    questions.forEach(q => state.questions.set(q.id, q));
    if (!state.activeSessionId) state.activeSessionId = session.id;
    renderAll();
  });

  listen('questions_dismissed', (event) => {
    const { question_ids } = event.payload;
    question_ids.forEach(id => {
      const q = state.questions.get(id);
      if (q) q.status = 'dismissed';
    });
    renderAll();
  });

  listen('session_created', (event) => {
    const { session } = event.payload;
    state.sessions.set(session.id, session);
    renderAll();
  });

  listen('session_updated', (event) => {
    const { session } = event.payload;
    state.sessions.set(session.id, session);
    renderAll();
  });

  listen('session_deleted', (event) => {
    const sessionId = event.payload;
    state.sessions.delete(sessionId);
    state.questions.forEach((q, id) => {
      if (q.sessionId === sessionId) state.questions.delete(id);
    });
    if (state.activeSessionId === sessionId) state.activeSessionId = null;
    renderAll();
  });

  listen('question_answered', () => {
    renderAll();
  });
}

export async function loadInitialState() {
  if (!window.__TAURI__) return;

  try {
    const data = await window.__TAURI__.core.invoke('get_state');
    if (data.sessions) {
      data.sessions.forEach(s => state.sessions.set(s.id, s));
    }
    if (data.questions) {
      data.questions.forEach(q => state.questions.set(q.id, q));
    }
    if (state.sessions.size > 0 && !state.activeSessionId) {
      state.activeSessionId = state.sessions.keys().next().value;
    }
  } catch (err) {
    console.error('Failed to load initial state:', err);
  }
}
