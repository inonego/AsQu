import { state, getHistoryQuestions, getAnswerState, esc, timeAgo } from './state.js';
import { renderInspector } from './render-inspector.js';

export function renderHistory() {
  const el = document.getElementById('history-list');

  if (state.historyDetailId) {
    renderHistoryDetail(el);
    return;
  }

  const questions = getHistoryQuestions(state.activeSessionId);

  if (questions.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-text">No history yet.</div></div>';
    return;
  }

  el.innerHTML = questions.map(q => {
    let answerText = '';
    let statusIcon = '';

    if (q.status === 'answered' && q.answer) {
      statusIcon = '<span style="color:var(--answered)">&#10003;</span>';
      if (q.choices && q.answer.selectedIndices?.length) {
        answerText = q.answer.selectedIndices.map(i => q.choices[i]?.label || '').join(', ');
      }
      if (q.answer.otherText) answerText = answerText ? answerText + ', ' + q.answer.otherText : q.answer.otherText;
      if (q.answer.freeformText) answerText = q.answer.freeformText;
    } else if (q.status === 'dismissed') {
      statusIcon = '<span style="color:var(--dismissed)">&#8856;</span>';
      answerText = 'dismissed';
    } else if (q.status === 'denied') {
      statusIcon = '<span style="color:var(--critical)">&#10005;</span>';
      answerText = 'denied';
    }

    return `<div class="history-card" data-qid="${q.id}">
      <div class="history-status-icon">${statusIcon}</div>
      <div class="history-body">
        <div class="history-q">Q. ${esc(q.text)}</div>
        <div class="history-a">A. ${esc(answerText || '--')}</div>
      </div>
      <div class="history-meta">
        <div class="history-time">${timeAgo(q.answered_at || q.created_at)}</div>
        <div class="history-arrow">&#8250;</div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.history-card').forEach(card => {
    card.addEventListener('click', () => {
      state.historyDetailId = card.dataset.qid;
      state.focusedChoiceIdx = null;
      renderHistory();
      renderInspector();
    });
  });
}

function renderHistoryDetail(el) {
  const q = state.questions.get(state.historyDetailId);
  if (!q) {
    state.historyDetailId = null;
    renderHistory();
    return;
  }

  const responseTime = q.answered_at
    ? `Answered in ${Math.round((q.answered_at - q.created_at) / 1000)}s`
    : '';

  let html = `<div class="history-detail-back" id="history-back">&#8592; History</div>`;
  html += `<div style="padding:16px 20px; overflow-y:auto; flex:1;">`;
  html += `<div class="question-header">
    <div class="priority-badge ${q.priority}">${q.priority}</div>
    ${responseTime ? `<div class="history-response-time">${responseTime}</div>` : ''}
  </div>`;
  html += `<div class="question-text">${esc(q.text)}</div>`;

  if (q.context) {
    html += `<div class="question-context">${esc(q.context)}</div>`;
  }

  if (q.choices && q.choices.length > 0) {
    html += '<div class="choices-list">';
    q.choices.forEach((c, i) => {
      const isSelected = q.answer?.selectedIndices?.includes(i);
      const focused = state.focusedChoiceIdx === i;
      html += `<div class="choice-item ${isSelected ? 'selected' : ''} ${focused ? 'focused' : ''}"
                    data-idx="${i}" style="cursor:pointer">
        <div class="choice-radio ${q.multiSelect ? 'multi' : ''} ${isSelected ? 'selected' : ''}"></div>
        <div class="choice-content">
          <div class="choice-label">${esc(c.label)}</div>
          ${c.description ? `<div class="choice-desc">${esc(c.description)}</div>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';

    if (q.answer?.otherText) {
      html += `<div style="margin-top:8px; color:var(--subtext); font-size:13px;">Other: ${esc(q.answer.otherText)}</div>`;
    }
  } else if (q.answer?.freeformText) {
    html += `<div style="margin-top:12px; padding:12px; background:var(--input-bg); border-radius:8px; font-size:14px;">${esc(q.answer.freeformText)}</div>`;
  }

  html += '</div>';
  el.innerHTML = html;

  // Populate answer state for inspector to read (readonly)
  if (q.answer) {
    const ans = getAnswerState(q.id);
    ans.selected = new Set(q.answer.selectedIndices || []);
    if (q.answer.choiceDetails) {
      for (const [k, v] of Object.entries(q.answer.choiceDetails)) {
        ans.details.set(parseInt(k), {
          confidenceOn: v.confidence != null,
          confidence: v.confidence || 0,
          note: v.note || '',
        });
      }
    }
  }

  // Back button
  document.getElementById('history-back')?.addEventListener('click', () => {
    state.historyDetailId = null;
    state.focusedChoiceIdx = null;
    renderHistory();
    renderInspector();
  });

  // Choice focus for inspector (readonly)
  el.querySelectorAll('.choice-item').forEach(item => {
    item.addEventListener('click', () => {
      state.focusedChoiceIdx = parseInt(item.dataset.idx);
      el.querySelectorAll('.choice-item').forEach(i => i.classList.remove('focused'));
      item.classList.add('focused');
      // Temporarily set activeQuestionId for inspector render
      const prev = state.activeQuestionId;
      state.activeQuestionId = q.id;
      renderInspector();
      state.activeQuestionId = prev;
    });
  });
}
