// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelFailure } from "../domain/types";
import type { RemoteProviderStatus } from "../ports";
import {
  authorizeUrl,
  createPkce,
  exchangeCode,
  inspectKey,
  type Pkce,
} from "../adapters/openrouterAuth";
import {
  KEY_CEILING_USD,
  keyAcceptance,
  keyReset,
  keyVerdict,
  readingCurrent,
  type KeyRejection,
  type OpenRouterKeyInfo,
  type OpenRouterKeyVerdict,
} from "../domain/openrouterKey";
import { getCurrentUserId as currentUserId } from "../../auth/currentUser";
import { PRODUCT } from "../../product";
import type { Platform } from "../../platform";
import {
  CONNECT_WINDOW,
  CONNECT_WINDOW_FEATURES,
  connectPopupPath,
  setConnector,
} from "../connectPath";
import { announceConnect, openChannel } from "./connectChannel";
import { OpenRouterDirectProvider } from "../adapters/openrouterDirect";
import {
  OpenRouterDirectSearchEngine,
  searchModelOf,
  WikipediaDirectSearchEngine,
} from "../adapters/directSearch";
import { OPENROUTER_HOST, type Attribution } from "../adapters/directWire";
import { appLog, describeError } from "../../log";

// The writer's OpenRouter key, held in this tab and in the platform's vault.
// Nothing about the key passes through a server the publisher
// runs: the approval, the exchange, the key's reading and every request go
// from here to openrouter.ai.
//
// The approval is OAuth PKCE. The verifier is made and kept in the memory of
// the tab that asked, and the vendor sends the code back to the app's own
// `/app/connect/openrouter` page, which hands `{code, state}` to this tab
// over a same-origin channel. This tab acknowledges a callback that names its
// flow, and the page says "Approved" and closes only on that acknowledgement.
// A code without the verifier buys nothing, so the channel carries nothing
// worth stealing. The flow is bound to the account that started it: a
// callback that arrives after another account signed in is dropped, and its
// key is never stored.
//
// A key is accepted only with a spend limit set at the vendor, at most
// `KEY_CEILING_USD`, and never a management key (`keyAcceptance`). Its
// verdict (expired, limit reached, a notice before either) is read from the
// vendor before a request leaves, at most `CHECK_TTL_MS` old.

export const OPENROUTER_ID = "openrouter";
const KEY_NAME = "openrouter.key";
const REMEMBER_PREF = "openrouter.remember";

/** How old a key's reading may be when a request leaves. */
const CHECK_TTL_MS = 60_000;

/** How long an approval may take before the flow is given up. */
const FLOW_TIMEOUT_MS = 10 * 60_000;

/** How often an open approval window is checked for having closed. */
const CLOSED_POLL_MS = 500;

/** How long the approval page waits for the asking tab to acknowledge. */
const ACK_WAIT_MS = 3_000;

const CALLBACK_CHANNEL = "openrouter-callback";

/** Why the last connection attempt or reading did not leave a usable key. */
export type ConnectRefusal =
  | KeyRejection
  | "exchange-expired"
  | "exchange-failed"
  | "unreachable"
  | "revoked";

/**
 * The writer's OpenRouter connection, as the settings pane and the editor
 * read it: the key's facts, its verdict, the last refusal and whether the
 * key is remembered. `state` is null while nothing is connected.
 */
export interface OpenRouterStatus extends RemoteProviderStatus {
  providerId: typeof OPENROUTER_ID;
  state: OpenRouterKeyVerdict["state"] | null;
  notice: OpenRouterKeyVerdict["notice"];
  waitUntil: string | null;
  spentUsd: number | null;
  remainingUsd: number | null;
  spentShare: number | null;
  remembered: boolean;
  refusal: ConnectRefusal | null;
}

interface Held {
  key: string | null;
  info: OpenRouterKeyInfo | null;
  /** When `info` was read; the verdict needs it to tell a stale window. */
  infoAt: number;
  checkedAt: number;
  /** The vendor refused the key itself (401/403): revoked or deleted. */
  revoked: boolean;
  remembered: boolean;
  /** The writer removed the key here; it still works at the vendor. */
  removed: boolean;
  refusal: ConnectRefusal | null;
  /** The vendor reading in flight, which every caller joins. */
  reading: Promise<void> | null;
  /** Marked stale while `reading` ran, so it reads once more when done. */
  again: boolean;
}

const held = new Map<string, Held>();
const listeners = new Set<() => void>();
let statuses = new Map<string, OpenRouterStatus>();

function notify(): void {
  statuses = new Map();
  for (const listen of listeners) listen();
}

/** Tells the listeners only when what they read for this writer changed. */
function notifyIfChanged(writerId: string, entry: Held): void {
  const shown = statuses.get(writerId);
  if (shown && JSON.stringify(shown) === JSON.stringify(statusOf(entry)))
    return;
  notify();
}

function heldFor(writerId: string): Held {
  let entry = held.get(writerId);
  if (!entry) {
    entry = {
      key: null,
      info: null,
      infoAt: 0,
      checkedAt: 0,
      revoked: false,
      remembered: false,
      removed: false,
      refusal: null,
      reading: null,
      again: false,
    };
    held.set(writerId, entry);
  }
  return entry;
}

export function subscribeRemoteProviders(listen: () => void): () => void {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

/** Whether a new key for this writer should outlive the session. */
export function rememberPreference(writerId: string): boolean {
  try {
    return localStorage.getItem(`${REMEMBER_PREF}.${writerId}`) === "1";
  } catch {
    return false;
  }
}

function setRememberPreference(writerId: string, remember: boolean): void {
  try {
    if (remember) localStorage.setItem(`${REMEMBER_PREF}.${writerId}`, "1");
    else localStorage.removeItem(`${REMEMBER_PREF}.${writerId}`);
  } catch {
    // Storage refused: the choice lasts for this tab only.
  }
}

function statusOf(entry: Held): OpenRouterStatus {
  const info = entry.info;
  const verdict = info ? keyVerdict(info, Date.now(), entry.infoAt) : null;
  const connected = entry.key !== null;
  return {
    providerId: OPENROUTER_ID,
    connected,
    upstreamHost: OPENROUTER_HOST,
    keysUrl: `https://${OPENROUTER_HOST}/settings/keys`,
    keyRemoved: !connected && entry.removed,
    accountLabel: info?.label ?? null,
    expiresAtOrBefore:
      info?.expiresAt != null ? new Date(info.expiresAt).toISOString() : null,
    limitUsd: info?.limitUsd ?? null,
    limitReset: keyReset(info?.limitReset ?? null),
    state: !connected
      ? null
      : entry.revoked
        ? "expired"
        : (verdict?.state ?? "ready"),
    notice: connected && !entry.revoked ? (verdict?.notice ?? null) : null,
    waitUntil: connected ? (verdict?.waitUntil ?? null) : null,
    spentUsd: verdict?.spentUsd ?? null,
    remainingUsd: verdict?.remainingUsd ?? null,
    spentShare: verdict?.spentShare ?? null,
    remembered: connected && entry.remembered,
    refusal: entry.refusal,
    required: { limitUsd: KEY_CEILING_USD },
  };
}

/**
 * The writer's OpenRouter status, connected or not: a disconnected one is
 * where the writer connects. The same object until something changes, so it
 * can be a store's snapshot.
 */
export function openRouterStatus(writerId: string): OpenRouterStatus {
  let cached = statuses.get(writerId);
  if (!cached) {
    cached = statusOf(heldFor(writerId));
    statuses.set(writerId, cached);
  }
  return cached;
}

/**
 * The key a request carries, or `null` when this writer holds none. A key
 * the vendor refused is still handed over, so the custody check answers
 * `key-expired`, whose remedy is Renew, rather than `not-configured`.
 */
export function apiKeyFor(writerId: string): string | null {
  return held.get(writerId)?.key ?? null;
}

let boundPlatform: Platform | null = null;

/**
 * Reads the key from the vault and its facts from the vendor. A reading that
 * cannot reach the vendor keeps the last facts: the key still works, and the
 * check before a request reads again.
 */
export async function refreshRemoteProviders(
  writerId: string,
  platform: Platform,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  boundPlatform = platform;
  const entry = heldFor(writerId);
  // A remembered key is read again from the vault, so a disconnect or a new
  // key in another tab reaches this one. With the choice not to remember, the
  // vault is not asked: a kept key a failed forget left behind stays shut.
  if (
    (entry.key === null && rememberPreference(writerId)) ||
    entry.remembered
  ) {
    const stored = await platform.vault.get(KEY_NAME).catch(() => null);
    if (currentUserId() !== writerId) return;
    if (stored) {
      // Everything known about the old key goes with it: a new key is
      // judged on its own reading, never on the old one's refusal.
      if (stored !== entry.key) {
        entry.info = null;
        entry.infoAt = 0;
        entry.checkedAt = 0;
        entry.revoked = false;
        entry.refusal = null;
      }
      entry.key = stored;
      entry.remembered = true;
    } else if (entry.remembered) {
      entry.key = null;
      entry.info = null;
      entry.remembered = false;
    }
  }
  if (entry.key === null) {
    notify();
    return;
  }
  await joined(readKey(writerId, entry), signal);
}

/**
 * The key's reading from the vendor, one in flight per writer: the check
 * before a request, a refresh and a stale mark all join it. A stale mark
 * while it runs, or a new key, has it read once more before it settles, so
 * a reading taken before a spend never stands for one taken after it. The
 * read is bounded by its own timeout and no caller's abort cuts it short.
 */
function readKey(writerId: string, entry: Held): Promise<void> {
  if (entry.reading) return entry.reading;
  const reading = (async () => {
    try {
      let key: string | null;
      do {
        entry.again = false;
        key = entry.key;
        if (key === null) return;
        await readOnce(writerId, entry, key);
      } while (
        held.get(writerId) === entry &&
        (entry.again || entry.key !== key)
      );
    } finally {
      entry.reading = null;
    }
  })();
  entry.reading = reading;
  return reading;
}

/** Waits for `work`, or until `signal` aborts, whichever comes first. */
function joined(work: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done);
    void work.then(done, done);
  });
}

async function readOnce(
  writerId: string,
  entry: Held,
  key: string,
): Promise<void> {
  const outcome = await inspectKey(fetch, key, new AbortController().signal);
  if (held.get(writerId) !== entry || entry.key !== key) return;
  if (outcome.ok) {
    const acceptance = keyAcceptance(outcome.info, Date.now());
    if (!acceptance.accepted && acceptance.reason !== "already-expired") {
      // The key's settings at the vendor changed since it was accepted: its
      // limit was lifted or raised past the ceiling. The key is dropped.
      await dropKey(writerId, entry, acceptance.reason);
      return;
    }
    entry.info = outcome.info;
    entry.infoAt = Date.now();
    entry.revoked = false;
    entry.checkedAt = entry.infoAt;
    entry.refusal = null;
  } else if (outcome.failure === "unauthorized") {
    entry.revoked = true;
    entry.refusal = "revoked";
    entry.checkedAt = Date.now();
  }
  notifyIfChanged(writerId, entry);
}

async function dropKey(
  writerId: string,
  entry: Held,
  refusal: ConnectRefusal | null,
): Promise<void> {
  entry.key = null;
  entry.info = null;
  entry.revoked = false;
  entry.remembered = false;
  entry.refusal = refusal;
  // A kept key the service did not clear stays shut behind the choice not
  // to remember (`refreshRemoteProviders`).
  if (currentUserId() === writerId)
    await boundPlatform?.vault
      .delete(KEY_NAME)
      .catch(() => setRememberPreference(writerId, false));
  notify();
}

/** Whether the held reading can judge the key at `now`. */
function judgeable(entry: Held, now: number): boolean {
  return entry.info !== null && readingCurrent(entry.info, entry.infoAt, now);
}

/**
 * The custody check before a request leaves: the key's verdict, read again
 * when the last reading is older than `CHECK_TTL_MS` or comes from a spend
 * window that has since ended. A failure returned is the request's, provably
 * unsent.
 *
 * A key with no reading that can judge it is refused as unreachable, as a
 * new key is when its first reading fails: its spend is unknown, and a key
 * nobody could judge is not one to spend.
 */
export function beforeSendFor(
  writerId: string,
): (signal: AbortSignal) => Promise<ModelFailure | null> {
  return async (signal) => {
    const entry = held.get(writerId);
    if (!entry || entry.key === null)
      return {
        code: "not-configured",
        message: "No OpenRouter key is connected.",
        retryable: false,
      };
    if (
      Date.now() - entry.checkedAt > CHECK_TTL_MS ||
      !judgeable(entry, Date.now())
    )
      await joined(readKey(writerId, entry), signal);
    if (entry.revoked || entry.key === null)
      return {
        code: "key-expired",
        message: "OpenRouter no longer accepts this key.",
        retryable: false,
      };
    if (!entry.info || !judgeable(entry, Date.now()))
      return {
        code: "connection",
        message: "OpenRouter could not be reached to check the key.",
        retryable: true,
      };
    const verdict = keyVerdict(entry.info, Date.now(), entry.infoAt);
    if (verdict.state === "expired")
      return {
        code: "key-expired",
        message: "The OpenRouter key has expired.",
        retryable: false,
      };
    if (verdict.state === "limit-reached")
      return {
        code: "limit-reached",
        message: "The OpenRouter key has spent its limit.",
        retryable: false,
      };
    return null;
  };
}

/** After an answer or a refusal about the key: read it again soon. */
export function markKeyStale(writerId: string): void {
  const entry = held.get(writerId);
  if (!entry || entry.key === null) return;
  entry.checkedAt = 0;
  if (entry.reading) entry.again = true;
  else void readKey(writerId, entry);
}

/**
 * Moves a held key into or out of the platform's persistent store, and
 * records the choice for the next key.
 */
export async function setRemember(
  writerId: string,
  platform: Platform,
  remember: boolean,
): Promise<void> {
  setRememberPreference(writerId, remember);
  const entry = heldFor(writerId);
  if (entry.key !== null) {
    if (remember) {
      const stored = await platform.vault.set(KEY_NAME, entry.key, {
        remember: true,
      });
      entry.remembered = stored.remembered;
      // Not sealed: the choice goes back, so an older kept key is not read.
      if (!stored.remembered) setRememberPreference(writerId, false);
    } else {
      await platform.vault
        .set(KEY_NAME, entry.key, { remember: false })
        .catch(() => {});
      entry.remembered = false;
    }
  }
  notify();
}

/** Disconnects: the key leaves this device. It still exists at the vendor. */
export async function disconnectOpenRouter(
  writerId: string,
  platform: Platform,
): Promise<void> {
  boundPlatform = platform;
  const entry = heldFor(writerId);
  entry.removed = true;
  await dropKey(writerId, entry, null);
  announceConnect({ providerId: OPENROUTER_ID, ok: true });
}

/** Drops what this tab holds for a writer being forgotten or logged out. */
export function forgetRemoteProviders(writerId: string): void {
  held.delete(writerId);
  notify();
}

// ── The approval flow ────────────────────────────────────────────────────────

interface Flow {
  writerId: string;
  pkce: Pkce;
  callbackUrl: string;
  settle: (callback: { code: string } | null) => void;
}

let flow: Flow | null = null;

export function connectPending(): boolean {
  return flow !== null;
}

let callbackBus: BroadcastChannel | null = null;

// A callback is `{state, code}`; its acknowledgement is `{ack: state}`, a
// shape with no `state`, so neither side mistakes the other's message for
// its own.
function listenForCallbacks(): void {
  if (callbackBus) return;
  const bus = openChannel(CALLBACK_CHANNEL);
  if (!bus) return;
  callbackBus = bus;
  bus.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as {
      state?: unknown;
      code?: unknown;
    } | null;
    if (!flow || !data || typeof data.state !== "string") return;
    if (data.state !== flow.pkce.state) return;
    try {
      bus.postMessage({ ack: data.state });
    } catch {
      // The page then says the approval was lost; the flow goes on here.
    }
    flow.settle(
      typeof data.code === "string" && data.code ? { code: data.code } : null,
    );
  });
}

/**
 * Hands the vendor's callback to the tab that started the flow, and resolves
 * `true` once that tab acknowledges it, `false` when no tab does within
 * `ACK_WAIT_MS`. Run by the `/app/connect/openrouter` page; the state alone
 * names the flow. A callback no tab took is one the page must not call
 * approved: the tab may have closed, reloaded or started another flow.
 */
export function deliverCallback(
  callback: { state: string; code: string | null },
  waitMs: number = ACK_WAIT_MS,
): Promise<boolean> {
  const bus = openChannel(CALLBACK_CHANNEL);
  if (!bus) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const end = (acknowledged: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      bus.removeEventListener("message", onMessage);
      bus.close();
      resolve(acknowledged);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { ack?: unknown } | null;
      if (data && data.ack === callback.state) end(true);
    };
    bus.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => end(false), waitMs);
    try {
      bus.postMessage(callback);
    } catch {
      end(false);
    }
  });
}

export type ConnectOutcome =
  "connected" | "cancelled" | "blocked" | "superseded" | ConnectRefusal;

/**
 * Starts an approval for the open writer. Call it straight from a click:
 * the window opens before any await, which Safari and Firefox require.
 */
export function connectOpenRouter(
  platform: Platform,
  keyLabel: string,
): Promise<ConnectOutcome> {
  boundPlatform = platform;
  const writerId = currentUserId();
  if (!writerId) return Promise.resolve("cancelled");

  const popup = window.open(
    connectPopupPath(OPENROUTER_ID),
    CONNECT_WINDOW,
    CONNECT_WINDOW_FEATURES,
  );
  if (!popup) return Promise.resolve("blocked");
  // Cut while the window is still on this origin, the only time the
  // assignment is allowed: the vendor's pages then get no handle on this
  // tab. This tab keeps its own handle, to send the window on and to see it
  // close. A reused window already elsewhere refuses the assignment, and its
  // opener was cut when it first opened.
  try {
    popup.opener = null;
  } catch {
    // Cross-origin already.
  }
  listenForCallbacks();
  flow?.settle(null);

  return (async () => {
    const pkce = await createPkce();
    const callbackUrl = new URL(
      connectPopupPath(OPENROUTER_ID),
      window.location.origin,
    ).href;
    const callback = await new Promise<{ code: string } | null>((resolve) => {
      // A window closed at the consent screen never comes back to say so,
      // and its closing is the only answer it gives. `closed` alone is not
      // that answer: a vendor page that sends its own
      // Cross-Origin-Opener-Policy cuts this tab's handle, which then reads
      // closed while the writer is still approving. So the window counts as
      // closed only while this tab has focus, checked on the focus event and
      // on every poll, because `closed` can turn true a moment after focus
      // returns.
      const check = () => {
        if (document.hasFocus() && popup.closed) mine.settle(null);
      };
      const mine: Flow = {
        writerId,
        pkce,
        callbackUrl,
        settle: (value) => {
          window.clearTimeout(timer);
          window.clearInterval(watch);
          window.removeEventListener("focus", check);
          if (flow === mine) flow = null;
          resolve(value);
        },
      };
      const timer = window.setTimeout(() => mine.settle(null), FLOW_TIMEOUT_MS);
      const watch = window.setInterval(check, CLOSED_POLL_MS);
      window.addEventListener("focus", check);
      flow = mine;
      try {
        popup.location.href = authorizeUrl({
          callbackUrl,
          challenge: pkce.challenge,
          state: pkce.state,
          keyLabel,
        });
      } catch (err) {
        // The provider alone: the authorize URL carries the PKCE challenge.
        appLog.warn("account", "The approval window could not be opened.", {
          provider: OPENROUTER_ID,
          ...describeError(err),
        });
        mine.settle(null);
      }
    });
    if (!callback) return "cancelled";
    return finish(writerId, pkce, callback.code);
  })();
}

async function finish(
  writerId: string,
  pkce: Pkce,
  code: string,
): Promise<ConnectOutcome> {
  // The flow belongs to the account that started it; a code that comes back
  // to anyone else is dropped unexchanged.
  const stillOurs = () => currentUserId() === writerId;
  if (!stillOurs()) return "superseded";

  const entry = heldFor(writerId);
  // The step and the refusal's kind, never the key.
  const refuse = (
    refusal: ConnectRefusal,
    step: string,
    failure?: unknown,
  ): ConnectOutcome => {
    appLog.warn("account", "A provider connection was refused.", {
      provider: OPENROUTER_ID,
      refusal,
      step,
      remember: rememberPreference(writerId),
      ...(failure === undefined ? {} : describeError(failure)),
    });
    entry.refusal = refusal;
    notify();
    return refusal;
  };

  const exchanged = await exchangeCode(fetch, {
    code,
    verifier: pkce.verifier,
  });
  if (!exchanged.ok)
    return exchanged.failure === "cancelled"
      ? "cancelled"
      : refuse(
          exchanged.failure === "expired"
            ? "exchange-expired"
            : exchanged.failure === "unreachable"
              ? "unreachable"
              : "exchange-failed",
          `exchange-${exchanged.failure}`,
        );

  const inspected = await inspectKey(
    fetch,
    exchanged.key,
    new AbortController().signal,
  );
  if (!inspected.ok)
    return refuse("unreachable", `inspect-${inspected.failure}`);
  const acceptance = keyAcceptance(inspected.info, Date.now());
  if (!acceptance.accepted) return refuse(acceptance.reason, "accept");
  if (!stillOurs()) return "superseded";

  const platform = boundPlatform;
  if (!platform) return refuse("unreachable", "platform");
  let storeError: unknown;
  const stored = await platform.vault
    .set(KEY_NAME, exchanged.key, { remember: rememberPreference(writerId) })
    .catch((err: unknown) => {
      storeError = err;
      return null;
    });
  if (!stored) return refuse("unreachable", "store", storeError);
  if (!stored.remembered) setRememberPreference(writerId, false);
  entry.key = exchanged.key;
  entry.info = inspected.info;
  entry.infoAt = Date.now();
  entry.checkedAt = entry.infoAt;
  entry.revoked = false;
  entry.remembered = stored.remembered;
  entry.removed = false;
  entry.refusal = null;
  notify();
  announceConnect({ providerId: OPENROUTER_ID, ok: true });
  appLog.info("account", "A provider connection ended.", {
    provider: OPENROUTER_ID,
    outcome: "connected",
    remember: stored.remembered,
  });
  return "connected";
}

// The editor opens the same approval from its failure strip without loading
// this module's dependencies itself.
setConnector((providerId) => {
  if (providerId !== OPENROUTER_ID || !boundPlatform) return;
  void connectOpenRouter(boundPlatform, keyLabelForApp());
});

/** The label the vendor shows beside the key in its own key list. */
export function keyLabelForApp(): string {
  return `${PRODUCT.name} (${window.location.host})`;
}

// ── Composition ──────────────────────────────────────────────────────────────

function attribution(): Attribution {
  return { title: PRODUCT.name };
}

/**
 * The chat and catalogue adapter for a writer: the key is read per request,
 * the custody check runs before each one, and a refusal about the key or an
 * answer that may have cost something has the key read again, which tells
 * the surfaces when its verdict changed.
 */
export function openRouterProvider(writerId: string): OpenRouterDirectProvider {
  return new OpenRouterDirectProvider(OPENROUTER_ID, {
    apiKey: () => apiKeyFor(writerId),
    beforeSend: beforeSendFor(writerId),
    attribution: attribution(),
    onKeyRefused: () => markKeyStale(writerId),
    onSpent: () => markKeyStale(writerId),
  });
}

/**
 * The provider search route, on the writer's key: the engine for a model
 * the writer chose, the same object for the same model, or `null` for a
 * model no search may run on.
 */
export function openRouterSearch(
  writerId: string,
): (modelId: string) => OpenRouterDirectSearchEngine | null {
  const engines = new Map<string, OpenRouterDirectSearchEngine>();
  return (modelId) => {
    const model = searchModelOf(modelId);
    if (model === null) return null;
    let engine = engines.get(model);
    if (!engine) {
      engine = new OpenRouterDirectSearchEngine(OPENROUTER_ID, {
        apiKey: () => apiKeyFor(writerId),
        beforeSend: beforeSendFor(writerId),
        attribution: attribution(),
        model,
        onKeyRefused: () => markKeyStale(writerId),
        onSpent: () => markKeyStale(writerId),
      });
      engines.set(model, engine);
    }
    return engine;
  };
}

/** The keyless Wikipedia route, in the edition `language` names. */
export function wikipediaSearch(
  language: () => string | undefined,
): WikipediaDirectSearchEngine {
  return new WikipediaDirectSearchEngine({
    language,
    productPascal: PRODUCT.name.replace(/[^A-Za-z0-9]/g, ""),
  });
}
