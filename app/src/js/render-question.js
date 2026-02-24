import {
  state, getPendingQuestions, getAnswerState, isChoiceLocked, isChoiceMulti,
  PRIORITY_COLORS, esc, timeAgo,
} from './state.js';
import { renderInspector } from './render-inspector.js';

export function renderTabs() {
  const pending = getPendingQuestions(state.activeSessionId);
  const historyCount = Array.from(state.questions.values())
    .filter(q => q.status !== 'pending' &&
      (!state.activeSessionId || q.sessionId === state.activeSessionId)).length;

  document.getElementById('pending-count').textContent = `(${pending.length})`;
  document.getElementById('history-count').textContent = `(${historyCount})`;
}

export function renderQuestionTabs() {
  const el = document.getElementById('question-tabs');
  const pending = getPendingQuestions(state.activeSessionId);

  if (!state.activeQuestionId || !pending.find(q => q.id === state.activeQuestionId)) {
    state.activeQuestionId = pending[0]?.id || null;
  }

  el.innerHTML = pending.map(q => {
    const label = q.header || q.text.substring(0, 20);
    return `<div class="qtab ${q.id === state.activeQuestionId ? 'active' : ''}" data-qid="${q.id}">
      <div class="qtab-dot" style="background:${PRIORITY_COLORS[q.priority] || PRIORITY_COLORS.normal}"></div>
      ${esc(label)}
    </div>`;
  }).join('');

  el.querySelectorAll('.qtab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.activeQuestionId = tab.dataset.qid;
      state.focusedChoiceIdx = null;
      el.querySelectorAll('.qtab').forEach(t => t.classList.toggle('active', t.dataset.qid === tab.dataset.qid));
      tab.blur();
      renderQuestionContent();
      renderInspector();
    });
  });

  // Mouse wheel horizontal scroll
  el.onwheel = (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  };

  const viewallBtn = document.getElementById('btn-viewall');
  if (viewallBtn) viewallBtn.textContent = `View All (${pending.length})`;
}

export function renderQuestionContent() {
  const area = document.getElementById('question-area');
  const submitBar = document.getElementById('submit-bar');
  const q = state.questions.get(state.activeQuestionId);

  if (!q || q.status !== 'pending') {
    area.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#10003;</div>
      <div class="empty-state-text">All caught up! No pending questions.</div>
    </div>`;
    submitBar.style.display = 'none';
    return;
  }

  submitBar.style.display = 'flex';
  const ans = getAnswerState(q.id);

  let html = `
    <div class="question-header">
      <div class="priority-badge ${q.priority}">${q.priority}</div>
      ${q.instant ? '<div class="instant-badge" title="Answering this question immediately unblocks the waiting agent">instant</div>' : ''}
      <div class="question-time">${timeAgo(q.created_at)}</div>
    </div>
    <div class="question-text">${esc(q.text)}</div>
  `;

  if (q.context) {
    html += `<div class="question-context">${esc(q.context)}</div>`;
  }

  if (q.choices && q.choices.length > 0) {
    html += '<div class="choices-list">';

    const divider = (label) => `<div class="choices-divider">
      <div class="choices-divider-line"></div>
      <span class="choices-divider-label">${label}</span>
      <div class="choices-divider-line"></div>
    </div>`;

    const renderChoice = (c, i) => {
      const isSelected = ans.selected.has(i);
      const locked = isChoiceLocked(q.id, i);
      const focused = state.focusedChoiceIdx === i;
      const isMulti = isChoiceMulti(q, i) || locked;
      const radioClass = `choice-radio ${isMulti ? 'multi' : ''} ${isSelected ? 'selected' : ''} ${locked ? 'locked' : ''}`;
      const itemClass = `choice-item ${isSelected ? 'selected' : ''} ${focused ? 'focused' : ''} ${locked ? 'locked' : ''}`;
      return `<div class="${itemClass}" data-idx="${i}">
        <div class="${radioClass}"></div>
        <div class="choice-content">
          <div class="choice-label">${esc(c.label)}</div>
          ${c.description ? `<div class="choice-desc">${esc(c.description)}</div>` : ''}
        </div>
        <div class="choice-number">${i + 1}</div>
      </div>`;
    };

    // Group choices into: single-select, multi-select, pinned
    // Pinned = selected multi-select OR any choice with detail (confidence/note)
    const allItems = q.choices.map((c, i) => ({ c, i }));
    const isPinned = (i) => {
      const multi = isChoiceMulti(q, i);
      return (multi && ans.selected.has(i)) || isChoiceLocked(q.id, i);
    };

    const pinnedItems = allItems.filter(({ i }) => isPinned(i));
    const singleItems = allItems.filter(({ i }) => !isPinned(i) && !isChoiceMulti(q, i));
    const multiItems = allItems.filter(({ i }) => !isPinned(i) && isChoiceMulti(q, i));

    if (singleItems.length > 0) {
      singleItems.forEach(({ c, i }) => { html += renderChoice(c, i); });
    }
    if (multiItems.length > 0) {
      if (singleItems.length > 0) html += divider('Multi-select');
      multiItems.forEach(({ c, i }) => { html += renderChoice(c, i); });
    }
    if (pinnedItems.length > 0) {
      if (singleItems.length > 0 || multiItems.length > 0) html += divider('Pinned');
      pinnedItems.forEach(({ c, i }) => { html += renderChoice(c, i); });
    }

    html += '</div>';

    if (q.allowOther !== false) {
      html += `<div class="other-input-wrap">
        <div class="other-label">&#9998; Other...</div>
        <textarea class="other-input" id="other-input"
                  placeholder="Type your own answer...">${esc(ans.otherText || '')}</textarea>
      </div>`;
    }
  } else {
    html += `<div style="margin-top:12px;">
      <textarea class="freeform-input" id="freeform-input"
                placeholder="Type your answer...">${esc(ans.freeformText || '')}</textarea>
    </div>`;
  }

  area.innerHTML = html;

  // Wire up choice clicks
  area.querySelectorAll('.choice-item').forEach(item => {
    item.addEventListener('click', () => {
      handleChoiceClick(q, parseInt(item.dataset.idx));
    });
  });

  // Wire up text inputs
  const otherInput = document.getElementById('other-input');
  if (otherInput) {
    otherInput.addEventListener('input', () => { ans.otherText = otherInput.value; });
    otherInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); });
  }
  const freeformInput = document.getElementById('freeform-input');
  if (freeformInput) {
    freeformInput.addEventListener('input', () => { ans.freeformText = freeformInput.value; });
  }
}

export function handleChoiceClick(q, idx) {
  const ans = getAnswerState(q.id);
  const locked = isChoiceLocked(q.id, idx);
  const multi = isChoiceMulti(q, idx);

  if (locked) {
    // Locked choices: just focus, no toggle
    state.focusedChoiceIdx = idx;
  } else if (multi) {
    // Multi-select (question-level or per-choice override): toggle
    if (ans.selected.has(idx)) {
      ans.selected.delete(idx);
    } else {
      ans.selected.add(idx);
    }
    state.focusedChoiceIdx = idx;
  } else {
    // Single select: keep locked + multi-override selections, toggle normal radio
    const keepSelections = new Set();
    ans.selected.forEach(i => {
      if (isChoiceLocked(q.id, i) || isChoiceMulti(q, i)) keepSelections.add(i);
    });
    const wasSelected = ans.selected.has(idx);
    ans.selected = keepSelections;
    if (!wasSelected) {
      ans.selected.add(idx);
    }
    state.focusedChoiceIdx = idx;
  }

  renderQuestionContent();
  renderInspector();
}
