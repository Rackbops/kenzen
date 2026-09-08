/**
 * Minimal structured logger: one JSON line per record to stdout -- the "structured JSON logging"
 * K4-2 asks for. Copied from `Rackbops/artifact-console`'s `packages/host/src/log.ts` (design.md
 * section 3), which is already fully generic. `child()` returns a logger with extra bound
 * fields. The sink and clock are injectable so tests can capture output deterministically.
 */

export type LogLevel = "info" | "warn" | "error"

export type LogFields = Record<string, unknown>

export interface Logger {
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(bindings: LogFields): Logger
}

export interface LoggerOptions {
  /** Sink for one serialized JSON line. Defaults to stdout. */
  write?: (line: string) => void
  /** Fields merged into every record (accumulated by `child()`). */
  bindings?: LogFields
  /** Clock, injectable for tests. */
  now?: () => Date
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => void process.stdout.write(`${line}\n`))
  const bindings = options.bindings ?? {}
  const now = options.now ?? (() => new Date())

  function emit(level: LogLevel, msg: string, fields?: LogFields): void {
    write(JSON.stringify({ time: now().toISOString(), level, msg, ...bindings, ...fields }))
  }

  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (childBindings) =>
      createLogger({ write, now, bindings: { ...bindings, ...childBindings } }),
  }
}
