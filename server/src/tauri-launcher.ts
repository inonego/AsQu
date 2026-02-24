import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AsQuConfig } from "./types.js";
import { logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findTauriBinary(config: AsQuConfig): string | null {
  // 1. Explicit config path
  if (config.tauriPath && existsSync(config.tauriPath)) {
    return config.tauriPath;
  }

  // 2. Relative to project root: app/src-tauri/target/release/asqu.exe (or debug)
  const projectRoot = resolve(__dirname, "..", "..");
  const candidates = [
    resolve(projectRoot, "app", "src-tauri", "target", "release", "asqu.exe"),
    resolve(projectRoot, "app", "src-tauri", "target", "debug", "asqu.exe"),
    // Non-windows
    resolve(projectRoot, "app", "src-tauri", "target", "release", "asqu"),
    resolve(projectRoot, "app", "src-tauri", "target", "debug", "asqu"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function launchTauri(config: AsQuConfig): boolean {
  const binary = findTauriBinary(config);
  if (!binary) {
    logger.error("Tauri binary not found. Please build the Tauri app first.");
    return false;
  }

  logger.info(`Launching Tauri: ${binary}`);

  const child = spawn(binary, [], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  logger.info(`Tauri launched (PID: ${child.pid})`);
  return true;
}

export async function connectWithRetry(
  connectFn: () => Promise<void>,
  launchFn: () => boolean,
  maxRetries = 10,
  baseDelayMs = 300
): Promise<boolean> {
  // First try: connect directly
  try {
    await connectFn();
    return true;
  } catch {
    logger.info("Pipe not available, launching Tauri...");
  }

  // Launch Tauri
  const launched = launchFn();
  if (!launched) {
    return false;
  }

  // Retry with exponential backoff
  for (let i = 0; i < maxRetries; i++) {
    const delay = Math.min(baseDelayMs * Math.pow(1.5, i), 2000);
    await sleep(delay);

    try {
      await connectFn();
      return true;
    } catch {
      logger.debug(`Connection attempt ${i + 1}/${maxRetries} failed, retrying...`);
    }
  }

  logger.error("Failed to connect to Tauri after retries");
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
