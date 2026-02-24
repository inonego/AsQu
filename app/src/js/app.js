import { state } from './state.js';
import { renderSidebar, setupContextMenu } from './render-sidebar.js';
import { renderTabs, renderQuestionTabs, renderQuestionContent } from './render-question.js';
import { renderInspector } from './render-inspector.js';
import { renderHistory } from './render-history.js';
import { setupEvents } from './events.js';
import { setupTauriEvents, loadInitialState } from './tauri-bridge.js';

export function renderAll() {
  renderSidebar();
  renderTabs();

  if (state.activeTab === 'pending') {
    document.getElementById('view-pending').style.display = 'flex';
    document.getElementById('view-history').style.display = 'none';
    renderQuestionTabs();
    renderQuestionContent();
  } else {
    document.getElementById('view-pending').style.display = 'none';
    document.getElementById('view-history').style.display = 'flex';
    renderHistory();
  }

  renderInspector();
}

async function init() {
  setupEvents();
  setupContextMenu();
  setupTauriEvents();
  await loadInitialState();
  renderAll();
}

init();
