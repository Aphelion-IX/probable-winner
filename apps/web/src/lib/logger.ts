import { headers } from "next/headers";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function emit(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
  serializeError,
};

// Reads the request id stamped by proxy.ts (B-203) so a Server
// Component/Action's logs can be correlated back to one HTTP request.
// Returns undefined outside a request context (e.g. build time).
export async function getRequestId(): Promise<string | undefined> {
  try {
    const headersList = await headers();
    return headersList.get("x-request-id") ?? undefined;
  } catch {
    return undefined;
  }
}
