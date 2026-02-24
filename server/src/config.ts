import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AsQuConfig } from "./types.js";
import { logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG: AsQuConfig = {
  pipe: {
    name: "asqu-mcp-ipc",
  },
  ui: {
    theme: "dark",
    autoFocus: true,
    autoHide: true,
  },
  tauriPath: "",
};

export function loadConfig(): AsQuConfig {
  // config.json is at project root (AsQu/config.json)
  // server/build/config.ts -> ../../config.json
  const configPath = resolve(__dirname, "..", "..", "config.json");

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AsQuConfig>;

    return {
      pipe: {
        name: parsed.pipe?.name ?? DEFAULT_CONFIG.pipe.name,
      },
      ui: {
        theme: parsed.ui?.theme ?? DEFAULT_CONFIG.ui.theme,
        autoFocus: parsed.ui?.autoFocus ?? DEFAULT_CONFIG.ui.autoFocus,
        autoHide: parsed.ui?.autoHide ?? DEFAULT_CONFIG.ui.autoHide,
      },
      tauriPath: parsed.tauriPath ?? DEFAULT_CONFIG.tauriPath,
    };
  } catch {
    logger.warn(`Config not found at ${configPath}, using defaults`);
    return { ...DEFAULT_CONFIG };
  }
}

export function getPipePath(config: AsQuConfig): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${config.pipe.name}`;
  }
  // Unix future: ~/.asqu/{name}.sock
  const home = process.env.HOME ?? "/tmp";
  return resolve(home, ".asqu", `${config.pipe.name}.sock`);
}
