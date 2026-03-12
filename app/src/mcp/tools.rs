// ============================================================
// mcp/tools.rs — MCP tool definitions using rmcp macros
// ============================================================

use std::collections::HashSet;

use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::{Json, Parameters},
    model::*,
    schemars, tool, tool_handler, tool_router,
};

use crate::question_store;
use crate::state::SharedState;
use crate::types::{
    AskResponse, AnswersResponse, DismissResponse, ListQuestionsResponse,
    OpenUiResponse, Priority, QuestionChoice, QuestionStatus, QuestionSummary,
};

// ============================================================
// Input Schemas (serde + schemars for rmcp)
// ============================================================

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AskQuestionItem {
    /// Question text to display
    pub text: String,

    /// Short label tag (max 12 chars) shown in tab
    #[serde(default)]
    pub header: Option<String>,

    /// Choice list. Omit for freeform text input
    #[serde(default)]
    pub choices: Option<Vec<ChoiceInput>>,

    /// Show 'Other...' free-text option (default: true)
    #[serde(default = "default_true")]
    pub allow_other: bool,

    /// Allow multiple choice selections (default: false = single-select)
    #[serde(default)]
    pub multi_select: bool,

    /// Additional context shown as info block
    #[serde(default)]
    pub context: Option<String>,

    /// Category for grouping questions in the sidebar
    #[serde(default)]
    pub category: Option<String>,

    /// Instant question — answering immediately unblocks wait_for_answers
    #[serde(default)]
    pub instant: bool,

    /// Question priority (critical, high, normal, low)
    #[serde(default)]
    pub priority: PriorityInput,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ChoiceInput {
    /// Choice label
    pub label: String,

    /// Description shown below label
    #[serde(default)]
    pub description: Option<String>,

    /// Preview content for inspector panel
    #[serde(default)]
    pub markdown: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PriorityInput {
    Critical,
    High,
    #[default]
    Normal,
    Low,
}

impl From<PriorityInput> for Priority {
    fn from(p: PriorityInput) -> Self {
        match p {
            PriorityInput::Critical => Priority::Critical,
            PriorityInput::High => Priority::High,
            PriorityInput::Normal => Priority::Normal,
            PriorityInput::Low => Priority::Low,
        }
    }
}

// ------------------------------------------------------------
// Custom deserializer: accepts Vec<AskQuestionItem> OR a JSON-encoded
// string of the same. Handles double-serialization from MCP clients
// that mistakenly stringify the array (e.g. Claude Code with non-ASCII).
// ------------------------------------------------------------
fn deserialize_questions<'de, D>(deserializer: D) -> Result<Vec<AskQuestionItem>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, SeqAccess, Visitor};
    use std::fmt;

    struct QuestionsVisitor;

    impl<'de> Visitor<'de> for QuestionsVisitor {
        type Value = Vec<AskQuestionItem>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("an array of questions, or a JSON-encoded string of an array")
        }

        fn visit_seq<A>(self, seq: A) -> Result<Vec<AskQuestionItem>, A::Error>
        where
            A: SeqAccess<'de>,
        {
            serde::Deserialize::deserialize(de::value::SeqAccessDeserializer::new(seq))
        }

        fn visit_str<E>(self, v: &str) -> Result<Vec<AskQuestionItem>, E>
        where
            E: de::Error,
        {
            serde_json::from_str(v).map_err(de::Error::custom)
        }
    }

    deserializer.deserialize_any(QuestionsVisitor)
}

// ------------------------------------------------------------
// Custom deserializer: accepts Vec<String> OR a JSON-encoded string of the
// same. Handles double-serialization from MCP clients (e.g. Claude Code).
// ------------------------------------------------------------
fn deserialize_string_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, SeqAccess, Visitor};
    use std::fmt;

    struct StringVecVisitor;

    impl<'de> Visitor<'de> for StringVecVisitor {
        type Value = Vec<String>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("an array of strings, or a JSON-encoded string of an array")
        }

        fn visit_seq<A>(self, seq: A) -> Result<Vec<String>, A::Error>
        where
            A: SeqAccess<'de>,
        {
            serde::Deserialize::deserialize(de::value::SeqAccessDeserializer::new(seq))
        }

        fn visit_str<E>(self, v: &str) -> Result<Vec<String>, E>
        where
            E: de::Error,
        {
            serde_json::from_str(v).map_err(de::Error::custom)
        }
    }

    deserializer.deserialize_any(StringVecVisitor)
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AskParams {
    /// Array of questions to submit
    #[serde(deserialize_with = "deserialize_questions")]
    pub questions: Vec<AskQuestionItem>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct IdsParams {
    /// Question IDs to check
    #[serde(deserialize_with = "deserialize_string_vec")]
    pub ids: Vec<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct WaitParams {
    /// Question IDs to wait for
    #[serde(deserialize_with = "deserialize_string_vec")]
    pub ids: Vec<String>,

    /// Wait for all questions (true) or any (false)
    #[serde(default = "default_true")]
    pub require_all: bool,

    /// Timeout in seconds (default: no timeout)
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListParams {
    /// Filter by status (omit for all)
    #[serde(default)]
    pub status: Option<StatusInput>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum StatusInput {
    Pending,
    Answered,
    Dismissed,
    Denied,
}

impl From<StatusInput> for QuestionStatus {
    fn from(s: StatusInput) -> Self {
        match s {
            StatusInput::Pending => QuestionStatus::Pending,
            StatusInput::Answered => QuestionStatus::Answered,
            StatusInput::Dismissed => QuestionStatus::Dismissed,
            StatusInput::Denied => QuestionStatus::Denied,
        }
    }
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DismissParams {
    /// Question IDs to dismiss
    #[serde(deserialize_with = "deserialize_string_vec")]
    pub ids: Vec<String>,

    /// Reason for dismissal
    #[serde(default)]
    pub reason: Option<String>,
}

// ============================================================
// AsQuMcpServer
// ============================================================

#[derive(Clone)]
pub struct AsQuMcpServer {
    state: SharedState,
    session_id: String,
    #[allow(dead_code)]
    session_name: String,
    #[allow(dead_code)]
    session_cwd: String,
    tool_router: ToolRouter<Self>,
}

// ============================================================
// Tool Implementations
// ============================================================

#[tool_router]
impl AsQuMcpServer {
    // ------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------
    pub fn new(
        state: SharedState,
        session_id: String,
        session_name: String,
        session_cwd: String,
    ) -> Self {
        Self {
            state,
            session_id,
            session_name,
            session_cwd,
            tool_router: Self::tool_router(),
        }
    }

    // ------------------------------------------------------------
    // ask — Submit questions to the user's queue
    // ------------------------------------------------------------
    #[tool(description = "Submit questions to the user's AsQu queue. Returns question IDs for tracking. Questions appear in the desktop UI for the user to answer at their pace. Supports: free-text, single-choice, multi-choice, instant (priority) questions. Use 'category' to group related questions in the sidebar.")]
    async fn ask(
        &self,
        Parameters(params): Parameters<AskParams>,
    ) -> Result<Json<AskResponse>, McpError> {
        let mut state = self.state.lock().await;

        // Add all questions
        let mut added = Vec::new();
        for q in params.questions {
            // Truncate header to 12 characters (char-safe for multi-byte UTF-8)
            let header = q.header.map(|h| {
                if h.chars().count() > 12 {
                    h.chars().take(12).collect()
                } else {
                    h
                }
            });

            let choices = q.choices.map(|cs| {
                cs.into_iter()
                    .map(|c| QuestionChoice {
                        label: c.label,
                        description: c.description,
                        markdown: c.markdown,
                    })
                    .collect()
            });

            let question = state.add_question(
                &self.session_id,
                q.text,
                header,
                choices,
                q.allow_other,
                q.multi_select,
                q.instant,
                q.context,
                q.category,
                q.priority.into(),
            );
            added.push(question);
        }

        // Emit UI events
        if added.len() == 1 {
            state.emit_question_added(&added[0]);
        } else {
            state.emit_questions_batch(&added);
        }

        let pending = state.get_pending_count();
        let instant_answers = state.collect_instant_answers(None);
        let ids = added.iter().map(|q| q.id.clone()).collect();

        Ok(Json(AskResponse {
            ids,
            pending,
            instant_answers,
        }))
    }

    // ------------------------------------------------------------
    // get_answers — Non-blocking poll for answer status
    // ------------------------------------------------------------
    #[tool(description = "Non-blocking check for answers to previously submitted questions. Returns current status (answered/denied/pending) without waiting.")]
    async fn get_answers(
        &self,
        Parameters(params): Parameters<IdsParams>,
    ) -> Result<Json<AnswersResponse>, McpError> {
        let mut state = self.state.lock().await;
        let result = state.get_answers(&params.ids);
        let instant = state.collect_instant_answers(None);

        Ok(Json(AnswersResponse::from_result(result, instant)))
    }

    // ------------------------------------------------------------
    // wait_for_answers — Blocking wait with timeout
    // ------------------------------------------------------------
    #[tool(description = "Block until answers arrive for the specified question IDs. Use require_all=true to wait for all questions, false for any. Instant questions can unblock require_all=true early. Optional timeout_seconds prevents infinite blocking.")]
    async fn wait_for_answers(
        &self,
        Parameters(params): Parameters<WaitParams>,
    ) -> Result<Json<AnswersResponse>, McpError> {
        // Release Mutex during wait (free async function)
        let result = question_store::wait_for_answers(
            &self.state,
            params.ids,
            params.require_all,
            params.timeout_seconds,
        )
        .await;

        // Mark instant answers from wait result as delivered
        let answered_ids: HashSet<String> =
            result.answered.iter().map(|a| a.id.clone()).collect();
        {
            let mut state = self.state.lock().await;
            let instant_ids: Vec<String> = result
                .answered
                .iter()
                .filter(|a| state.questions.get(&a.id).map_or(false, |q| q.instant))
                .map(|a| a.id.clone())
                .collect();
            state.mark_instant_delivered(&instant_ids);

            let instant = state.collect_instant_answers(Some(&answered_ids));

            Ok(Json(AnswersResponse::from_result(result, instant)))
        }
    }

    // ------------------------------------------------------------
    // list_questions — List questions by status
    // ------------------------------------------------------------
    #[tool(description = "List all questions in the current session, optionally filtered by status. Returns question metadata (id, text, header, priority, status, timestamps).")]
    async fn list_questions(
        &self,
        Parameters(params): Parameters<ListParams>,
    ) -> Result<Json<ListQuestionsResponse>, McpError> {
        let mut state = self.state.lock().await;

        let status = params.status.map(QuestionStatus::from);
        let questions: Vec<QuestionSummary> = state
            .get_questions_by_status(status)
            .iter()
            .map(|q| QuestionSummary {
                id: q.id.clone(),
                text: q.text.clone(),
                status: q.status,
                created_at: q.created_at,
                header: q.header.clone(),
                priority: if q.priority != Priority::Normal {
                    Some(q.priority)
                } else {
                    None
                },
                answered_at: q.answered_at,
            })
            .collect();

        let total = questions.len();
        let instant_answers = state.collect_instant_answers(None);

        Ok(Json(ListQuestionsResponse {
            questions,
            total,
            instant_answers,
        }))
    }

    // ------------------------------------------------------------
    // dismiss_questions — Cancel pending questions
    // ------------------------------------------------------------
    #[tool(description = "Cancel pending questions that are no longer needed. Dismissed questions are removed from the user's queue.")]
    async fn dismiss_questions(
        &self,
        Parameters(params): Parameters<DismissParams>,
    ) -> Result<Json<DismissResponse>, McpError> {
        let mut state = self.state.lock().await;
        let dismissed = state.dismiss_questions(&params.ids, params.reason.as_deref());

        let not_found: Vec<String> = params
            .ids
            .iter()
            .filter(|id| !dismissed.contains(id))
            .cloned()
            .collect();

        let instant_answers = state.collect_instant_answers(None);

        Ok(Json(DismissResponse {
            dismissed,
            not_found,
            instant_answers,
        }))
    }

    // ------------------------------------------------------------
    // open_ui — Show the desktop window
    // ------------------------------------------------------------
    #[tool(description = "Show the AsQu desktop window. Use when the user wants to see the UI.")]
    async fn open_ui(&self) -> Result<Json<OpenUiResponse>, McpError> {
        let state = self.state.lock().await;
        let _ = state.mcp_to_ui_tx.send(crate::types::McpToUiEvent::ShowWindow);

        Ok(Json(OpenUiResponse { ok: true }))
    }
}

// ============================================================
// ServerHandler Implementation
// ============================================================

#[tool_handler]
impl ServerHandler for AsQuMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("AsQu is an async question queue. Use this instead of AskUserQuestion whenever you need input or answers from the user. MUST load the 'asqu' skill (/asqu:guide) before first use.".to_string())
    }
}
