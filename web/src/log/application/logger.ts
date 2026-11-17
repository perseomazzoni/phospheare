// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  formatLine,
  type FieldValue,
  type LogEntry,
  type LogLevel,
} from "../domain/line";
import { redact, type Known } from "../domain/redact";
import { KEEP_MS } from "../domain/retention";

/** A line as the store keeps it: the entry, with the size of its text. */
export interface StoredLine {
  entry: LogEntry;
  size: number;
}

/**
 * Where the lines are kept. Each call may fail; the logger never lets a
 * failure of its own reach the writer.
 */
export interface LogStore {
  append(lines: readonly StoredLine[]): Promise<void>;
  /** Every line, oldest first. */
  read(): Promise<LogEntry[]>;
  /** Removes the lines older than `before`, then trims to the size limit. */
  prune(before: number): Promise<void>;
  clear(): Promise<void>;
}

export interface LoggerPorts {
  store: LogStore;
  now: () => number;
  /** The writer account id now, or `null`. */
  account: () => string | null;
  /** The personal values the app knows now. */
  known: () => readonly Known[];
  /** Runs `run` after `ms`; the logger batches its writes with it. */
  later: (run: () => void, ms: number) => void;
  /** Hears each line too, as the developer console does. It may be absent. */
  echo?: (entry: LogEntry) => void;
  /**
   * Somewhere that keeps lines at once, for the moment the page goes: the
   * store's writes are asynchronous and do not finish then. It may be absent.
   */
  stash?: LineStash;
}

/** A small place that saves and gives back lines synchronously. */
export interface LineStash {
  save(lines: readonly StoredLine[]): void;
  /** The lines saved, removed from the stash; none when it holds none. */
  take(): StoredLine[];
}

/** How long lines wait to be written together. An error goes at once. */
const BATCH_MS = 1000;
/** A prune runs after this many lines, besides the one at the start. */
const PRUNE_EVERY = 500;

export type Fields = Record<string, FieldValue | null | undefined>;

export type Logger = ReturnType<typeof createLogger>;

/**
 * The app's log: lines redacted as they are made, batched, and kept for
 * `KEEP_MS` at most. Nothing sends them anywhere.
 */
export function createLogger(ports: LoggerPorts) {
  let pending: StoredLine[] = [];
  let scheduled = false;
  let sincePrune = 0;
  let writing: Promise<void> = Promise.resolve();
  /** The batches handed to the store and not yet confirmed written. */
  const unconfirmed = new Set<readonly StoredLine[]>();

  const flush = (): Promise<void> => {
    scheduled = false;
    if (pending.length === 0) return writing;
    const batch = pending;
    pending = [];
    unconfirmed.add(batch);
    sincePrune += batch.length;
    const prune = sincePrune >= PRUNE_EVERY;
    if (prune) sincePrune = 0;
    writing = writing
      .then(() => ports.store.append(batch))
      .then(() => {
        unconfirmed.delete(batch);
        return prune ? ports.store.prune(ports.now() - KEEP_MS) : undefined;
      })
      .catch(() => {
        // A full or closed store loses these lines; the app goes on.
        unconfirmed.delete(batch);
      });
    return writing;
  };

  const write = (
    level: LogLevel,
    area: string,
    message: string,
    fields: Fields = {},
  ): void => {
    const known = ports.known();
    const kept: Record<string, FieldValue> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined) continue;
      kept[key] = typeof value === "string" ? redact(value, known) : value;
    }
    const entry: LogEntry = {
      at: ports.now(),
      level,
      area,
      message: redact(message, known),
      account: ports.account(),
      fields: kept,
    };
    ports.echo?.(entry);
    pending.push({ entry, size: formatLine(entry).length + 1 });
    if (level === "error") {
      void flush();
    } else if (!scheduled) {
      scheduled = true;
      ports.later(() => void flush(), BATCH_MS);
    }
  };

  return {
    info: (area: string, message: string, fields?: Fields) =>
      write("info", area, message, fields),
    warn: (area: string, message: string, fields?: Fields) =>
      write("warn", area, message, fields),
    error: (area: string, message: string, fields?: Fields) =>
      write("error", area, message, fields),
    /** Writes what waits, and answers once it is written. */
    flush,
    /**
     * For the moment the page goes: puts the lines that wait, and those the
     * store has not confirmed, in the stash at once. A batch the store did
     * write after all comes back twice; a line twice is better than none.
     */
    leave(): void {
      if (!ports.stash) {
        void flush();
        return;
      }
      const lines = [...[...unconfirmed].flat(), ...pending];
      pending = [];
      scheduled = false;
      if (lines.length === 0) return;
      try {
        ports.stash.save(lines);
      } catch {
        // A full or blocked stash loses these lines; the page goes anyway.
      }
    },
    /** Writes the lines a page left in the stash, before any of this one. */
    restore(): void {
      let saved: StoredLine[];
      try {
        saved = ports.stash?.take() ?? [];
      } catch {
        return;
      }
      if (saved.length === 0) return;
      pending = [...saved, ...pending];
      void flush();
    },
    /** Every line kept, oldest first, the ones not yet written included. */
    async read(): Promise<LogEntry[]> {
      await flush();
      try {
        return await ports.store.read();
      } catch {
        return [];
      }
    },
    /** Drops the lines past their time, as each start does. */
    prune(): Promise<void> {
      return ports.store.prune(ports.now() - KEEP_MS).catch(() => {});
    },
    /** Removes every line. */
    async clear(): Promise<void> {
      pending = [];
      try {
        ports.stash?.take();
      } catch {
        // A stash that cannot be read holds nothing to clear.
      }
      await writing;
      await ports.store.clear();
    },
  };
}

/**
 * An error whose message may hold a personal value, such as a path that
 * names a manuscript. It gives the fields that are safe to log in place of
 * its message.
 */
interface Loggable {
  toLog(): Record<string, FieldValue>;
}

/** How many causes and inner errors a description follows. */
const MAX_CAUSES = 3;

function isLoggable(error: Error): error is Error & Loggable {
  return typeof (error as Partial<Loggable>).toLog === "function";
}

/** The value as one short phrase: its kind, and its message if it may say it. */
function summary(value: unknown): string {
  if (value instanceof Error) {
    // A SyntaxError at run time comes from JSON.parse, whose message quotes
    // the start of the text it read: a chat, a setting, a manuscript.
    if (
      isLoggable(value) ||
      value.message === "" ||
      value.name === "SyntaxError"
    )
      return value.name;
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "object" && value !== null) {
    // A thrown event or answer: its kind and its codes, never its text.
    const kind = value.constructor?.name || "Object";
    const codes = (["name", "code", "status", "type"] as const)
      .map((key) => [key, (value as Record<string, unknown>)[key]] as const)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([key, v]) => `${key} ${String(v)}`);
    return codes.length ? `${kind} (${codes.join(", ")})` : kind;
  }
  return String(value);
}

/**
 * The frames of `error`'s stack, without the header that repeats its
 * message. V8 starts a stack with the message, which can span lines, then
 * writes each frame as "    at …"; Firefox and Safari write frames only.
 */
function frames(error: Error): string | undefined {
  const stack = error.stack;
  if (!stack) return undefined;
  const lines = stack.split("\n");
  const first = lines.findIndex((line) => /^\s+at /.test(line));
  if (first !== -1) return lines.slice(first).join("\n");
  // No V8 frame. A stack that is only the error's own header holds the
  // message and nothing else, so it goes, as `toLog()` asks; any other stack
  // is Firefox's or Safari's frames.
  const header = error.message ? `${error.name}: ${error.message}` : error.name;
  return stack === header || stack.startsWith(`${header}\n`)
    ? undefined
    : stack;
}

/**
 * The cause of `value`. Read as a plain property: the app builds for ES2020,
 * whose types have no `cause`, and some libraries set it by hand.
 */
function causeOf(value: unknown): unknown {
  return value instanceof Error
    ? (value as { cause?: unknown }).cause
    : undefined;
}

/** The causes of `error`, nearest first. */
function causes(error: Error): unknown[] {
  const found: unknown[] = [];
  let next = causeOf(error);
  while (next !== undefined && next !== null && found.length < MAX_CAUSES) {
    found.push(next);
    next = causeOf(next);
  }
  return found;
}

/**
 * What `error` holds, as fields: its kind and message, the frames of its
 * stack, its causes and, as an `AggregateError` has, the errors inside it.
 * An error that is `Loggable` gives its own fields in place of its message.
 */
export function describe(error: unknown): Record<string, FieldValue> {
  if (!(error instanceof Error)) return { error: summary(error) };
  // A code is the app's own word for the failure, never the writer's: kept
  // for any error that carries a string one, as `PlatformError` does.
  const code = (error as { code?: unknown }).code;
  const fields: Record<string, FieldValue> = {
    error: summary(error),
    ...(typeof code === "string" && code !== "" ? { code } : {}),
    ...(isLoggable(error) ? error.toLog() : {}),
  };
  const stack = frames(error);
  if (stack) fields.stack = stack;
  const chain = causes(error);
  if (chain.length) {
    fields.cause = chain.map(summary).join(" ← ");
    const nearest = chain[0];
    const causeStack = nearest instanceof Error ? frames(nearest) : undefined;
    if (causeStack) fields.causeStack = causeStack;
  }
  // An AggregateError, or any error that carries others the same way.
  const inner = (error as { errors?: unknown }).errors;
  if (Array.isArray(inner) && inner.length) {
    fields.errors = inner.slice(0, MAX_CAUSES).map(summary).join(" | ");
  }
  return fields;
}
