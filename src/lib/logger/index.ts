type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  event_id?: string;
  provider?: string;
  sr_order_id?: string;
  queue_msg_id?: number | string;
  attempt?: number;
  [key: string]: unknown;
}

function formatMessage(level: LogLevel, message: string, ctx?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = ctx ? ` ${JSON.stringify(ctx)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

export const logger = {
  debug(message: string, ctx?: LogContext) {
    console.debug(formatMessage("debug", message, ctx));
  },
  info(message: string, ctx?: LogContext) {
    console.info(formatMessage("info", message, ctx));
  },
  warn(message: string, ctx?: LogContext) {
    console.warn(formatMessage("warn", message, ctx));
  },
  error(message: string, ctx?: LogContext) {
    console.error(formatMessage("error", message, ctx));
  },
};
