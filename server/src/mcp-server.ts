import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QuestionStore } from "./question-store.js";
import type { PipeClient } from "./pipe-client.js";
import { logger } from "./logger.js";

// Strip undefined, null, empty arrays, false from response JSON
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === false) continue;
    if (value === "") continue;
    result[key] = value;
  }
  return result;
}

export function createMcpServer(
  store: QuestionStore,
  pipeClient: PipeClient,
  sessionId: string,
  sessionName: string,
  sessionCwd: string
): McpServer {
  const server = new McpServer({
    name: "AsQu",
    version: "0.0.1",
  });

  // === Tool 1: ask ===
  server.registerTool(
    "ask",
    {
      title: "Ask Questions",
      description: `Submit questions to the async queue. Returns question IDs immediately (non-blocking).
The UI sorts by priority (critical first), so assign higher priority to complex decisions.
- critical: blocking architectural/design decisions
- high: important choices that affect multiple components
- normal: standard questions (default)
- low: simple confirmations, cosmetic preferences

Omit choices for freeform text input. Set multiSelect=true when multiple choices are valid.`,
      inputSchema: {
        questions: z
          .array(
            z.object({
              text: z.string().describe("Question text to display"),
              header: z
                .string()
                .max(12)
                .optional()
                .describe("Short label tag (max 12 chars) shown in tab"),
              choices: z
                .array(
                  z.object({
                    label: z.string().describe("Choice label"),
                    description: z
                      .string()
                      .optional()
                      .describe("Description shown below label"),
                    markdown: z
                      .string()
                      .optional()
                      .describe("Preview content for inspector panel"),
                    multiSelect: z
                      .boolean()
                      .optional()
                      .describe("Override question-level multiSelect for this choice"),
                  })
                )
                .optional()
                .describe("Choice list. Omit for freeform text input"),
              multiSelect: z
                .boolean()
                .default(false)
                .describe("Allow multiple selections"),
              allowOther: z
                .boolean()
                .default(true)
                .describe("Show 'Other...' free-text option"),
              context: z
                .string()
                .optional()
                .describe("Additional context shown as info block"),
              instant: z
                .boolean()
                .default(false)
                .describe("Instant question — answering immediately unblocks wait_for_answers"),
              priority: z
                .enum(["critical", "high", "normal", "low"])
                .default("normal")
                .describe("Question priority for UI sorting"),
            })
          )
          .min(1)
          .describe("Array of questions to submit"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ questions }) => {
      const added = questions.map((q) => store.addQuestion(sessionId, q));

      // Send to Tauri via pipe
      if (pipeClient.connected) {
        if (added.length === 1) {
          pipeClient.sendQuestion(added[0], sessionName, sessionCwd);
        } else {
          pipeClient.sendQuestionsBatch(added, sessionName, sessionCwd);
        }
      } else {
        logger.warn("Pipe not connected, questions stored locally only");
      }

      const result = compact({
        ids: added.map((q) => q.id),
        pending: store.getPendingCount(),
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }
  );

  // === Tool 2: get_answers ===
  server.registerTool(
    "get_answers",
    {
      title: "Get Answers",
      description: `Check for answered questions (non-blocking polling).
Returns current state of specified questions: answered, denied, or still pending.
Use wait_for_answers instead if you need to block until answers arrive.`,
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .describe("Question IDs to check"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ ids }) => {
      const result = compact({ ...store.getAnswers(ids) });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }
  );

  // === Tool 3: wait_for_answers ===
  server.registerTool(
    "wait_for_answers",
    {
      title: "Wait for Answers",
      description: `Wait for specific question answers (BLOCKING).
Blocks until answers are available or timeout expires.
- require_all=true: wait until ALL specified questions are answered/denied
- require_all=false: return as soon as ANY question is answered/denied
Returns partial results on timeout with timed_out=true.`,
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .describe("Question IDs to wait for"),
        require_all: z
          .boolean()
          .default(true)
          .describe("Wait for all questions (true) or any (false)"),
        timeout_seconds: z
          .number()
          .int()
          .min(1)
          .max(3600)
          .optional()
          .describe("Timeout in seconds (default: no timeout)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ ids, require_all, timeout_seconds }) => {
      const result = await store.waitForAnswers(
        ids,
        require_all,
        timeout_seconds
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(compact({ ...result })) }],
      };
    }
  );

  // === Tool 4: list_questions ===
  server.registerTool(
    "list_questions",
    {
      title: "List Questions",
      description: `Query the question queue status (non-blocking).
Filter by status to see pending, answered, dismissed, or denied questions.
Returns question metadata without full answer details.`,
      inputSchema: {
        status: z
          .enum(["pending", "answered", "expired", "dismissed", "denied"])
          .optional()
          .describe("Filter by status (omit for all)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status }) => {
      const questions = store.getQuestionsByStatus(status);
      const result = {
        questions: questions.map((q) => compact({
          id: q.id,
          text: q.text,
          header: q.header,
          priority: q.priority,
          status: q.status,
          created_at: q.created_at,
          answered_at: q.answered_at,
        })),
        total: questions.length,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }
  );

  // === Tool 5: dismiss_questions ===
  server.registerTool(
    "dismiss_questions",
    {
      title: "Dismiss Questions",
      description: `Remove pending questions that are no longer needed (non-blocking).
Dismissed questions will be removed from the UI and marked as dismissed.
Only pending questions can be dismissed.`,
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .describe("Question IDs to dismiss"),
        reason: z
          .string()
          .optional()
          .describe("Reason for dismissal"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ ids, reason }) => {
      const dismissed = store.dismissQuestions(ids, reason);

      // Notify Tauri
      if (pipeClient.connected && dismissed.length > 0) {
        pipeClient.sendDismiss(dismissed, reason);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(compact({
              dismissed,
              notFound: ids.filter((id: string) => !dismissed.includes(id)),
            })),
          },
        ],
      };
    }
  );

  return server;
}
