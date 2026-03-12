// ============================================================
// Application Entry Point & Render Pipeline
// ============================================================

import { getPendingQuestions } from './state.js';
import { renderQuestionList, renderQuestionContent } from './render-question.js';
import { renderInspector } from './render-inspector.js';
import { setupEvents } from './events.js';
import { setupTauriEvents, loadInitialState } from './tauri-bridge.js';

// ============================================================
// Render Functions
// ============================================================

// ------------------------------------------------------------
// Full re-render of all UI panels
// ------------------------------------------------------------
export function renderAll() {
  renderQuestionList();
  renderQuestionContent();
  renderInspector();
  renderStatusBar();
}

// ------------------------------------------------------------
// Partial render that preserves focused inputs (e.g. textarea)
// Used when user is actively typing to avoid destroying focus
// ------------------------------------------------------------
export function renderAllExceptContent() {
  renderQuestionList();
  renderStatusBar();
}

// ------------------------------------------------------------
// Update the status bar pending count
// ------------------------------------------------------------
function renderStatusBar() {
  const total = getPendingQuestions().length;
  const el = document.getElementById('status-pending');
  if (el) el.textContent = `Pending: ${total}`;
}

// ============================================================
// Initialization
// ============================================================

// ------------------------------------------------------------
// Bootstrap the application
// ------------------------------------------------------------
async function init() {
  setupEvents();
  setupTauriEvents();
  await loadInitialState();
  renderAll();

  // Signal backend that the webview is ready to be shown
  if (window.__TAURI__) {
    await window.__TAURI__.core.invoke('notify_ready');
  }
}

init();
