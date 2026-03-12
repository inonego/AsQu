---
name: deep-dive
description: >
  Infinite AsQu questioning loop — keeps generating follow-up questions until the user stops.
  Triggers: "deep dive", "infinite ask", "keep asking", or /deep-dive.
---

Enter plan mode, then run an infinite AsQu questioning loop.

## Flow

1. Enter plan mode via `EnterPlanMode`.
2. Resolve topic: check arguments → conversation context → ask via AsQu.
3. Loop until stopped:
   - Generate follow-up questions based on all answers so far.
   - Submit via AsQu `ask`, wait via `wait_for_answers`.
   - On any answer containing a stop word → exit loop.
4. Write a plan summarizing collected Q&A and insights → `ExitPlanMode`.

## Stop Words

Exit the loop when any answer text contains: `stop`, `done`, `quit`, `exit`.
