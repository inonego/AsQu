// stderr-only logger (stdout is reserved for MCP stdio transport)

const PREFIX = "[AsQu]";

export const logger = {
  info(message: string, ...args: unknown[]): void {
    console.error(`${PREFIX} ${message}`, ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    console.error(`${PREFIX} WARN: ${message}`, ...args);
  },

  error(message: string, ...args: unknown[]): void {
    console.error(`${PREFIX} ERROR: ${message}`, ...args);
  },

  debug(message: string, ...args: unknown[]): void {
    if (process.env.ASQU_DEBUG) {
      console.error(`${PREFIX} DEBUG: ${message}`, ...args);
    }
  },
};
