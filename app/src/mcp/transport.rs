// ============================================================
// mcp/transport.rs — stdio transport setup
// ============================================================

use rmcp::ServiceExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::{error, info};

use crate::state::SharedState;

use super::tools::AsQuMcpServer;

// ------------------------------------------------------------
// Fix invalid \uXXXX escape sequences in a raw JSON line.
// Claude Code sometimes generates \u followed by non-hex chars
// (e.g. "\ucungsten"). Strip the backslash to produce valid JSON.
// Properly handles escaped backslashes (\\u is not a unicode escape).
// ------------------------------------------------------------
fn sanitize_unicode_escapes(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let n = chars.len();
    let mut result = String::with_capacity(n + 16);
    let mut i = 0;

    while i < n {
        if chars[i] != '\\' {
            result.push(chars[i]);
            i += 1;
            continue;
        }

        // chars[i] == '\\'
        if i + 1 >= n {
            result.push('\\');
            i += 1;
            continue;
        }

        match chars[i + 1] {
            '\\' => {
                // Escaped backslash: consume both, keep both
                result.push('\\');
                result.push('\\');
                i += 2;
            }
            'u' => {
                // Unicode escape: keep \u only if followed by exactly 4 hex digits
                let valid = n > i + 5
                    && chars[i + 2].is_ascii_hexdigit()
                    && chars[i + 3].is_ascii_hexdigit()
                    && chars[i + 4].is_ascii_hexdigit()
                    && chars[i + 5].is_ascii_hexdigit();
                if valid {
                    result.push('\\');
                }
                // Advance past the backslash; 'u' and subsequent chars handled next
                i += 1;
            }
            _ => {
                // Other escape sequences (\", \n, \r, \t, \b, \f, \/): keep as-is
                result.push('\\');
                i += 1;
            }
        }
    }
    result
}

// ------------------------------------------------------------
// Start the MCP server on stdin/stdout
// ------------------------------------------------------------
pub async fn start_mcp_server(
    state: SharedState,
    session_id: String,
    session_name: String,
    session_cwd: String,
) {
    info!("MCP server starting on stdio");

    let handler = AsQuMcpServer::new(
        state.clone(),
        session_id,
        session_name,
        session_cwd,
    );

    // Wrap stdin with a sanitizer that fixes invalid JSON unicode escapes.
    // duplex creates a connected pair: we write to write_end, rmcp reads from read_end.
    let (mut write_end, read_end) = tokio::io::duplex(512 * 1024);
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(tokio::io::stdin());
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let fixed = sanitize_unicode_escapes(&line);
                    if write_end.write_all(fixed.as_bytes()).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    match handler.serve((read_end, tokio::io::stdout())).await {
        Ok(service) => {
            info!("MCP server connected");

            // Block until stdin closes (Claude Code disconnects)
            let _ = service.waiting().await;

            info!("MCP stdin closed — exiting");
            std::process::exit(0);
        }
        Err(e) => {
            error!("MCP server failed to start: {:?}", e);
        }
    }
}
