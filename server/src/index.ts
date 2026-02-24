#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, getPipePath } from "./config.js";
import { QuestionStore } from "./question-store.js";
import { PipeClient } from "./pipe-client.js";
import { createMcpServer } from "./mcp-server.js";
import { launchTauri, connectWithRetry } from "./tauri-launcher.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  logger.info("AsQu MCP Server v0.0.1 starting...");

  // Load config
  const config = loadConfig();
  const pipePath = getPipePath(config);
  logger.info(`Pipe path: ${pipePath}`);

  // Generate session identity
  const sessionId = randomUUID();
  const sessionCwd = process.cwd();
  const sessionName = basename(sessionCwd);
  logger.info(`Session: ${sessionName} (${sessionId})`);

  // Create core components
  const store = new QuestionStore();
  const pipeClient = new PipeClient();

  // Wire up pipe events -> store
  pipeClient.on("answer", (questionId: string, answer: unknown) => {
    store.applyAnswer(questionId, answer as import("./types.js").QuestionAnswer);
  });

  pipeClient.on("denied", (questionIds: string[], reason: string) => {
    store.applyDenied(questionIds, reason);
  });

  let reconnecting = false;
  pipeClient.on("disconnected", async () => {
    if (reconnecting) return;
    reconnecting = true;
    logger.warn("Pipe disconnected from Tauri — will keep retrying...");

    // Retry indefinitely every 3 seconds until reconnected
    while (true) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        await pipeClient.connect(pipePath);
        break;
      } catch {
        launchTauri(config);
      }
    }

    reconnecting = false;
    logger.info("Reconnected to Tauri pipe");
    const pending = store.getQuestionsByStatus("pending");
    if (pending.length > 0) {
      logger.info(`Re-sending ${pending.length} pending question(s) to Tauri`);
      pipeClient.sendQuestionsBatch(pending, sessionName, sessionCwd);
    }
  });

  // Connect to Tauri pipe (with auto-launch)
  const connected = await connectWithRetry(
    () => pipeClient.connect(pipePath),
    () => launchTauri(config)
  );

  if (!connected) {
    logger.warn(
      "Could not connect to Tauri. Server will operate in standalone mode (questions stored locally)."
    );
  }

  // Create and start MCP server
  const mcpServer = createMcpServer(
    store,
    pipeClient,
    sessionId,
    sessionName,
    sessionCwd
  );

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logger.info("MCP server running via stdio");

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    pipeClient.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down...");
    pipeClient.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
