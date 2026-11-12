// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The deadline mechanism every streaming adapter shares. The values differ
// per provider and stay with it; this class holds its own controller that
// forwards the caller's abort, a ceiling on the whole step, an idle window
// that narrows once output flows, and a flag telling "the writer stopped it"
// from "it stopped answering".
//
// `cancelled` and `timeout` are different failures with different copy and
// different retryability. Telling them apart needs state that outlives the
// `catch` reading it, and one class keeps every adapter reporting the same
// abort the same way.
//
// Silence before output and silence during it mean different things. A local
// model may be reading weights off disk and a remote one may be queued, so
// the first window is long. A provider that has spoken and then goes quiet
// has stalled, so the shorter window applies. A single window would have to
// be the long one, and a stalled stream would hang for minutes.

/** The three windows, in milliseconds. */
export interface StreamWindows {
  /** The ceiling on the whole generation, whatever else happens. */
  stepMs: number;
  /** Silence allowed before anything has arrived. */
  firstOutputMs: number;
  /** Silence allowed once something has. */
  inactivityMs: number;
}

export class StreamDeadlines {
  private readonly controller = new AbortController();

  private readonly caller: AbortSignal;

  private readonly windows: StreamWindows;

  private readonly forward: () => void;

  private readonly step: ReturnType<typeof setTimeout>;

  private idle: ReturnType<typeof setTimeout>;

  private awaitingFirst = true;

  private expired = false;

  private readonly reason: string | undefined;

  /**
   * One deadline over a whole request that is not a stream (a catalogue
   * read, a search), with the same forwarding and the same `timedOut` flag.
   * All three windows are equal and never `touch`ed, so the first timer to
   * fire is the ceiling. `reason` is what the abort says, because the
   * callers' logs and tests tell their deadlines apart by it.
   */
  static once(
    caller: AbortSignal,
    ms: number,
    reason: string,
  ): StreamDeadlines {
    return new StreamDeadlines(
      caller,
      { stepMs: ms, firstOutputMs: ms, inactivityMs: ms },
      reason,
    );
  }

  constructor(caller: AbortSignal, windows: StreamWindows, reason?: string) {
    this.caller = caller;
    this.windows = windows;
    this.reason = reason;
    this.forward = () => this.controller.abort(caller.reason);
    // An already aborted signal never fires the event, so a listener alone
    // would miss it: the fetch would go out for a cancelled run, and the empty
    // stream after it would read as `interrupted` instead of `cancelled`.
    if (caller.aborted) this.controller.abort(caller.reason);
    // `once`, and removed in `dispose`: a generator abandoned mid-stream must
    // not leave a listener on the caller's signal, which outlives any one
    // request, holding its controller alive.
    else caller.addEventListener("abort", this.forward, { once: true });
    this.step = setTimeout(() => this.give("deadline"), windows.stepMs);
    this.idle = setTimeout(() => this.give("idle"), windows.firstOutputMs);
  }

  /** Pass this to `fetch`, never the caller's own. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Whether the abort came from a deadline; read in a `catch`. */
  get timedOut(): boolean {
    return this.expired;
  }

  /**
   * Bytes arrived. Restarts the idle window: the first call restarts the
   * first-output window, and every later call the `inactivityMs` one.
   */
  touch(): void {
    clearTimeout(this.idle);
    const window = this.awaitingFirst
      ? this.windows.firstOutputMs
      : this.windows.inactivityMs;
    this.awaitingFirst = false;
    this.idle = setTimeout(() => this.give("idle"), window);
  }

  /**
   * Stop every timer and let go of the caller's signal. Idempotent, because
   * an adapter's early returns and its `finally` both reach it.
   */
  dispose(): void {
    clearTimeout(this.step);
    clearTimeout(this.idle);
    this.caller.removeEventListener("abort", this.forward);
  }

  private give(reason: string): void {
    this.expired = true;
    this.controller.abort(this.reason ?? reason);
  }
}
