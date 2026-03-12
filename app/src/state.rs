// ============================================================
// state.rs — Shared application state and event channels
// ============================================================

use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::{mpsc, Mutex, Notify};

use crate::types::{McpToUiEvent, Question};

// ============================================================
// Type Aliases
// ============================================================

pub type SharedState = Arc<Mutex<AppState>>;

// ============================================================
// WindowClosedFlag — Managed state for lock-free flag access
// ============================================================

pub struct WindowClosedFlag(pub Arc<AtomicBool>);

// ============================================================
// WebviewReadyState — Tracks whether the frontend has initialized
// ============================================================

pub struct WebviewReadyState {
    pub ready: AtomicBool,
    pub pending_show: AtomicBool,
}

// ============================================================
// AppState
// ============================================================

pub struct AppState {
    pub questions: HashMap<String, Question>,
    // Channel: MCP -> UI events (N senders, 1 receiver)
    pub mcp_to_ui_tx: mpsc::UnboundedSender<McpToUiEvent>,

    // Notify: wakes blocked wait_for_answers calls
    pub state_changed: Arc<Notify>,

    // Notify: fires when the UI window is closed
    pub window_closed: Arc<Notify>,

    // Persistent flag: true after window is closed (survives missed Notify)
    pub window_closed_flag: Arc<AtomicBool>,

    // Instant answer delivery tracking
    pub delivered_instant_ids: HashSet<String>,

    // ID generation
    id_counter: u32,
}

impl AppState {
    // ------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------
    pub fn new() -> (Self, mpsc::UnboundedReceiver<McpToUiEvent>, Arc<AtomicBool>, Arc<Notify>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let window_closed_flag = Arc::new(AtomicBool::new(false));
        let window_closed = Arc::new(Notify::new());

        let state = Self {
            questions: HashMap::new(),
            mcp_to_ui_tx: tx,
            state_changed: Arc::new(Notify::new()),
            window_closed: window_closed.clone(),
            window_closed_flag: window_closed_flag.clone(),
            delivered_instant_ids: HashSet::new(),
            id_counter: 0,
        };

        (state, rx, window_closed_flag, window_closed)
    }

    // ------------------------------------------------------------
    // Generate next question ID (simple incrementing integer)
    // ------------------------------------------------------------
    pub fn next_id(&mut self) -> String {
        self.id_counter += 1;
        self.id_counter.to_string()
    }
}

// ============================================================
// Helpers
// ============================================================

// ------------------------------------------------------------
// Current time in milliseconds since UNIX epoch
// ------------------------------------------------------------
pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
