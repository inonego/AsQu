import { state, getPendingQuestions, PRIORITY_ORDER, esc } from './state.js';
import { renderAll } from './app.js';

export function renderSidebar() {
  const el = document.getElementById('sessions-list');
  const sessions = Array.from(state.sessions.values()).sort((a, b) => {
    if (a.status === 'connected' && b.status !== 'connected') return -1;
    if (b.status === 'connected' && a.status !== 'connected') return 1;
    return b.connectedAt - a.connectedAt;
  });

  el.innerHTML = sessions.map(s => {
    const pending = getPendingQuestions(s.id);
    const count = pending.length;
    const maxPriority = pending.reduce(
      (m, q) => Math.min(m, PRIORITY_ORDER[q.priority] ?? 2), 99
    );
    const priorityClass = count > 0
      ? Object.keys(PRIORITY_ORDER).find(k => PRIORITY_ORDER[k] === maxPriority) || 'normal'
      : '';

    return `<div class="session-item ${s.id === state.activeSessionId ? 'active' : ''}"
                 data-session="${s.id}">
      <div class="session-dot ${s.status}"></div>
      <div class="session-info"><div class="session-name">${esc(s.name)}</div></div>
      ${count > 0
        ? `<div class="session-badge ${priorityClass}">${count}</div>`
        : '<div style="font-size:11px;color:var(--idle)">idle</div>'}
    </div>`;
  }).join('');

  el.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', () => {
      state.activeSessionId = item.dataset.session;
      renderAll();
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showSessionContextMenu(e, item.dataset.session);
    });
  });

  // Status bar
  const activeSessions = sessions.filter(s => s.status === 'connected').length;
  const totalPending = getPendingQuestions().length;
  document.getElementById('status-sessions').textContent =
    `${activeSessions} active session${activeSessions !== 1 ? 's' : ''}`;
  document.getElementById('status-pending').textContent =
    `Total pending: ${totalPending}`;
}

// === Context Menu ===

let ctxSessionId = null;

function showSessionContextMenu(e, sessionId) {
  ctxSessionId = sessionId;
  const menu = document.getElementById('context-menu');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.add('open');
}

export function setupContextMenu() {
  document.addEventListener('click', () => {
    document.getElementById('context-menu').classList.remove('open');
  });

  document.getElementById('ctx-delete-session')?.addEventListener('click', async () => {
    if (!ctxSessionId) return;
    try {
      await window.__TAURI__.core.invoke('delete_session', { sessionId: ctxSessionId });
    } catch (err) {
      console.error('Delete session failed:', err);
    }
    state.sessions.delete(ctxSessionId);
    state.questions.forEach((q, id) => {
      if (q.sessionId === ctxSessionId) state.questions.delete(id);
    });
    if (state.activeSessionId === ctxSessionId) state.activeSessionId = null;
    ctxSessionId = null;
    renderAll();
  });
}
