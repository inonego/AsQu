use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::sync::Mutex;

const PIPE_NAME: &str = r"\\.\pipe\asqu-mcp-ipc";

// === IPC Protocol Types ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "new_question")]
    NewQuestion {
        question: Question,
        #[serde(rename = "sessionName")]
        session_name: String,
        #[serde(rename = "sessionCwd")]
        session_cwd: String,
    },
    #[serde(rename = "new_questions_batch")]
    NewQuestionsBatch {
        questions: Vec<Question>,
        #[serde(rename = "sessionName")]
        session_name: String,
        #[serde(rename = "sessionCwd")]
        session_cwd: String,
    },
    #[serde(rename = "dismiss_questions")]
    DismissQuestions {
        #[serde(rename = "questionIds")]
        question_ids: Vec<String>,
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "answer")]
    Answer {
        #[serde(rename = "questionId")]
        question_id: String,
        answer: QuestionAnswer,
    },
    #[serde(rename = "denied")]
    Denied {
        #[serde(rename = "questionIds")]
        question_ids: Vec<String>,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub text: String,
    pub header: Option<String>,
    pub choices: Option<Vec<QuestionChoice>>,
    #[serde(rename = "multiSelect")]
    pub multi_select: bool,
    #[serde(rename = "allowOther")]
    pub allow_other: bool,
    #[serde(default)]
    pub instant: bool,
    pub context: Option<String>,
    pub priority: String,
    pub status: String,
    pub created_at: u64,
    pub answered_at: Option<u64>,
    pub answer: Option<QuestionAnswer>,
    pub dismiss_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionChoice {
    pub label: String,
    pub description: Option<String>,
    pub markdown: Option<String>,
    #[serde(rename = "multiSelect")]
    pub multi_select: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionAnswer {
    #[serde(rename = "selectedIndices")]
    pub selected_indices: Vec<usize>,
    #[serde(rename = "choiceDetails")]
    pub choice_details: HashMap<String, ChoiceDetail>,
    #[serde(rename = "otherText")]
    pub other_text: Option<String>,
    #[serde(rename = "freeformText")]
    pub freeform_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChoiceDetail {
    pub confidence: Option<u8>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub cwd: String,
    #[serde(rename = "connectedAt")]
    pub connected_at: u64,
    pub status: String,
}

// State shared across pipe connections
struct AppState {
    // sessionId -> writer channel for sending messages back to MCP server
    writers: HashMap<String, tokio::sync::mpsc::UnboundedSender<String>>,
    sessions: HashMap<String, Session>,
    questions: HashMap<String, Question>,
    close_to_tray: bool,
}

type SharedState = Arc<Mutex<AppState>>;

// Shared shutdown signal
static SHUTDOWN: std::sync::OnceLock<Arc<tokio::sync::Notify>> = std::sync::OnceLock::new();

fn shutdown_notify() -> &'static Arc<tokio::sync::Notify> {
    SHUTDOWN.get_or_init(|| Arc::new(tokio::sync::Notify::new()))
}

fn graceful_exit(_app: &tauri::AppHandle) {
    // Spawn a thread so we don't block the tokio runtime
    // (tokio workers need to stay alive to process the shutdown notification)
    std::thread::spawn(|| {
        eprintln!("[AsQu Tauri] Shutting down — cleaning up pipe...");
        // Signal pipe server to drop pipe handles
        shutdown_notify().notify_waiters();
        // Wait for tokio task to process the notification and drop the pipe
        std::thread::sleep(std::time::Duration::from_millis(500));
        eprintln!("[AsQu Tauri] Pipe cleanup done, exiting.");
        std::process::exit(0);
    });
}

// === Events emitted to frontend ===

#[derive(Clone, Serialize)]
struct QuestionAddedEvent {
    question: Question,
    session: Session,
}

#[derive(Clone, Serialize)]
struct QuestionsBatchEvent {
    questions: Vec<Question>,
    session: Session,
}

#[derive(Clone, Serialize)]
struct QuestionsDismissedEvent {
    question_ids: Vec<String>,
    reason: Option<String>,
}

#[derive(Clone, Serialize)]
struct SessionUpdatedEvent {
    session: Session,
}

// === Tauri Commands ===

#[tauri::command]
async fn submit_answer(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    question_id: String,
    answer: QuestionAnswer,
) -> Result<(), String> {
    let mut state = state.lock().await;

    let question = state
        .questions
        .get_mut(&question_id)
        .ok_or("Question not found")?;
    let session_id = question.session_id.clone();

    // Update question status in state
    question.status = "answered".to_string();
    question.answered_at = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    );
    question.answer = Some(answer.clone());

    // Send answer back to MCP server via pipe
    let writer = state
        .writers
        .get(&session_id)
        .ok_or("Session not connected")?;

    let msg = ServerMessage::Answer {
        question_id: question_id.clone(),
        answer,
    };
    let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
    writer.send(json + "\n").map_err(|e| e.to_string())?;

    // Check if all pending = 0, auto-hide
    let pending_count = state
        .questions
        .values()
        .filter(|q| q.status == "pending")
        .count();

    drop(state);

    // Emit to frontend
    let _ = app.emit("question_answered", &question_id);

    if pending_count == 0 {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }

    Ok(())
}

#[tauri::command]
async fn dismiss_question(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    question_id: String,
) -> Result<(), String> {
    let mut state = state.lock().await;

    let question = state
        .questions
        .get_mut(&question_id)
        .ok_or("Question not found")?;
    let session_id = question.session_id.clone();

    question.status = "dismissed".to_string();

    // Send denied back to MCP server so it updates its store
    if let Some(writer) = state.writers.get(&session_id) {
        let msg = ServerMessage::Denied {
            question_ids: vec![question_id.clone()],
            reason: "dismissed_by_user".to_string(),
        };
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = writer.send(json + "\n");
        }
    }

    drop(state);

    let _ = app.emit("questions_dismissed", serde_json::json!({
        "question_ids": [question_id],
        "reason": "dismissed_by_user",
    }));

    Ok(())
}

#[tauri::command]
async fn delete_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    session_id: String,
) -> Result<(), String> {
    let mut state = state.lock().await;

    // Collect pending question IDs for this session
    let pending_ids: Vec<String> = state
        .questions
        .values()
        .filter(|q| q.session_id == session_id && q.status == "pending")
        .map(|q| q.id.clone())
        .collect();

    // Send denied to MCP server
    if !pending_ids.is_empty() {
        if let Some(writer) = state.writers.get(&session_id) {
            let msg = ServerMessage::Denied {
                question_ids: pending_ids.clone(),
                reason: "session_deleted".to_string(),
            };
            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = writer.send(json + "\n");
            }
        }
    }

    // Remove session and its questions
    state.sessions.remove(&session_id);
    state.writers.remove(&session_id);
    state
        .questions
        .retain(|_, q| q.session_id != session_id);

    let _ = app.emit("session_deleted", &session_id);

    Ok(())
}

#[tauri::command]
async fn get_state(
    state: tauri::State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    let state = state.lock().await;
    let sessions: Vec<&Session> = state.sessions.values().collect();
    let questions: Vec<&Question> = state.questions.values().collect();

    Ok(serde_json::json!({
        "sessions": sessions,
        "questions": questions,
    }))
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    show_window_internal(&app);
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
async fn get_close_to_tray(state: tauri::State<'_, SharedState>) -> Result<bool, String> {
    Ok(state.lock().await.close_to_tray)
}

#[tauri::command]
async fn set_close_to_tray(
    state: tauri::State<'_, SharedState>,
    value: bool,
) -> Result<(), String> {
    state.lock().await.close_to_tray = value;
    Ok(())
}

// === Named Pipe Server ===

async fn handle_client(
    app_handle: tauri::AppHandle,
    state: SharedState,
    reader_half: tokio::io::ReadHalf<tokio::net::windows::named_pipe::NamedPipeServer>,
    write_tx: tokio::sync::mpsc::UnboundedSender<String>,
    mut write_rx: tokio::sync::mpsc::UnboundedReceiver<String>,
    writer_half: tokio::io::WriteHalf<tokio::net::windows::named_pipe::NamedPipeServer>,
) {
    let mut reader = BufReader::new(reader_half);
    let mut writer = writer_half;
    let mut session_id: Option<String> = None;

    // Spawn writer task (sends messages back to MCP server)
    let writer_task = tokio::spawn(async move {
        while let Some(msg) = write_rx.recv().await {
            if writer.write_all(msg.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    // Read messages line by line
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                match serde_json::from_str::<ClientMessage>(trimmed) {
                    Ok(msg) => {
                        process_client_message(
                            &app_handle,
                            &state,
                            &msg,
                            &mut session_id,
                            &write_tx,
                        )
                        .await;
                    }
                    Err(e) => {
                        eprintln!("[AsQu Tauri] Failed to parse message: {e}");
                    }
                }
            }
            Err(e) => {
                eprintln!("[AsQu Tauri] Read error: {e}");
                break;
            }
        }
    }

    // Client disconnected - mark session idle
    if let Some(sid) = &session_id {
        let mut state = state.lock().await;
        if let Some(session) = state.sessions.get_mut(sid) {
            session.status = "idle".to_string();
            let _ = app_handle.emit(
                "session_updated",
                SessionUpdatedEvent {
                    session: session.clone(),
                },
            );
        }
        state.writers.remove(sid);
    }

    writer_task.abort();
    eprintln!("[AsQu Tauri] Client disconnected");
}

async fn process_client_message(
    app_handle: &tauri::AppHandle,
    state: &SharedState,
    msg: &ClientMessage,
    session_id: &mut Option<String>,
    write_tx: &tokio::sync::mpsc::UnboundedSender<String>,
) {
    match msg {
        ClientMessage::NewQuestion {
            question,
            session_name,
            session_cwd,
        } => {
            let mut state = state.lock().await;
            let sid = question.session_id.clone();

            // Auto-create session if first time seeing this sessionId
            if !state.sessions.contains_key(&sid) {
                let session = Session {
                    id: sid.clone(),
                    name: session_name.clone(),
                    cwd: session_cwd.clone(),
                    connected_at: question.created_at,
                    status: "connected".to_string(),
                };
                state.sessions.insert(sid.clone(), session.clone());
                let _ = app_handle.emit(
                    "session_created",
                    SessionUpdatedEvent {
                        session: session.clone(),
                    },
                );
            }

            // Register writer for this session (on first question)
            if session_id.is_none() {
                *session_id = Some(sid.clone());
                state.writers.insert(sid.clone(), write_tx.clone());
            }

            // Store question
            state
                .questions
                .insert(question.id.clone(), question.clone());

            let session = state.sessions.get(&sid).cloned().unwrap();

            let _ = app_handle.emit(
                "question_added",
                QuestionAddedEvent {
                    question: question.clone(),
                    session,
                },
            );

            drop(state);
            show_window_internal(app_handle);
        }
        ClientMessage::NewQuestionsBatch {
            questions,
            session_name,
            session_cwd,
        } => {
            let mut state = state.lock().await;

            if let Some(first) = questions.first() {
                let sid = first.session_id.clone();

                if !state.sessions.contains_key(&sid) {
                    let session = Session {
                        id: sid.clone(),
                        name: session_name.clone(),
                        cwd: session_cwd.clone(),
                        connected_at: first.created_at,
                        status: "connected".to_string(),
                    };
                    state.sessions.insert(sid.clone(), session.clone());
                    let _ = app_handle.emit(
                        "session_created",
                        SessionUpdatedEvent {
                            session: session.clone(),
                        },
                    );
                }

                if session_id.is_none() {
                    *session_id = Some(sid.clone());
                    state.writers.insert(sid.clone(), write_tx.clone());
                }

                for q in questions {
                    state.questions.insert(q.id.clone(), q.clone());
                }

                let session = state.sessions.get(&sid).cloned().unwrap();

                let _ = app_handle.emit(
                    "questions_batch",
                    QuestionsBatchEvent {
                        questions: questions.clone(),
                        session,
                    },
                );

                drop(state);
                show_window_internal(app_handle);
            }
        }
        ClientMessage::DismissQuestions {
            question_ids,
            reason,
        } => {
            let mut state = state.lock().await;
            for id in question_ids {
                if let Some(q) = state.questions.get_mut(id) {
                    q.status = "dismissed".to_string();
                    q.dismiss_reason = reason.clone();
                }
            }

            let _ = app_handle.emit(
                "questions_dismissed",
                QuestionsDismissedEvent {
                    question_ids: question_ids.clone(),
                    reason: reason.clone(),
                },
            );
        }
    }
}

fn show_window_internal(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();

        // Retry focus after short delay (Windows foreground restriction)
        let w = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let _ = w.set_focus();
            tokio::time::sleep(tokio::time::Duration::from_millis(400)).await;
            let _ = w.set_always_on_top(false);
        });
    }
}

async fn start_pipe_server(app_handle: tauri::AppHandle, state: SharedState) {
    // Single instance: try to create pipe, retry briefly for OS cleanup from previous exit
    let server = {
        let mut last_err = String::new();
        let mut result = None;
        for attempt in 1..=3 {
            match ServerOptions::new()
                .first_pipe_instance(true)
                .create(PIPE_NAME)
            {
                Ok(s) => { result = Some(s); break; }
                Err(e) => {
                    last_err = e.to_string();
                    if attempt < 3 {
                        eprintln!("[AsQu Tauri] Pipe busy (attempt {attempt}/3), waiting...");
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    }
                }
            }
        }
        match result {
            Some(s) => s,
            None => {
                eprintln!("[AsQu Tauri] Another instance is already running: {last_err}");
                std::process::exit(0);
            }
        }
    };

    eprintln!("[AsQu Tauri] Pipe server listening on {PIPE_NAME}");

    let shutdown = shutdown_notify().clone();

    // Accept first client (or shutdown)
    tokio::select! {
        result = server.connect() => {
            match result {
                Ok(()) => {
                    eprintln!("[AsQu Tauri] First client connected");
                    spawn_client_handler(&app_handle, &state, server);
                }
                Err(e) => {
                    eprintln!("[AsQu Tauri] Failed to accept first client: {e}");
                    return;
                }
            }
        }
        _ = shutdown.notified() => {
            drop(server);
            eprintln!("[AsQu Tauri] Pipe server shutdown (waiting for first client)");
            return;
        }
    }

    // Accept subsequent clients in a loop
    loop {
        let server = match ServerOptions::new().create(PIPE_NAME) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[AsQu Tauri] Failed to create pipe instance: {e}");
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                continue;
            }
        };

        tokio::select! {
            result = server.connect() => {
                match result {
                    Ok(()) => {
                        eprintln!("[AsQu Tauri] New client connected");
                        spawn_client_handler(&app_handle, &state, server);
                    }
                    Err(e) => {
                        eprintln!("[AsQu Tauri] Failed to accept client: {e}");
                        continue;
                    }
                }
            }
            _ = shutdown.notified() => {
                drop(server);
                eprintln!("[AsQu Tauri] Pipe server shutdown (accept loop)");
                return;
            }
        }
    }
}

fn spawn_client_handler(
    app_handle: &tauri::AppHandle,
    state: &SharedState,
    server: tokio::net::windows::named_pipe::NamedPipeServer,
) {
    let (read_half, write_half) = tokio::io::split(server);
    let (write_tx, write_rx) = tokio::sync::mpsc::unbounded_channel();

    let app_h = app_handle.clone();
    let state_c = state.clone();
    tauri::async_runtime::spawn(async move {
        handle_client(app_h, state_c, read_half, write_tx, write_rx, write_half).await;
    });
}

pub fn run() {
    // Atomic single-instance check via Windows named mutex — BEFORE window creation
    let _mutex = {
        use std::os::windows::ffi::OsStrExt;
        let name: Vec<u16> = std::ffi::OsStr::new("Global\\AsQu_SingleInstance")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let handle = windows_sys::Win32::System::Threading::CreateMutexW(
                std::ptr::null(),
                0,
                name.as_ptr(),
            );
            if handle.is_null()
                || windows_sys::Win32::Foundation::GetLastError()
                    == windows_sys::Win32::Foundation::ERROR_ALREADY_EXISTS
            {
                eprintln!("[AsQu Tauri] Another instance is already running, exiting.");
                std::process::exit(0);
            }
            handle
        }
    };

    let state: SharedState = Arc::new(Mutex::new(AppState {
        writers: HashMap::new(),
        sessions: HashMap::new(),
        questions: HashMap::new(),
        close_to_tray: true,
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            submit_answer,
            dismiss_question,
            delete_session,
            get_state,
            show_window,
            hide_window,
            get_close_to_tray,
            set_close_to_tray,
        ])
        .setup(move |app| {
            // Tray context menu
            let open_item = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            // System tray
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("AsQu")
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => { show_window_internal(app); }
                    "quit" => { graceful_exit(app); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                show_window_internal(app);
                            }
                        }
                    }
                })
                .build(app)?;

            // Handle native window close button (X) -> exit immediately
            let close_app = app.handle().clone();
            let window = app.get_webview_window("main").unwrap();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    graceful_exit(&close_app);
                }
            });

            // Start pipe server in background
            let app_handle = app.handle().clone();
            let state_clone = state.clone();
            tauri::async_runtime::spawn(async move {
                start_pipe_server(app_handle, state_clone).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
