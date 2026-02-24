import { state, getAnswerState, isChoiceLocked, esc } from './state.js';
import { renderQuestionContent } from './render-question.js';

export function renderInspector() {
  const emptyEl = document.getElementById('inspector-empty');
  const contentEl = document.getElementById('inspector-content');
  const q = state.questions.get(state.activeQuestionId);

  if (!q || state.focusedChoiceIdx === null ||
      !q.choices || !q.choices[state.focusedChoiceIdx]) {
    emptyEl.style.display = 'flex';
    contentEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = 'flex';

  const choice = q.choices[state.focusedChoiceIdx];
  const idx = state.focusedChoiceIdx;
  const ans = getAnswerState(q.id);
  const detail = ans.details.get(idx) || { confidenceOn: false, confidence: 100, note: '' };
  const isHistory = q.status !== 'pending';

  let html = `<div class="inspector-choice-name">&#9656; ${esc(choice.label)}</div>`;

  // Preview section
  if (choice.markdown) {
    html += `<div class="inspector-section">
      <div class="inspector-section-header">Preview</div>
      <div class="inspector-section-body">
        <div class="preview-content">${esc(choice.markdown)}</div>
      </div>
    </div>`;
  }

  // Details section
  const confVal = detail.confidenceOn ? (detail.confidence ?? 100) : null;
  html += `<div class="inspector-section">
    <div class="inspector-section-header">Details</div>
    <div class="inspector-section-body">
      <div class="confidence-row">
        <div class="confidence-top">
          <div class="toggle ${detail.confidenceOn ? 'on' : ''}" id="conf-toggle"
               ${isHistory ? '' : 'style="cursor:pointer"'}>
            <div class="toggle-thumb"></div>
          </div>
          <span class="confidence-label">Confidence</span>
          <span class="confidence-value ${detail.confidenceOn ? 'active' : ''}" id="conf-value">${confVal !== null ? confVal + '%' : '--%'}</span>
        </div>
        <input type="range" class="confidence-slider" id="conf-slider"
               min="0" max="100" value="${detail.confidence ?? 100}"
               ${!detail.confidenceOn || isHistory ? 'disabled' : ''}>
      </div>
      <div class="note-label">Note</div>
      <textarea class="note-textarea" id="note-textarea"
                placeholder="Add a note..."
                ${isHistory ? 'readonly' : ''}>${esc(detail.note || '')}</textarea>
      ${!isHistory ? '<button class="clear-btn" id="clear-detail-btn">Clear</button>' : ''}
    </div>
  </div>`;

  contentEl.innerHTML = html;

  // Auto-resize note textarea to fit existing content
  const noteEl = document.getElementById('note-textarea');
  if (noteEl) autoResizeTextarea(noteEl);

  if (isHistory) return;

  wireInspectorEvents(q, idx, ans, detail);
}

function wireInspectorEvents(q, idx, ans, detail) {
  document.getElementById('conf-toggle')?.addEventListener('click', () => {
    detail.confidenceOn = !detail.confidenceOn;
    ans.details.set(idx, detail);
    autoSelectIfDetailed(q, idx);
    renderInspector();
    renderQuestionContent();
  });

  document.getElementById('conf-slider')?.addEventListener('input', (e) => {
    detail.confidence = parseInt(e.target.value);
    document.getElementById('conf-value').textContent = detail.confidence + '%';
    ans.details.set(idx, detail);
    autoSelectIfDetailed(q, idx);
    renderQuestionContent();
  });

  document.getElementById('note-textarea')?.addEventListener('input', (e) => {
    detail.note = e.target.value;
    ans.details.set(idx, detail);
    autoResizeTextarea(e.target);
    autoSelectIfDetailed(q, idx);
    renderQuestionContent();
  });

  document.getElementById('clear-detail-btn')?.addEventListener('click', () => {
    ans.details.delete(idx);
    ans.selected.delete(idx);
    renderInspector();
    renderQuestionContent();
  });
}

function autoSelectIfDetailed(q, idx) {
  const ans = getAnswerState(q.id);
  if (isChoiceLocked(q.id, idx)) {
    ans.selected.add(idx);
  } else {
    // Details cleared back to empty state — auto-deselect
    ans.selected.delete(idx);
  }
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}
