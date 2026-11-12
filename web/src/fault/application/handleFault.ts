// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { classify, type Fault, type FaultKind } from "../domain/fault";
import { mayAutoReload } from "../domain/reloadPolicy";

/**
 * Where a failure was met: a React render, the window's own error events, or
 * the start-up before React mounted.
 */
export type FaultSite = "react" | "window" | "boot";

export interface FaultReport {
  site: FaultSite;
  kind: FaultKind;
  /** The path the tab was on, without its query. */
  path: string;
  /** React's component stack, for a failure met while rendering. */
  componentStack?: string;
}

/**
 * Records a failure for whoever diagnoses it. The writer never sees what it
 * records; a page in their language does the telling.
 */
export interface FaultReporter {
  report(error: unknown, report: FaultReport): void;
}

/** The tab's memory of its own last automatic reload. */
export interface ReloadMemory {
  /** Epoch milliseconds, or `null` when none is held. */
  last(): number | null;
  /**
   * Remembers a reload at `at`. False when nothing could be stored, and then
   * no automatic reload may happen: one that cannot be remembered cannot be
   * limited.
   */
  mark(at: number): boolean;
}

/** The page the app runs in. */
export interface Page {
  reload(): void;
  online(): boolean;
  path(): string;
  now(): number;
}

export interface FaultPorts {
  reporter: FaultReporter;
  memory: ReloadMemory;
  page: Page;
}

export type FaultHandling = ReturnType<typeof createFaultHandling>;

/**
 * The app's answer to a failure: what it means, who records it, and whether
 * the tab reloads by itself.
 *
 * Only a stale build reloads unasked. Any other failure leaves the tab as it
 * is until the writer chooses, because a reload drops whatever the page held
 * in memory.
 */
export function createFaultHandling({ reporter, memory, page }: FaultPorts) {
  const read = (error: unknown): Fault => classify(error, page.online());

  return {
    read,

    report(error: unknown, site: FaultSite, componentStack?: string): void {
      reporter.report(error, {
        site,
        kind: read(error).kind,
        path: page.path(),
        ...(componentStack ? { componentStack } : {}),
      });
    },

    /** Whether `fault` is one the tab answers by reloading itself now. */
    reloadsItself(fault: Fault): boolean {
      return (
        fault.kind === "stale-build" && mayAutoReload(memory.last(), page.now())
      );
    },

    /**
     * Reloads the tab once for a stale build. False when the policy or the
     * memory refuses, and the page is then shown instead.
     */
    reloadOnce(fault: Fault): boolean {
      if (fault.kind !== "stale-build") return false;
      const now = page.now();
      if (!mayAutoReload(memory.last(), now) || !memory.mark(now)) return false;
      page.reload();
      return true;
    },

    reload(): void {
      page.reload();
    },
  };
}
