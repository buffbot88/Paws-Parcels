import { randomUUID } from "node:crypto";
import { server as serverConfig } from "../config/index.ts";

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

class Logger {
  private formatEntry(
    level: string,
    message: string,
    meta?: Record<string, unknown>,
  ): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId: randomUUID().slice(0, 8),
      ...meta,
    };
    return JSON.stringify(entry);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    console.log(this.formatEntry("INFO", message, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(this.formatEntry("WARN", message, meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(this.formatEntry("ERROR", message, meta));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (serverConfig.debug) {
      console.debug(this.formatEntry("DEBUG", message, meta));
    }
  }
}

export const logger = new Logger();
