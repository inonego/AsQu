// ============================================================
// ui/window.rs — Window management (show/hide/focus)
// ============================================================

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};

use tauri::{AppHandle, Manager};
use tokio::sync::Notify;
use tracing::warn;

use crate::state::WebviewReadyState;

// Monotonic counter — only the most recent show call reverts always-on-top.
// Prevents N stale set_always_on_top(false) tasks when called rapidly.
static ALWAYS_ON_TOP_GEN: AtomicU64 = AtomicU64::new(0);

// ------------------------------------------------------------
// Show the main window with focus (always-on-top dance)
// Defers the show if the webview hasn't finished loading yet.
// ------------------------------------------------------------
pub fn show_window_internal(app: &AppHandle, close_flag: &Arc<AtomicBool>) {
    // Check if the webview frontend has signalled readiness
    let webview_state: tauri::State<WebviewReadyState> = app.state();
    if !webview_state.ready.load(Ordering::Acquire) {
        webview_state.pending_show.store(true, Ordering::Release);
        return;
    }

    let Some(win) = app.get_webview_window("main") else {
        warn!("Main window not found");
        return;
    };

    let _ = win.show();
    let _ = win.unminimize();

    // Reset window-closed flag synchronously — no mutex needed (Arc<AtomicBool>).
    // Previously this was done inside a spawn(async { lock().await; ... }),
    // causing a race where wait_for_answers could see stale flag=true and return early.
    close_flag.store(false, Ordering::Release);

    // Always-on-top dance: briefly set on top to steal focus, then revert
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();

    // Fallback: flash taskbar if Windows blocked the focus steal
    let _ = win.request_user_attention(Some(tauri::UserAttentionType::Informational));

    // Revert always-on-top after delay.
    // Generation guard: if show_window_internal is called again within 200ms,
    // the previous revert task sees a stale generation and skips the call.
    let revert_gen = ALWAYS_ON_TOP_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    let win_clone = win.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        if ALWAYS_ON_TOP_GEN.load(Ordering::Relaxed) == revert_gen {
            let _ = win_clone.set_always_on_top(false);
        }
    });
}

// ------------------------------------------------------------
// Set up close handler (hide window, MCP server stays running)
// ------------------------------------------------------------
pub fn setup_close_handler(app: &AppHandle, close_flag: Arc<AtomicBool>, close_notify: Arc<Notify>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };

    let app_handle = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Some(w) = app_handle.get_webview_window("main") {
                let _ = w.hide();
            }
            // Set flag immediately (synchronous, no mutex needed — Arc<AtomicBool>).
            // Previously this was inside a spawn(async { lock().await; ... }), which could
            // race with a concurrent show_window_internal resetting the flag to false.
            close_flag.store(true, Ordering::Release);
            // Wake blocked wait_for_answers calls (synchronous — Notify::notify_waiters is sync)
            close_notify.notify_waiters();
        }
    });
}
