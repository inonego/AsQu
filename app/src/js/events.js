import { state, getPendingQuestions, getAnswerState, PRIORITY_COLORS, esc } from './state.js';
import { handleChoiceClick } from './render-question.js';
import { renderInspector } from './render-inspector.js';
import { renderAll } from './app.js';

// === Submit & Dismiss ===

export async function submitCurrentAnswer() {
  const q = state.questions.get(state.activeQuestionId);
  if (!q) return;

  const ans = getAnswerState(q.id);
  const answer = {
    selectedIndices: Array.from(ans.selected).sort(),
    choiceDetails: {},
    otherText: ans.otherText || undefined,
    freeformText: ans.freeformText || undefined,
  };

  ans.details.forEach((d, idx) => {
    if (d.confidenceOn || (d.note && d.note.trim())) {
      answer.choiceDetails[idx] = {};
      if (d.confidenceOn) answer.choiceDetails[idx].confidence = d.confidence;
      if (d.note && d.note.trim()) answer.choiceDetails[idx].note = d.note;
    }
  });

  try {
    await window.__TAURI__.core.invoke('submit_answer', {
      questionId: q.id,
      answer,
    });
    q.status = 'answered';
    q.answered_at = Date.now();
    q.answer = answer;
    state.answers.delete(q.id);
    state.activeQuestionId = null;
    state.focusedChoiceIdx = null;
    renderAll();
  } catch (err) {
    console.error('Submit failed:', err);
  }
}

export async function dismissCurrentQuestion() {
  const q = state.questions.get(state.activeQuestionId);
  if (!q) return;

  if (window.__TAURI__) {
    try {
      await window.__TAURI__.core.invoke('dismiss_question', { questionId: q.id });
    } catch (e) {
      console.error('Failed to dismiss:', e);
    }
  }

  q.status = 'dismissed';
  state.answers.delete(q.id);
  state.activeQuestionId = null;
  state.focusedChoiceIdx = null;
  renderAll();
}

// === Setup all UI event listeners ===

export function setupEvents() {
  setupTabSwitching();
  setupButtons();
  setupViewAllOverlay();
  setupSettingsOverlay();
  setupWindowControls();
  setupKeyboard();
}

function setupTabSwitching() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeTab = tab.dataset.tab;
      state.historyDetailId = null;
      state.focusedChoiceIdx = null;
      renderAll();
    });
  });
}

function setupButtons() {
  document.getElementById('btn-submit')?.addEventListener('click', submitCurrentAnswer);
  document.getElementById('btn-dismiss-q')?.addEventListener('click', dismissCurrentQuestion);
}

function setupViewAllOverlay() {
  const overlay = document.getElementById('viewall-overlay');

  document.getElementById('btn-viewall')?.addEventListener('click', () => {
    overlay.classList.add('open');
    const panel = document.getElementById('viewall-panel');
    const pending = getPendingQuestions(state.activeSessionId);

    panel.innerHTML = pending.map(q => {
      const label = q.header || q.text.substring(0, 30);
      return `<div class="viewall-item ${q.id === state.activeQuestionId ? 'current' : ''}" data-qid="${q.id}">
        <div class="viewall-dot" style="background:${PRIORITY_COLORS[q.priority]}"></div>
        <div class="viewall-text">${esc(label)}</div>
        <div class="viewall-priority">${q.priority}</div>
      </div>`;
    }).join('');

    panel.querySelectorAll('.viewall-item').forEach(item => {
      item.addEventListener('click', () => {
        state.activeQuestionId = item.dataset.qid;
        state.focusedChoiceIdx = null;
        overlay.classList.remove('open');
        renderAll();
      });
    });
  });

  overlay?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });
}

function setupSettingsOverlay() {
  const overlay = document.getElementById('settings-overlay');

  document.getElementById('btn-settings')?.addEventListener('click', async () => {
    overlay.classList.add('open');
    // Sync close-to-tray toggle from backend
    try {
      const val = await window.__TAURI__.core.invoke('get_close_to_tray');
      const t = document.getElementById('toggle-close-to-tray');
      if (t) t.classList.toggle('on', val);
    } catch {}
  });
  document.getElementById('btn-settings-cancel')?.addEventListener('click', () => {
    overlay.classList.remove('open');
  });
  document.getElementById('btn-settings-save')?.addEventListener('click', async () => {
    overlay.classList.remove('open');
    // Save close-to-tray setting
    const t = document.getElementById('toggle-close-to-tray');
    if (t) {
      try { await window.__TAURI__.core.invoke('set_close_to_tray', { value: t.classList.contains('on') }); } catch {}
    }
  });
  overlay?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  // Toggle clicks
  document.querySelectorAll('.settings-panel .toggle').forEach(toggle => {
    toggle.addEventListener('click', () => toggle.classList.toggle('on'));
  });
}

function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', async () => {
    try { await window.__TAURI__.core.invoke('hide_window'); } catch {}
  });
  document.getElementById('btn-close')?.addEventListener('click', async () => {
    try { await window.__TAURI__.core.invoke('hide_window'); } catch {}
  });
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // History: Esc goes back from detail
    if (state.activeTab !== 'pending') {
      if (e.key === 'Escape' && state.historyDetailId) {
        state.historyDetailId = null;
        state.focusedChoiceIdx = null;
        renderAll();
      }
      return;
    }

    const q = state.questions.get(state.activeQuestionId);
    if (!q || q.status !== 'pending') return;

    // Don't capture keyboard when typing in inputs
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitCurrentAnswer();
    } else if (e.key === 'Escape') {
      dismissCurrentQuestion();
    } else if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (q.choices && idx < q.choices.length) {
        handleChoiceClick(q, idx);
      }
    } else if (e.key === 'ArrowLeft') {
      navigateQuestion(-1);
    } else if (e.key === 'ArrowRight') {
      navigateQuestion(1);
    }
  });
}

function navigateQuestion(direction) {
  const pending = getPendingQuestions(state.activeSessionId);
  const curIdx = pending.findIndex(p => p.id === state.activeQuestionId);
  const nextIdx = curIdx + direction;
  if (nextIdx >= 0 && nextIdx < pending.length) {
    state.activeQuestionId = pending[nextIdx].id;
    state.focusedChoiceIdx = null;
    renderAll();
  }
}
