---
name: guide
description: >
  Async Ask Question Queue — use instead of AskUserQuestion for all user input/decisions.
  NOT for: plain-text question lists or brainstorming.
user-invocable: false
---

Re-read these instructions and load tools before first use.

## Tools

`ask` `get_answers` `wait_for_answers` `list_questions` `dismiss_questions` `open_ui`

## Rules

> **MUST** = mandatory. **SHOULD** = strongly recommended. **CAN** = optional. **NEVER** = forbidden.

### Tool Rules

#### ask

- **MUST** — determine **goal**: total questions across all rounds (e.g., user says "ask 200 questions" → goal=200).
- **MUST** — determine **per-round**: questions to submit in each round (e.g., 8 per round).
- **MUST** — split each **per-round** batch into multiple **batches** based on current **pending** count:

| Currently pending | Next batch size |
|-------------------|-----------------|
| 0-2               | 1               |
| 3-4               | 2               |
| 5-6               | 3               |
| 7+                | 4 (max)         |

- **NEVER** — submit all per-round questions in a single call.

```
Example: goal=200, per-round=8
Round 1:
  ask([q1])       → pending=1
  ask([q2])       → pending=2
  ask([q3])       → pending=3
  ask([q4,q5])    → pending=5
  ask([q6,q7,q8]) → pending=8
  wait([q1..q8])   → collect answers
Round 2: (repeat with q9-q16, etc.)
```

#### wait_for_answers

- **MUST** — call after **all** questions are submitted. Always. No exceptions.
- **NEVER** — call wait per batch. Submit all, then wait once.

```
DO    ask(q1) → ... → ask(qN) → wait([q1...qN])
NEVER ask(q1) → wait([q1]) → ask(q2) → wait([q2])
```

#### dismiss_questions

- **CAN** — cancel unneeded questions.

#### open_ui

- **CAN** — reshow the window if user may have closed it.

### Guidelines

#### Content

- **SHOULD** — one topic per question: `{ text: "Which DB?" }`
- **SHOULD** — provide `choices` whenever possible.
- **NOTE** — no maximum on choice count. Provide as many as needed to cover the realistic options.
- **NEVER** — bundle multiple topics: `{ text: "Which DB and auth and deploy?" }`

#### Priority

- **SHOULD** — ask hardest, most decision-heavy questions first to buy the user thinking time.

#### Category

- **SHOULD** — use `category` to group related questions (e.g. `"DB"`, `"Auth"`, `"Deploy"`).

#### Instant

- **MUST** — check `instant_answers` in every tool response. Process them, then `wait` again for remaining IDs.
- **SHOULD** — mark key questions or last question of each category as `instant: true` to enable follow-ups while waiting.
- **NOTE** — new follow-up questions from `instant_answers` may change per-round.

#### Recovery

- **MUST** — if `wait_for_answers()` returns early with pending questions (window closed), use `AskUserQuestion` (not `ask`) to ask whether to reopen via `open_ui`.
