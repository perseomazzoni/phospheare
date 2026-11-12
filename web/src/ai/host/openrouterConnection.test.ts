// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialVault, Platform } from "../../platform";

// Pins the writer's OpenRouter connection held in this tab: the
// PKCE approval bound to the account that started it, the key's
// acceptance rules, where the key is kept, and the custody check before a
// request leaves. The module holds its state at module scope, so every row
// imports a fresh copy with its own account slot.

type Connection = typeof import("./openrouterConnection");

let mod: Connection;
let setCurrentUserId: (id: string | null) => void;

// ── A same-origin channel, delivered in order ────────────────────────────────

class FakeChannel {
  static open = new Set<FakeChannel>();
  private readonly listeners = new Set<(event: MessageEvent) => void>();
  constructor(readonly name: string) {
    FakeChannel.open.add(this);
  }
  addEventListener(_type: "message", listen: (event: MessageEvent) => void) {
    this.listeners.add(listen);
  }
  removeEventListener(_type: "message", listen: (event: MessageEvent) => void) {
    this.listeners.delete(listen);
  }
  postMessage(data: unknown) {
    for (const other of [...FakeChannel.open])
      if (other !== this && other.name === this.name)
        for (const listen of other.listeners) listen({ data } as MessageEvent);
  }
  close() {
    FakeChannel.open.delete(this);
  }
}

// ── The vendor ───────────────────────────────────────────────────────────────

const KEY_URL = "https://openrouter.ai/api/v1/key";
const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const MINTED = "sk-or-v1-minted";

/** A `GET /api/v1/key` body for an acceptable key, with fields replaced. */
function keyBody(data: Record<string, unknown> = {}) {
  return {
    data: {
      label: "sk-or-v1-min...ted",
      limit: 5,
      limit_remaining: 5,
      limit_reset: null,
      include_byok_in_limit: true,
      usage: 0,
      byok_usage: 0,
      is_management_key: false,
      expires_at: null,
      ...data,
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let exchangeAnswer: () => Response | Promise<Response>;
let keyAnswer: () => Response | Promise<Response>;
let calls: Array<{ url: string; init: RequestInit }>;

function stubVendor() {
  calls = [];
  exchangeAnswer = () => json({ key: MINTED });
  keyAnswer = () => json(keyBody());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === EXCHANGE_URL) return exchangeAnswer();
      if (url === KEY_URL) return keyAnswer();
      return new Response("", { status: 404 });
    }),
  );
}

const keyReads = () => calls.filter((call) => call.url === KEY_URL).length;
const exchanges = () => calls.filter((call) => call.url === EXCHANGE_URL);

// ── The platform ─────────────────────────────────────────────────────────────

/** A vault holding `initial` as w1's kept key, with w1's choice to keep it. */
function fakeVault(initial: string | null = null) {
  let value = initial;
  if (initial !== null) localStorage.setItem("openrouter.remember.w1", "1");
  return {
    get: vi.fn<CredentialVault["get"]>(async () => value),
    set: vi.fn<CredentialVault["set"]>(async (_name, next, options) => {
      value = next;
      return { remembered: options.remember };
    }),
    delete: vi.fn<CredentialVault["delete"]>(async () => {
      value = null;
    }),
  };
}

let vault: ReturnType<typeof fakeVault>;
let platform: Platform;

function platformWith(store: ReturnType<typeof fakeVault>): Platform {
  return { vault: store } as unknown as Platform;
}

// ── The approval window ──────────────────────────────────────────────────────

/**
 * Starts an approval with a stubbed popup and waits until the tab has sent
 * the popup to the vendor, returning the consent URL's state and challenge.
 */
async function approval() {
  const popup: {
    location: { href: string };
    closed: boolean;
    opener: unknown;
  } = { location: { href: "" }, closed: false, opener: window };
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue(popup as unknown as Window);
  const outcome = mod.connectOpenRouter(platform, "Phospheare (test)");
  await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
  const consent = new URL(popup.location.href);
  return {
    outcome,
    open,
    popup,
    consent,
    state: consent.searchParams.get("state") ?? "",
    challenge: consent.searchParams.get("code_challenge") ?? "",
  };
}

/** Whether a promise is still unsettled after the queue drains. */
async function stillPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  const first = await Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(marker), 20)),
  ]);
  return first === marker;
}

async function sha256url(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const row = (writerId = "w1") => mod.openRouterStatus(writerId);

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  FakeChannel.open.clear();
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  stubVendor();
  ({ setCurrentUserId } = await import("../../auth/currentUser"));
  mod = await import("./openrouterConnection");
  setCurrentUserId("w1");
  vault = fakeVault();
  platform = platformWith(vault);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── The status ───────────────────────────────────────────────────────────────

describe("the OpenRouter status", () => {
  it("is always there, disconnected when no key is held", () => {
    expect(row()).toMatchObject({
      providerId: "openrouter",
      connected: false,
      upstreamHost: "openrouter.ai",
      state: null,
      notice: null,
      remembered: false,
      refusal: null,
      required: { limitUsd: 5 },
    });
    expect(mod.apiKeyFor("w1")).toBeNull();
  });

  it("answers the same object until something changes", async () => {
    // `useSyncExternalStore` loops on a snapshot that is new on every read.
    const first = mod.openRouterStatus("w1");
    expect(mod.openRouterStatus("w1")).toBe(first);

    vault = fakeVault("sk-or-held");
    await mod.refreshRemoteProviders("w1", platformWith(vault));
    expect(mod.openRouterStatus("w1")).not.toBe(first);
    expect(row().connected).toBe(true);
  });
});

// ── The approval ─────────────────────────────────────────────────────────────

describe("the approval flow", () => {
  it("opens the popup before any await, on the app's own callback page", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    void mod.connectOpenRouter(platform, "label");

    // Safari and Firefox block a window opened after the gesture's chain.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      "/app/connect/openrouter",
      "connect",
      expect.any(String),
    );
  });

  it("reports a blocked popup and starts nothing", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    await expect(mod.connectOpenRouter(platform, "label")).resolves.toBe(
      "blocked",
    );
    expect(mod.connectPending()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("sends the popup to the vendor with an S256 challenge and the callback page", async () => {
    const { consent, challenge } = await approval();

    expect(consent.origin + consent.pathname).toBe(
      "https://openrouter.ai/auth",
    );
    expect(consent.searchParams.get("code_challenge_method")).toBe("S256");
    expect(challenge).not.toBe("");
    expect(consent.searchParams.get("callback_url")).toBe(
      new URL("/app/connect/openrouter", window.location.origin).href,
    );
    expect(consent.searchParams.get("key_label")).toBe("Phospheare (test)");
    expect(mod.connectPending()).toBe(true);
  });

  it("ignores a callback whose state is not this flow's", async () => {
    const { outcome, state } = await approval();

    void mod.deliverCallback({ state: `${state}-other`, code: "forged" });

    expect(await stillPending(outcome)).toBe(true);
    expect(exchanges()).toHaveLength(0);

    void mod.deliverCallback({ state, code: "the-code" });
    await expect(outcome).resolves.toBe("connected");
  });

  it("exchanges a matching callback with its own verifier and stores the key", async () => {
    const { outcome, state, challenge } = await approval();

    void mod.deliverCallback({ state, code: "the-code" });

    await expect(outcome).resolves.toBe("connected");
    const [exchange] = exchanges();
    const sent = JSON.parse(String(exchange.init.body)) as {
      code: string;
      code_verifier: string;
      code_challenge_method: string;
    };
    expect(sent.code).toBe("the-code");
    expect(sent.code_challenge_method).toBe("S256");
    // The verifier never left the tab before this call, and it is the one
    // whose hash the vendor was shown.
    expect(await sha256url(sent.code_verifier)).toBe(challenge);
    expect(vault.set).toHaveBeenCalledWith("openrouter.key", MINTED, {
      remember: false,
    });
    expect(mod.apiKeyFor("w1")).toBe(MINTED);
    expect(row()).toMatchObject({
      connected: true,
      state: "ready",
      limitUsd: 5,
      refusal: null,
    });
    expect(mod.connectPending()).toBe(false);
  });

  it("ends as cancelled when the writer declines at the vendor", async () => {
    const { outcome, state } = await approval();

    void mod.deliverCallback({ state, code: null });

    await expect(outcome).resolves.toBe("cancelled");
    expect(exchanges()).toHaveLength(0);
    expect(vault.set).not.toHaveBeenCalled();
  });

  it("cancels the earlier flow when a second one starts", async () => {
    const first = await approval();
    const second = await approval();

    await expect(first.outcome).resolves.toBe("cancelled");
    void mod.deliverCallback({ state: first.state, code: "late" });
    expect(exchanges()).toHaveLength(0);

    void mod.deliverCallback({ state: second.state, code: "the-code" });
    await expect(second.outcome).resolves.toBe("connected");
  });
});

// ── The window, watched ──────────────────────────────────────────────────────

describe("the approval window, watched", () => {
  const timers = () =>
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });

  it("cuts the window's opener before sending it to the vendor, and keeps its own handle", async () => {
    let href = "";
    let openerWhenSent: unknown = "unset";
    const popup = { opener: window as unknown, closed: false, location: {} };
    Object.defineProperty(popup.location, "href", {
      get: () => href,
      set: (value: string) => {
        openerWhenSent = popup.opener;
        href = value;
      },
    });
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    void mod.connectOpenRouter(platform, "label");

    // Only a same-origin window takes the assignment, so it is made before
    // any await, while the window still shows this app's page.
    expect(popup.opener).toBeNull();
    await vi.waitFor(() => expect(href).toContain("https://openrouter.ai/"));
    expect(openerWhenSent).toBeNull();
  });

  it("goes on when a reused window already elsewhere refuses the opener cut", async () => {
    let href = "";
    const popup = { closed: false, location: {} };
    Object.defineProperty(popup, "opener", {
      get: () => window,
      set: () => {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    });
    Object.defineProperty(popup.location, "href", {
      get: () => href,
      set: (value: string) => {
        href = value;
      },
    });
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    void mod.connectOpenRouter(platform, "label");

    await vi.waitFor(() => expect(href).toContain("https://openrouter.ai/"));
    expect(mod.connectPending()).toBe(true);
  });

  it("ends as cancelled when the window closes while this tab has focus", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { outcome, popup } = await approval();

    popup.closed = true;

    await expect(outcome).resolves.toBe("cancelled");
    expect(mod.connectPending()).toBe(false);
  });

  it("keeps waiting on a window that reads closed while focus is elsewhere", async () => {
    // A vendor page with its own Cross-Origin-Opener-Policy cuts the handle,
    // which then reads closed while the writer is still approving.
    timers();
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { outcome, popup } = await approval();
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false);
    expect(mod.connectPending()).toBe(true);

    focus.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    await expect(outcome).resolves.toBe("cancelled");
  });

  it("gives up after ten minutes and leaves no flow behind", async () => {
    timers();
    const { outcome, state } = await approval();

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    await expect(outcome).resolves.toBe("cancelled");
    expect(mod.connectPending()).toBe(false);
    // A late callback finds no flow to exchange for.
    void mod.deliverCallback({ state, code: "late" }, 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(exchanges()).toHaveLength(0);
  });

  it("acknowledges a callback that names its flow, and only that one", async () => {
    const { outcome, state } = await approval();

    await expect(
      mod.deliverCallback({ state: `${state}-other`, code: "forged" }, 20),
    ).resolves.toBe(false);
    await expect(
      mod.deliverCallback({ state, code: "the-code" }),
    ).resolves.toBe(true);
    await expect(outcome).resolves.toBe("connected");
  });

  it("acknowledges nothing when no tab has the flow", async () => {
    await expect(
      mod.deliverCallback({ state: "nobody's", code: "the-code" }, 20),
    ).resolves.toBe(false);
  });

  it("acknowledges nothing where no channel exists", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    await expect(
      mod.deliverCallback({ state: "s", code: "c" }, 20),
    ).resolves.toBe(false);
  });

  it("survives a channel that cannot be opened, and opens it for a later flow", async () => {
    let refuse = true;
    class Refusing extends FakeChannel {
      constructor(name: string) {
        if (refuse) throw new DOMException("refused", "SecurityError");
        super(name);
      }
    }
    vi.stubGlobal("BroadcastChannel", Refusing);

    const first = await approval();
    await expect(
      mod.deliverCallback({ state: first.state, code: "lost" }, 20),
    ).resolves.toBe(false);

    refuse = false;
    const second = await approval();
    await expect(first.outcome).resolves.toBe("cancelled");
    await expect(
      mod.deliverCallback({ state: second.state, code: "the-code" }),
    ).resolves.toBe(true);
    await expect(second.outcome).resolves.toBe("connected");
  });
});

// ── Refusals ─────────────────────────────────────────────────────────────────

describe("what the flow refuses", () => {
  it.each([
    ["a key with no limit", keyBody({ limit: null }), "no-limit"],
    ["a limit above $5", keyBody({ limit: 6 }), "limit-too-high"],
    [
      "a management key",
      keyBody({ is_management_key: true }),
      "management-key",
    ],
  ])("refuses %s and stores nothing", async (_name, body, reason) => {
    keyAnswer = () => json(body);
    const { outcome, state } = await approval();

    void mod.deliverCallback({ state, code: "the-code" });

    await expect(outcome).resolves.toBe(reason);
    expect(vault.set).not.toHaveBeenCalled();
    expect(mod.apiKeyFor("w1")).toBeNull();
    expect(row()).toMatchObject({ connected: false, refusal: reason });
  });

  it("accepts a limit of exactly $5", async () => {
    keyAnswer = () => json(keyBody({ limit: 5, limit_remaining: 5 }));
    const { outcome, state } = await approval();

    void mod.deliverCallback({ state, code: "the-code" });

    await expect(outcome).resolves.toBe("connected");
  });

  it("calls a refused exchange an expired code", async () => {
    exchangeAnswer = () => new Response("", { status: 403 });
    const { outcome, state } = await approval();

    void mod.deliverCallback({ state, code: "spent-code" });

    await expect(outcome).resolves.toBe("exchange-expired");
    expect(keyReads()).toBe(0);
    expect(vault.set).not.toHaveBeenCalled();
    expect(row().refusal).toBe("exchange-expired");
  });

  it("clears an earlier refusal once a key is accepted", async () => {
    exchangeAnswer = () => new Response("", { status: 403 });
    const first = await approval();
    void mod.deliverCallback({ state: first.state, code: "spent-code" });
    await first.outcome;

    exchangeAnswer = () => json({ key: MINTED });
    const second = await approval();
    void mod.deliverCallback({ state: second.state, code: "the-code" });

    await expect(second.outcome).resolves.toBe("connected");
    expect(row().refusal).toBeNull();
  });
});

// ── A flow that outlives its writer ──────────────────────────────────────────

describe("a late callback", () => {
  it("is superseded after a writer change, exchanged and stored never", async () => {
    const { outcome, state } = await approval();

    setCurrentUserId("w2");
    void mod.deliverCallback({ state, code: "the-code" });

    await expect(outcome).resolves.toBe("superseded");
    expect(exchanges()).toHaveLength(0);
    expect(vault.set).not.toHaveBeenCalled();
    expect(mod.apiKeyFor("w1")).toBeNull();
    expect(mod.apiKeyFor("w2")).toBeNull();
  });

  it("is superseded when the writer changes while the key is read", async () => {
    keyAnswer = () => {
      setCurrentUserId("w2");
      return json(keyBody());
    };
    const { outcome, state } = await approval();

    void mod.deliverCallback({ state, code: "the-code" });

    await expect(outcome).resolves.toBe("superseded");
    expect(vault.set).not.toHaveBeenCalled();
    expect(mod.apiKeyFor("w1")).toBeNull();
    expect(mod.apiKeyFor("w2")).toBeNull();
  });
});

// ── Where the key is kept ────────────────────────────────────────────────────

describe("remembering the key", () => {
  it("stores a new key to outlive the session when the writer chose so", async () => {
    await mod.setRemember("w1", platform, true);
    expect(mod.rememberPreference("w1")).toBe(true);
    const { outcome, state } = await approval();

    void mod.deliverCallback({ state, code: "the-code" });

    await expect(outcome).resolves.toBe("connected");
    expect(vault.set).toHaveBeenCalledWith("openrouter.key", MINTED, {
      remember: true,
    });
    expect(row().remembered).toBe(true);
  });

  it("keeps the choice per writer", async () => {
    await mod.setRemember("w1", platform, true);

    expect(mod.rememberPreference("w1")).toBe(true);
    expect(mod.rememberPreference("w2")).toBe(false);
  });

  it("moves a held key into the vault and back out again", async () => {
    const { outcome, state } = await approval();
    void mod.deliverCallback({ state, code: "the-code" });
    await outcome;
    vault.set.mockClear();

    await mod.setRemember("w1", platform, true);
    expect(vault.set).toHaveBeenLastCalledWith("openrouter.key", MINTED, {
      remember: true,
    });
    expect(row().remembered).toBe(true);

    await mod.setRemember("w1", platform, false);
    expect(vault.set).toHaveBeenLastCalledWith("openrouter.key", MINTED, {
      remember: false,
    });
    expect(row().remembered).toBe(false);
    expect(mod.rememberPreference("w1")).toBe(false);
    // The session still holds it.
    expect(mod.apiKeyFor("w1")).toBe(MINTED);
  });

  it("does not ask the vault without the choice to remember", async () => {
    // A kept key a failed forget left behind stays shut.
    vault = fakeVault("sk-or-left");
    localStorage.removeItem("openrouter.remember.w1");

    await mod.refreshRemoteProviders("w1", platformWith(vault));

    expect(vault.get).not.toHaveBeenCalled();
    expect(mod.apiKeyFor("w1")).toBeNull();
  });

  it("turns the choice back when the key could not be sealed", async () => {
    const { outcome, state } = await approval();
    void mod.deliverCallback({ state, code: "the-code" });
    await outcome;
    vault.set.mockResolvedValueOnce({ remembered: false });

    await mod.setRemember("w1", platform, true);

    expect(row().remembered).toBe(false);
    expect(mod.rememberPreference("w1")).toBe(false);
  });

  it("marks a removed key until a new one connects", async () => {
    vault = fakeVault("sk-or-held");
    platform = platformWith(vault);
    await mod.refreshRemoteProviders("w1", platform);
    expect(row().keyRemoved).toBe(false);

    await mod.disconnectOpenRouter("w1", platform);
    expect(row().keyRemoved).toBe(true);

    const { outcome, state } = await approval();
    void mod.deliverCallback({ state, code: "the-code" });
    await outcome;
    expect(row().keyRemoved).toBe(false);
  });

  it("closes the choice when a disconnect could not forget the kept key", async () => {
    vault = fakeVault("sk-or-held");
    platform = platformWith(vault);
    await mod.refreshRemoteProviders("w1", platform);
    vault.delete.mockRejectedValueOnce(new Error("unavailable"));

    await mod.disconnectOpenRouter("w1", platform);

    expect(mod.rememberPreference("w1")).toBe(false);
  });

  it("reads a remembered key back from the vault", async () => {
    vault = fakeVault("sk-or-held");

    await mod.refreshRemoteProviders("w1", platformWith(vault));

    expect(mod.apiKeyFor("w1")).toBe("sk-or-held");
    expect(row()).toMatchObject({ connected: true, remembered: true });
    expect(keyReads()).toBe(1);
  });

  it("disconnects: the key leaves the vault and the row", async () => {
    vault = fakeVault("sk-or-held");
    platform = platformWith(vault);
    await mod.refreshRemoteProviders("w1", platform);

    await mod.disconnectOpenRouter("w1", platform);

    expect(vault.delete).toHaveBeenCalledWith("openrouter.key");
    expect(mod.apiKeyFor("w1")).toBeNull();
    expect(row()).toMatchObject({ connected: false, refusal: null });
  });

  it("drops a key whose limit was lifted at the vendor", async () => {
    vault = fakeVault("sk-or-held");
    keyAnswer = () => json(keyBody({ limit: null }));

    await mod.refreshRemoteProviders("w1", platformWith(vault));

    expect(vault.delete).toHaveBeenCalledWith("openrouter.key");
    expect(mod.apiKeyFor("w1")).toBeNull();
    expect(row()).toMatchObject({ connected: false, refusal: "no-limit" });
  });
});

// ── The custody check ────────────────────────────────────────────────────────

describe("the check before a request leaves", () => {
  const signal = () => new AbortController().signal;

  async function holdKey() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    vault = fakeVault("sk-or-held");
    platform = platformWith(vault);
    await mod.refreshRemoteProviders("w1", platform);
    expect(keyReads()).toBe(1);
  }

  const later = (ms: number) =>
    vi.setSystemTime(new Date(Date.parse("2026-10-27T10:00:00Z") + ms));

  it("refuses a writer with no key as not configured", async () => {
    await expect(mod.beforeSendFor("w1")(signal())).resolves.toMatchObject({
      code: "not-configured",
    });
  });

  it("passes a ready key on a reading younger than a minute, without reading again", async () => {
    await holdKey();

    await expect(mod.beforeSendFor("w1")(signal())).resolves.toBeNull();
    later(59_000);
    await expect(mod.beforeSendFor("w1")(signal())).resolves.toBeNull();

    expect(keyReads()).toBe(1);
  });

  it("reads again after a minute, and says key-expired for a revoked key", async () => {
    await holdKey();
    keyAnswer = () => new Response("", { status: 401 });

    later(61_000);
    await expect(mod.beforeSendFor("w1")(signal())).resolves.toMatchObject({
      code: "key-expired",
      retryable: false,
    });

    expect(keyReads()).toBe(2);
    // Still handed over, so every later request is refused by this check
    // as key-expired, with Renew, and never as not-configured.
    expect(mod.apiKeyFor("w1")).toBe("sk-or-held");
    expect(row()).toMatchObject({ state: "expired", refusal: "revoked" });
    await expect(mod.beforeSendFor("w1")(signal())).resolves.toMatchObject({
      code: "key-expired",
    });
  });

  it("refuses a key with no reading as unreachable, without sending", async () => {
    keyAnswer = () => new Response("", { status: 502 });
    vault = fakeVault("sk-or-held");
    await mod.refreshRemoteProviders("w1", platformWith(vault));

    await expect(mod.beforeSendFor("w1")(signal())).resolves.toMatchObject({
      code: "connection",
      retryable: true,
    });
    // Read again for the request, and still nothing to judge by.
    expect(keyReads()).toBe(2);
    // The row's refusal copy says nothing was saved, which a held key belies.
    expect(row()).toMatchObject({ connected: true, refusal: null });
  });

  it("judges a new key in the vault on its own reading, not the old key's refusal", async () => {
    vault = fakeVault("sk-or-old");
    platform = platformWith(vault);
    keyAnswer = () => new Response("", { status: 401 });
    await mod.refreshRemoteProviders("w1", platform);
    expect(row()).toMatchObject({ state: "expired", refusal: "revoked" });

    await vault.set("openrouter.key", "sk-or-new", { remember: true });
    keyAnswer = () => new Response("", { status: 502 });
    await mod.refreshRemoteProviders("w1", platform);

    expect(mod.apiKeyFor("w1")).toBe("sk-or-new");
    expect(row()).toMatchObject({
      connected: true,
      state: "ready",
      refusal: null,
    });
    // Unread, the new key is unjudged, not revoked.
    await expect(mod.beforeSendFor("w1")(signal())).resolves.toMatchObject({
      code: "connection",
    });
  });

  it("reads again when the last reading comes from a spend window that has ended", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T23:59:30Z"));
    const spentToday = (spent: number) =>
      json(
        keyBody({
          limit_reset: "daily",
          usage: 9,
          usage_daily: spent,
          byok_usage_daily: 0,
          limit_remaining: 5 - spent,
        }),
      );
    keyAnswer = () => spentToday(5);
    vault = fakeVault("sk-or-held");
    await mod.refreshRemoteProviders("w1", platformWith(vault));
    expect(row().state).toBe("limit-reached");

    // Inside the minute a reading is trusted for, but in a new day, where
    // the previous day's spend does not count against the key.
    vi.setSystemTime(new Date("2026-10-28T00:00:10Z"));
    keyAnswer = () => spentToday(0);

    await expect(mod.beforeSendFor("w1")(signal())).resolves.toBeNull();
    expect(keyReads()).toBe(2);
    expect(row().state).toBe("ready");
  });

  it("refuses as unreachable when a reading from an ended window cannot be renewed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T23:59:30Z"));
    keyAnswer = () =>
      json(
        keyBody({
          limit_reset: "daily",
          usage_daily: 1,
          byok_usage_daily: 0,
          limit_remaining: 4,
        }),
      );
    vault = fakeVault("sk-or-held");
    await mod.refreshRemoteProviders("w1", platformWith(vault));

    vi.setSystemTime(new Date("2026-10-28T00:00:10Z"));
    keyAnswer = () => new Response("", { status: 502 });

    await expect(mod.beforeSendFor("w1")(signal())).resolves.toMatchObject({
      code: "connection",
    });
  });

  it("reads again after a minute, and says limit-reached for a spent key", async () => {
    await holdKey();
    keyAnswer = () =>
      json(keyBody({ usage: 5, byok_usage: 0, limit_remaining: 0 }));

    later(61_000);
    await expect(mod.beforeSendFor("w1")(signal())).resolves.toMatchObject({
      code: "limit-reached",
      retryable: false,
    });

    expect(keyReads()).toBe(2);
    expect(row().state).toBe("limit-reached");
    // Spent is not revoked: the key stays, for a reset or a new limit.
    expect(mod.apiKeyFor("w1")).toBe("sk-or-held");
  });

  it("keeps the last reading when the vendor cannot be reached", async () => {
    await holdKey();
    keyAnswer = () => new Response("", { status: 502 });

    later(61_000);
    await expect(mod.beforeSendFor("w1")(signal())).resolves.toBeNull();
    expect(row().state).toBe("ready");
  });

  it("reads again at once after an answer marks the key stale", async () => {
    await holdKey();
    keyAnswer = () =>
      json(keyBody({ usage: 5, byok_usage: 0, limit_remaining: 0 }));

    mod.markKeyStale("w1");

    await expect(mod.beforeSendFor("w1")(signal())).resolves.toMatchObject({
      code: "limit-reached",
    });
    expect(keyReads()).toBe(2);
  });

  it("joins one reading in flight, whoever asks for it", async () => {
    await holdKey();
    later(61_000);

    await Promise.all([
      mod.beforeSendFor("w1")(signal()),
      mod.beforeSendFor("w1")(signal()),
      mod.refreshRemoteProviders("w1", platform),
    ]);

    expect(keyReads()).toBe(2);
  });

  it("reads once more when the key is marked stale while a reading runs", async () => {
    await holdKey();
    let answer: (response: Response) => void = () => {};
    keyAnswer = () => new Promise<Response>((resolve) => (answer = resolve));
    later(61_000);

    const check = mod.beforeSendFor("w1")(signal());
    await vi.waitFor(() => expect(keyReads()).toBe(2));
    mod.markKeyStale("w1");
    keyAnswer = () =>
      json(keyBody({ usage: 5, byok_usage: 0, limit_remaining: 0 }));
    answer(json(keyBody()));

    // The reading taken before the spend does not stand for the one after.
    await expect(check).resolves.toMatchObject({ code: "limit-reached" });
    expect(keyReads()).toBe(3);
  });

  it("tells the surfaces only when the reading changed", async () => {
    await holdKey();
    mod.openRouterStatus("w1");
    const heard = vi.fn();
    mod.subscribeRemoteProviders(heard);

    later(61_000);
    await mod.beforeSendFor("w1")(signal());
    expect(keyReads()).toBe(2);
    expect(heard).not.toHaveBeenCalled();

    keyAnswer = () =>
      json(keyBody({ usage: 5, byok_usage: 0, limit_remaining: 0 }));
    later(122_000);
    await mod.beforeSendFor("w1")(signal());
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

// ── The editor's renew button ────────────────────────────────────────────────

describe("the editor's renew button", () => {
  it("starts the same approval through the registered connector", async () => {
    const { openConnectPopup } = await import("../connectPath");
    await mod.refreshRemoteProviders("w1", platform);
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openConnectPopup("openrouter");
    openConnectPopup("another-provider");

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe("/app/connect/openrouter");
  });
});
