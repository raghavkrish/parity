import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type LogRecord = {
  ts: string;
  level: LogLevel;
  event: string;
  runId?: string;
} & LogFields;

export type LogSink = (record: LogRecord, line: string) => void;

export type LogContext = { runId?: string };

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const als = new AsyncLocalStorage<LogContext>();

let sink: LogSink | undefined;

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run({ ...als.getStore(), ...ctx }, fn);
}

export function setLogSink(next?: LogSink): void {
  sink = next;
}

export function resetLogSink(): void {
  sink = undefined;
}

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel()];
}

function compact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function formatLogLine(record: LogRecord): string {
  const { ts, level, event, ...rest } = record;
  const bits = Object.entries(rest).map(([key, value]) => `${key}=${formatValue(value)}`);
  return [ts, level.toUpperCase(), event, ...bits].join(" ");
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (!shouldLog(level)) return;
  const ctx = als.getStore();
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    event,
    ...compact({
      ...(ctx?.runId ? { runId: ctx.runId } : {}),
      ...fields,
    }),
  };
  const format = (process.env.LOG_FORMAT ?? "text").toLowerCase();
  const line = format === "json" ? JSON.stringify(record) : formatLogLine(record);

  if (sink) {
    sink(record, line);
    return;
  }
  if (process.env.VITEST) return;
  process.stderr.write(`${line}\n`);
}

export const log = {
  debug(event: string, fields?: LogFields): void {
    emit("debug", event, fields);
  },
  info(event: string, fields?: LogFields): void {
    emit("info", event, fields);
  },
  warn(event: string, fields?: LogFields): void {
    emit("warn", event, fields);
  },
  error(event: string, fields?: LogFields): void {
    emit("error", event, fields);
  },
};
