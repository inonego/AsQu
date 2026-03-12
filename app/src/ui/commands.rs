// ============================================================
// ui/commands.rs — Tauri commands (invoked from frontend JS)
// ============================================================

use serde_json::Value;
use tauri::{Manager, State};

use std::sync::atomic::Ordering;

use crate::state::{AppState, SharedState, WebviewReadyState};
use crate::types::QuestionAnswer;

// ============================================================
// Answer / Dismiss
// ============================================================

// ------------------------------------------------------------
// Hide the window if no pending questions remain
// ------------------------------------------------------------
fn auto_hide_if_empty(app: &tauri::AppHandle, st: &AppState) {
    if st.get_pending_count() == 0 {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.hide();
        }
    }
}

// ------------------------------------------------------------
// Submit an answer to a question (from UI)
// ------------------------------------------------------------
#[tauri::command]
pub async fn submit_answer(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    question_id: String,
    answer: QuestionAnswer,
) -> Result<bool, String> {
    let mut st = state.lock().await;
    let ok = st.apply_answer(&question_id, answer);
    auto_hide_if_empty(&app, &st);
    Ok(ok)
}

// ------------------------------------------------------------
// Dismiss a question from the UI
// ------------------------------------------------------------
#[tauri::command]
pub async fn dismiss_question(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    question_id: String,
    reason: Option<String>,
) -> Result<Vec<String>, String> {
    let mut st = state.lock().await;
    let dismissed = st.apply_denied(
        &[question_id],
        reason.as_deref().unwrap_or("dismissed by user"),
    );
    auto_hide_if_empty(&app, &st);
    Ok(dismissed)
}

// ============================================================
// State Query
// ============================================================

// ------------------------------------------------------------
// Get full application state (for initial load)
// ------------------------------------------------------------
#[tauri::command]
pub async fn get_state(state: State<'_, SharedState>) -> Result<Value, String> {
    let st = state.lock().await;
    let questions: Vec<&crate::types::Question> = st.questions.values().collect();

    Ok(serde_json::json!({
        "questions": questions,
    }))
}

// ============================================================
// Webview Readiness
// ============================================================

// ------------------------------------------------------------
// Called by the frontend after initialization is complete.
// Processes any buffered show requests.
// ------------------------------------------------------------
#[tauri::command]
pub async fn notify_ready(
    app: tauri::AppHandle,
    ready_state: tauri::State<'_, WebviewReadyState>,
    flag: tauri::State<'_, crate::state::WindowClosedFlag>,
) -> Result<(), String> {
    ready_state.ready.store(true, Ordering::Release);

    // If a show was requested before the webview was ready, process it now
    if ready_state.pending_show.swap(false, Ordering::AcqRel) {
        super::window::show_window_internal(&app, &flag.0);
    }
    Ok(())
}

// ============================================================
// Window Management
// ============================================================

// ------------------------------------------------------------
// Show the main window
// ------------------------------------------------------------
#[tauri::command]
pub async fn show_window(
    app: tauri::AppHandle,
    flag: tauri::State<'_, crate::state::WindowClosedFlag>,
) -> Result<(), String> {
    super::window::show_window_internal(&app, &flag.0);
    Ok(())
}

// ------------------------------------------------------------
// Hide the main window
// ------------------------------------------------------------
#[tauri::command]
pub async fn hide_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::SharedState>,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    // Wake blocked wait_for_answers calls
    let st = state.lock().await;
    st.window_closed_flag
        .store(true, std::sync::atomic::Ordering::Release);
    st.window_closed.notify_waiters();
    Ok(())
}
