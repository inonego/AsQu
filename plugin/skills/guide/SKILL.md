---
name: guide
description: >
  Async Ask Question Queue — use instead of AskUserQuestion for all user input/decisions.
  CLI-based: run asqu commands in Bash. Session auto-detected from CLAUDE_SESSION_ID env var.
  NOT for: plain-text question lists or brainstorming.
user-invocable: false
---

Re-read these instructions before first use each session.

## Session Setup

If `<asqu-session-id>` is present in your context (injected by the SessionStart hook), export it **once** before the first asqu command:

```bash
export CLAUDE_SESSION_ID=<value from asqu-session-id tag>
```

All asqu commands are then scoped to this session automatically.

## Commands

| Command | Description |
|---------|-------------|
| `asqu ask '<json>'` | Submit questions |
| `asqu wait [ids...] [--any] [--timeout <s>]` | Block until answered |
| `asqu get [ids...]` | Non-blocking snapshot |
| `asqu dismiss [ids...] [--reason <r>]` | Cancel questions |
| `asqu open` | Show the UI window |
| `asqu shutdown` | Gracefully shut down the GUI process |

### ask

Input is always a JSON array (even for a single question).

```bash
asqu ask '[
  {"text": "Which DB?", "choices": ["Postgres","SQLite"], "category": "DB", "priority": "critical"},
  {"text": "Auth method?", "choices": [{"label":"OAuth","description":"3rd-party"},{"label":"JWT"}], "instant": true},
  {"text": "Any notes?", "allowOther": false, "multiSelect": true, "context": "background info"}
]'
```

**Fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | string | **required** | Question text shown to the user |
| `header` | string | — | Section title displayed above the question |
| `choices` | `string[]` or `{label, description?}[]` | — | Answer options. Omit for free-text only |
| `allowOther` | bool | `true` | Allow free-text "Other…" even when choices are provided |
| `multiSelect` | bool | `false` | Allow selecting multiple choices |
| `instant` | bool | `false` | When answered, resolves the current `wait` immediately even if other questions are still pending |
| `context` | string | — | Background info shown below the question |
| `category` | string | — | Groups questions visually (e.g. `"DB"`, `"Auth"`, `"Deploy"`) |
| `priority` | `critical`\|`high`\|`normal`\|`low` | `normal` | Display priority |

**Output:**

```json
{ "result": "ask_ok", "ids": ["3", "4", "5"], "pending": 3 }
```

- `ids` — reference these in `wait` / `get` / `dismiss`
- `pending` — total pending count across the session; use this to calibrate next batch size

### wait

```bash
asqu wait              # block until all pending questions in this session are answered
asqu wait 3 4 5        # block until questions 3, 4, 5 are resolved
asqu wait --any        # unblock when any one question is answered or denied
asqu wait --timeout 60 # timeout after 60 seconds
```

**Output:**

```json
{
  "result": "answers_ok",
  "answered": [{ "id": "3", "answer": { "selections": {"0": {}, "2": {"confidence": 0.9, "note": "..."}}, "text": "free text" } }],
  "denied":   [{ "id": "4", "reason": "dismissed by user" }],
  "pending":  ["5"],
  "timedOut": true,
  "shutdown": true
}
```

Fields are omitted when empty. `timedOut` and `shutdown` are omitted when false.

- `selections` — keys are choice indices (`"0"`, `"1"`, …); value may include `confidence` (0–1) and `note`
- `text` — free-text answer (from "Other…" input or free-text-only questions)
- `denied` — user dismissed the question or session was removed
- `timedOut` — timeout elapsed before all questions resolved
- `shutdown` — app quit while waiting; treat as cancelled, questions are gone

### get

```bash
asqu get               # non-blocking snapshot of all questions in this session
asqu get 3 4           # snapshot for specific IDs
```

Output has the same shape as `wait`. Use `pending` IDs to resume after context loss.

### dismiss

```bash
asqu dismiss           # cancel all pending in this session
asqu dismiss 3 4       # cancel specific questions
asqu dismiss 3 --reason "no longer needed"
```

Output: `{ "result": "dismiss_ok", "dismissed": ["3", "4"] }`

## Rules

> **MUST** = mandatory. **SHOULD** = strongly recommended. **NEVER** = forbidden. **CAN** = optional.

### Asking

- **MUST** — one topic per question. Never bundle multiple decisions into one.
- **MUST** — "ask N questions" from user: N = **total count**; still apply batch limits below.
- **SHOULD** — provide `choices` whenever possible.
- **SHOULD** — include all realistic options; there is no maximum on choice count.
- **SHOULD** — use `category` to group related questions visually.
- **SHOULD** — ask the hardest, most blocking questions first to buy the user thinking time.
- **NEVER** — dump all questions in one call; always respect the batch size table.

### Batching

Submit questions in batches calibrated by `pending` from `ask_ok`:

| Pending | Next batch size |
|---------|----------------|
| 0–2     | 1              |
| 3–4     | 2              |
| 5–6     | 3              |
| 7+      | 4 (max)        |

After `wait` resolves, if `pending` is non-empty, submit the next batch before processing answers.

**NEVER** call `wait` after every single `ask`. Submit the full batch, then wait once:

```
# Correct — 8 questions, batched by the table
asqu ask '[q1]'         # pending=1
asqu ask '[q2]'         # pending=2
asqu ask '[q3]'         # pending=3
asqu ask '[q4, q5]'     # pending=5
asqu ask '[q6, q7, q8]' # pending=8
asqu wait               # one wait for all

# Wrong
asqu ask '[q1]'; asqu wait
asqu ask '[q2]'; asqu wait
```

### instant

`instant: true` on a question makes `wait` resolve immediately when **that specific question** is answered — even if other questions are still pending. This is different from `--any`:

| | Behavior |
|--|---------|
| `--any` flag on `wait` | unblocks on the first answer/denial of **any** question |
| `instant: true` on a question | the **specific question's** answer triggers early resolution |

- **MUST** — after `wait` resolves due to an instant answer, `pending` will be non-empty; call `asqu wait` again for the remaining IDs.
- **SHOULD** — mark `instant: true` on questions whose answer unblocks dependent follow-up questions, so you can submit them while the rest are still pending.

### Recovery

- **MUST** — if `wait` returns `timedOut: true` or unexpected `pending` IDs, use `AskUserQuestion` to check if the user wants to continue; optionally call `asqu open` to resurface the window.
- **MUST** — if `wait` returns `shutdown: true`, stop the current task and notify the user — questions are gone, do not re-ask.
- **MUST** — process `denied` answers; adapt your plan since the user dismissed those questions.
- **SHOULD** — after context loss (compaction/restart), run `asqu get` with no ids to recover pending IDs, then `asqu wait <ids...>` instead of re-asking.
- **CAN** — `asqu open` to reshow the UI if the user may have closed the window.
- **CAN** — `asqu dismiss` to cancel questions that are no longer needed.
