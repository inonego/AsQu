# AsQu

**Async Question Queue for Claude Code**

Claude Code's built-in `AskUserQuestion` is blocking — after asking, it waits for your answer and can't do anything else. AsQu replaces that with an async question queue. Claude pushes questions and keeps working; you answer when ready; Claude only blocks when it actually needs the answers.

## Installation

### Prerequisites

- **Node.js** >= 20
- **Rust** toolchain ([rustup](https://rustup.rs/))
- **Windows 11** (Windows Named Pipes; Unix support planned)

### Build

```bash
# 1. Build the MCP server
cd server
npm install
npm run build

# 2. Build the Tauri app
cd ../app
npm install
npm run tauri build
```

The Tauri binary will be at `app/src-tauri/target/release/asqu.exe`.

### Configure Claude Code

Add to your Claude Code MCP settings (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "AsQu": {
      "command": "node",
      "args": ["<path-to-AsQu>/server/build/index.js"]
    }
  }
}
```

That's it. The MCP server auto-launches the Tauri app on first use.

## MCP Tools

### `ask` — Submit questions (non-blocking)

Push questions to the queue. Returns question IDs immediately.

```json
{
  "questions": [
    {
      "text": "Which database for the session store?",
      "header": "database",
      "choices": [
        { "label": "PostgreSQL", "description": "ACID compliant" },
        { "label": "Redis", "description": "Sub-ms reads", "markdown": "```\nIn-memory key-value store\n```" }
      ],
      "multiSelect": false,
      "allowOther": true,
      "context": "Need sub-10ms reads, ~100K items",
      "priority": "critical",
      "instant": false
    }
  ]
}
```

| Field | Default | Description |
|---|---|---|
| `text` | required | Question text |
| `header` | — | Tab label (max 12 chars) |
| `choices` | — | Choice list. Omit for freeform text input |
| `choices[].label` | required | Choice label |
| `choices[].description` | — | Shown below label |
| `choices[].markdown` | — | Preview content in inspector panel |
| `choices[].multiSelect` | — | Override question-level multiSelect for this choice |
| `multiSelect` | `false` | Allow multiple selections |
| `allowOther` | `true` | Include "Other..." free text option |
| `context` | — | Additional context shown as info block |
| `priority` | `"normal"` | `critical` / `high` / `normal` / `low` |
| `instant` | `false` | When `true`, answering immediately unblocks `wait_for_answers` |

### `wait_for_answers` — Wait for answers (blocking)

Block until specific questions are answered.

| Field | Default | Description |
|---|---|---|
| `ids` | required | Question IDs to wait for |
| `require_all` | `true` | `true` = wait for all, `false` = return on first answer |
| `timeout_seconds` | — | Timeout in seconds (1–3600). Returns partial results with `timed_out: true` on expiry |

### `get_answers` — Check answers (non-blocking)

Poll for answers without blocking. Same response format as `wait_for_answers`.

| Field | Description |
|---|---|
| `ids` | Question IDs to check |

### `list_questions` — Query queue status

| Field | Description |
|---|---|
| `status` | Filter: `pending` / `answered` / `dismissed` / `denied` (omit for all) |

### `dismiss_questions` — Remove questions

| Field | Description |
|---|---|
| `ids` | Question IDs to dismiss |
| `reason` | Optional reason string |

## Usage Pattern

```
Claude:  ask([q1, q2, q3])           -> IDs returned immediately
Claude:  ... keeps working ...
Claude:  ... keeps working ...
Claude:  wait_for_answers([q1, q2])  -> blocks here until user answers
User:    answers q1, q2 in the app
Claude:  ... gets answers, continues ...
Claude:  dismiss_questions([q3])     -> q3 no longer needed
```

## UI

Three-column layout: **Sessions** | **Question** | **Inspector**

- **Pending tab**: One question at a time with horizontal tabs for switching
- **History tab**: Card list of answered/dismissed questions
- **Inspector panel**: Markdown preview + confidence slider + notes per choice
- **System tray**: Click to toggle window, tray icon shows pending count
- **Keyboard**: `Enter` submit, `1-9` quick-select, `←/→` switch questions, `Esc` dismiss

## License

MIT
