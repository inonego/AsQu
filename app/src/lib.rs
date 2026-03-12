// ============================================================
// lib.rs — Tauri setup, MCP integration, event bridge
// ============================================================

mod mcp;
mod question_store;
mod state;
mod types;
mod ui;

use std::env;
use std::path::Path;
use std::sync::{atomic::AtomicBool, Arc};

use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tracing::info;
use tracing_subscriber::EnvFilter;

use state::{AppState, SharedState};
use types::McpToUiEvent;

// ============================================================
// UI Event Listener (bridges MCP events to Tauri frontend)
// ============================================================

// ------------------------------------------------------------
// Listen for MCP -> UI events and emit Tauri events
// ------------------------------------------------------------
async fn ui_event_listener(
    app: tauri::AppHandle,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<McpToUiEvent>,
    close_flag: Arc<AtomicBool>,
) {
    while let Some(event) = rx.recv().await {
        match event {
            McpToUiEvent::QuestionAdded { question } => {
                let _ = app.emit("question_added", serde_json::json!({
                    "question": question,
                }));
                // Show window when a new question arrives
                ui::window::show_window_internal(&app, &close_flag);
            }
            McpToUiEvent::QuestionsBatch { questions } => {
                let _ = app.emit("questions_batch", serde_json::json!({
                    "questions": questions,
                }));
                ui::window::show_window_internal(&app, &close_flag);
            }
            McpToUiEvent::QuestionsDismissed { question_ids } => {
                let _ = app.emit("questions_dismissed", serde_json::json!({
                    "question_ids": question_ids,
                }));
            }
            McpToUiEvent::ShowWindow => {
                ui::window::show_window_internal(&app, &close_flag);
            }
        }
    }
    info!("UI event channel closed");
}

// ============================================================
// Main entry point
// ============================================================

// ------------------------------------------------------------
// Run the application
// ------------------------------------------------------------
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging (to stderr — stdout is used by MCP)
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();

    info!("AsQu v0.1.0 starting...");

    // Generate session identity
    let session_id = uuid::Uuid::new_v4().to_string();
    let session_cwd = env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let session_name = Path::new(&session_cwd)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    info!("Session: {session_name} ({session_id})");

    // Create shared state
    let (app_state, mcp_to_ui_rx, close_flag, close_notify) = AppState::new();
    let shared_state: SharedState = Arc::new(Mutex::new(app_state));

    // Build and run Tauri app
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(shared_state.clone())
        .manage(state::WindowClosedFlag(close_flag.clone()))
        .manage(state::WebviewReadyState {
            ready: std::sync::atomic::AtomicBool::new(false),
            pending_show: std::sync::atomic::AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            ui::commands::submit_answer,
            ui::commands::dismiss_question,
            ui::commands::get_state,
            ui::commands::notify_ready,
            ui::commands::show_window,
            ui::commands::hide_window,
        ])
        .setup(move |app| {
            // Warm up: briefly show then hide the window.
            // On Windows, WebView2 may not fully initialize for a window
            // that was never shown, causing subsequent win.show() to fail.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.hide();
            }

            // Close handler (hide window, MCP server stays running)
            ui::window::setup_close_handler(app.handle(), close_flag.clone(), close_notify);

            // Spawn UI event listener
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(ui_event_listener(app_handle, mcp_to_ui_rx, close_flag));

            // Spawn MCP server on stdio
            let state_clone = shared_state.clone();
            let sid = session_id.clone();
            let sname = session_name.clone();
            let scwd = session_cwd.clone();
            tauri::async_runtime::spawn(async move {
                mcp::transport::start_mcp_server(state_clone, sid, sname, scwd).await;
            });

            info!("AsQu setup complete");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Failed to run AsQu");
}
