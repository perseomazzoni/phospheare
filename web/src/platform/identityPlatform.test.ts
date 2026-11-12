// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identityPlatform } from "./identityPlatform";
import { forgetIdentityProof, IDENTITY_PROOF_PREFIX } from "./index";

// Pins the SPA's side of the identity service's wire: the header every call
// carries, how a refusal maps to a platform code, the writer session every
// credential call waits for, and the consent popup's flow from the writer's
// click to the service's `finish` answer. `fetch` and `window.open` are
// stubbed; the callback arrives on a real BroadcastChannel.

interface Call {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit;
}

type Answer = Response | Promise<Response>;
let handler: (call: Call) => Answer;
let calls: Call[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const noContent = () => new Response(null, { status: 204 });

/** The service's answer to opening a session: the proof to send after. */
const sessionOpened = (proof = "proof-1") => json({ proof });

/** A session opens; anything else answers `204`. */
const answered = (call: Call): Response =>
  call.path === "/identity/session" && call.method === "POST"
    ? sessionOpened()
    : noContent();

function problem(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

/** An identity answer the test sends by hand. */
function deferred() {
  let answer!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => (answer = resolve));
  return { promise, answer };
}

function fakePopup() {
  return { location: { href: "" }, close: vi.fn(), closed: false };
}

function callback(message: unknown): void {
  const channel = new BroadcastChannel("phospheare-oauth");
  channel.postMessage(message);
  channel.close();
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
  handler = answered;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call: Call = {
        path: url,
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        init,
      };
      calls.push(call);
      return handler(call);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const paths = () => calls.map((c) => `${c.method} ${c.path}`);

describe("the identity wire", () => {
  it("marks every call with X-Phospheare and keeps it on this origin", async () => {
    handler = () => json({ accessToken: "t", expiresIn: 3600 });
    const platform = identityPlatform();
    await platform.driveAccessToken({ connectionId: "c1" });

    const [call] = calls;
    expect(call.path).toBe("/identity/google/token");
    expect(call.method).toBe("POST");
    expect(call.headers["X-Phospheare"]).toBe("1");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.body).toEqual({ connectionId: "c1" });
    expect(call.init.credentials).toBe("same-origin");
    expect(call.init.redirect).toBe("error");
  });

  it.each([
    [
      "a code the platform knows",
      problem(409, { code: "grant-invalid" }),
      "grant-invalid",
    ],
    [
      "a code it does not know",
      problem(400, { code: "teapot" }),
      "unavailable",
    ],
    ["a 4xx with no code", problem(403), "unavailable"],
    ["a 5xx with no code", problem(502), "unavailable"],
    [
      "an unreadable 5xx",
      new Response("<html>", { status: 503 }),
      "unavailable",
    ],
  ])("maps %s to its platform code", async (_label, response, code) => {
    handler = () => response;
    const platform = identityPlatform();
    await expect(
      platform.driveAccessToken({ connectionId: "c1" }),
    ).rejects.toMatchObject({ name: "PlatformError", code });
  });

  it("carries the service's retry hint", async () => {
    handler = () =>
      problem(503, { code: "google-unreachable", retryAfterSeconds: 30 });
    const platform = identityPlatform();
    await expect(
      platform.driveAccessToken({ connectionId: "c1" }),
    ).rejects.toMatchObject({
      code: "google-unreachable",
      retryAfterSeconds: 30,
    });
  });

  it("reads a service that cannot be reached as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const platform = identityPlatform();
    await expect(
      platform.driveAccessToken({ connectionId: "c1" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("has the service seal remembered credentials while it answers", async () => {
    const platform = identityPlatform();
    expect(platform.credentialProtection).toBe("sealed");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(platform.reachable()).resolves.toBe(false);
    expect(platform.credentialProtection).toBe("unavailable");
  });

  it("calls nothing until a credential is asked for", () => {
    identityPlatform();
    expect(calls).toEqual([]);
  });
});

describe("the reachability probe", () => {
  it("asks for the session without a proof, and reads no session as reachable", async () => {
    localStorage.setItem(`${IDENTITY_PROOF_PREFIX}w1`, "kept-proof");
    handler = () => json({ writerId: null });

    await expect(identityPlatform().reachable()).resolves.toBe(true);
    expect(paths()).toEqual(["GET /identity/session"]);
    expect(calls[0].headers["X-Phospheare"]).toBe("1");
    expect(calls[0].headers["X-Phospheare-Session"]).toBeUndefined();
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["an open session", () => json({ writerId: "w1" })],
    ["another of its codes", () => problem(409, { code: "writer-mismatch" })],
    [
      "a refusal of its own the platform has no code for",
      () => problem(429, { code: "rate-limited" }),
    ],
  ])("reads %s as reachable", async (_label, answer) => {
    handler = answer;
    await expect(identityPlatform().reachable()).resolves.toBe(true);
  });

  it.each([
    ["a proxy's error page", () => new Response("<html>", { status: 502 })],
    ["an empty gateway timeout", () => new Response(null, { status: 504 })],
    ["a refusal with no code", () => problem(404)],
    [
      "a page answered as success",
      () => new Response("<html>", { status: 200 }),
    ],
    ["other JSON answered as success", () => json({ ok: true })],
    ["an empty success", () => new Response(null, { status: 204 })],
  ])("reads %s as unreachable", async (_label, answer) => {
    handler = answer;
    await expect(identityPlatform().reachable()).resolves.toBe(false);
  });

  it("reads a network error as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(identityPlatform().reachable()).resolves.toBe(false);
  });

  it("gives up after three seconds and reads the silence as unreachable", async () => {
    const timeout = new AbortController();
    const bound = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    handler = (call) =>
      new Promise<Response>((_resolve, reject) =>
        call.init.signal?.addEventListener("abort", () =>
          reject(new DOMException("timed out", "TimeoutError")),
        ),
      );

    const probe = identityPlatform().reachable();
    expect(bound).toHaveBeenCalledWith(3_000);
    timeout.abort();
    await expect(probe).resolves.toBe(false);
  });
});

describe("the writer session", () => {
  it("binds the writer, and every later call waits for the binding", async () => {
    const session = deferred();
    handler = (call) =>
      call.path === "/identity/session"
        ? session.promise
        : json({ accessToken: "t", expiresIn: 3600 });
    const platform = identityPlatform();

    const opened = platform.openSession("writer-a");
    const token = platform.driveAccessToken({ connectionId: "c1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(paths()).toEqual(["POST /identity/session"]);
    expect(calls[0].body).toEqual({ writerId: "writer-a" });

    session.answer(sessionOpened());
    await opened;
    await expect(token).resolves.toEqual({ accessToken: "t", expiresIn: 3600 });
    expect(paths()).toEqual([
      "POST /identity/session",
      "POST /identity/google/token",
    ]);
  });

  it("does not bind twice for the same writer", async () => {
    const platform = identityPlatform();
    await platform.openSession("writer-a");
    await platform.openSession("writer-a");
    expect(paths()).toEqual(["POST /identity/session"]);
  });

  it("restates the binding once when the service has lost it, and retries", async () => {
    // A service restarted with a rotated key answers no-session for a session
    // this tab believes open.
    let tokenCalls = 0;
    handler = (call) => {
      if (call.path === "/identity/session") return sessionOpened();
      tokenCalls++;
      return tokenCalls === 1
        ? problem(401, { code: "no-session" })
        : json({ accessToken: "t", expiresIn: 3600 });
    };
    const platform = identityPlatform();
    await platform.openSession("writer-a");

    await expect(
      platform.driveAccessToken({ connectionId: "c1" }),
    ).resolves.toMatchObject({
      accessToken: "t",
    });
    expect(paths()).toEqual([
      "POST /identity/session",
      "POST /identity/google/token",
      "POST /identity/session",
      "POST /identity/google/token",
    ]);
  });

  it("gives up after the one retry", async () => {
    handler = (call) =>
      call.path === "/identity/session"
        ? sessionOpened()
        : problem(401, { code: "no-session" });
    const platform = identityPlatform();
    await platform.openSession("writer-a");

    await expect(
      platform.driveAccessToken({ connectionId: "c1" }),
    ).rejects.toMatchObject({ code: "no-session" });
    expect(
      calls.filter((c) => c.path === "/identity/google/token"),
    ).toHaveLength(2);
  });

  it("opens the binding again after a failed one", async () => {
    let sessions = 0;
    handler = (call) => {
      if (call.path !== "/identity/session")
        return json({ accessToken: "t", expiresIn: 1 });
      sessions++;
      return sessions === 1 ? problem(500) : sessionOpened();
    };
    const platform = identityPlatform();
    await expect(platform.openSession("writer-a")).rejects.toMatchObject({
      code: "unavailable",
    });
    await platform.driveAccessToken({ connectionId: "c1" });
    expect(paths()).toEqual([
      "POST /identity/session",
      "POST /identity/session",
      "POST /identity/google/token",
    ]);
  });

  it("ends the binding at the service and stops restating it", async () => {
    const platform = identityPlatform();
    await platform.openSession("writer-a");
    await platform.closeSession();
    handler = () => json({ accessToken: "t", expiresIn: 3600 });
    await platform.driveAccessToken({ connectionId: "c1" });
    expect(paths()).toEqual([
      "POST /identity/session",
      "DELETE /identity/session",
      "POST /identity/google/token",
    ]);
  });

  it("leaves the service's session alone when asked, ending only the binding", async () => {
    // The browser holds one session cookie, which another tab may already
    // have bound to another writer.
    localStorage.clear();
    const platform = identityPlatform();
    await platform.openSession("writer-a");
    await platform.closeSession({ server: false });
    expect(paths()).toEqual(["POST /identity/session"]);
    expect(localStorage.getItem("identity.proof.writer-a")).toBeNull();
  });

  it("answers the vault for the bound writer only", async () => {
    const platform = identityPlatform();
    await expect(platform.vault.get("openrouter.key")).rejects.toThrow(
      "No writer session is open.",
    );
    await platform.openSession("writer-a");
    await platform.vault.set("openrouter.key", "secret", { remember: false });
    await expect(platform.vault.get("openrouter.key")).resolves.toBe("secret");
    await platform.closeSession();
    await platform.openSession("writer-a");
    await expect(platform.vault.get("openrouter.key")).resolves.toBeNull();
  });

  it("has the service seal, open and forget a remembered credential", async () => {
    let kept: string | null = null;
    handler = (call) => {
      if (call.path === "/identity/credentials/openrouter.key") {
        kept =
          call.method === "PUT" ? (call.body as { value: string }).value : null;
        return noContent();
      }
      if (call.path === "/identity/credentials/openrouter.key/open")
        return kept === null
          ? problem(404, { code: "no-credential" })
          : json({ value: kept });
      return answered(call);
    };
    const platform = identityPlatform();
    await platform.openSession("writer-a");
    await expect(
      platform.vault.set("openrouter.key", "sk-a", { remember: true }),
    ).resolves.toEqual({ remembered: true });
    expect(calls[calls.length - 1]).toMatchObject({
      method: "PUT",
      body: { value: "sk-a" },
      headers: expect.objectContaining({ "X-Phospheare-Session": "proof-1" }),
    });
    await platform.closeSession({ server: false });
    await platform.openSession("writer-a");
    await expect(platform.vault.get("openrouter.key")).resolves.toBe("sk-a");
    await platform.vault.delete("openrouter.key");
    expect(calls[calls.length - 1]).toMatchObject({
      method: "DELETE",
      body: { writerId: "writer-a" },
    });
    await expect(platform.vault.get("openrouter.key")).resolves.toBeNull();
  });

  it("asks the service to drop, and optionally revoke, a Drive grant", async () => {
    handler = (call) =>
      call.path.startsWith("/identity/google/connections/")
        ? json({ revokedAtGoogle: true })
        : answered(call);
    const platform = identityPlatform();
    await expect(
      platform.disconnectDrive({ connectionId: "c/1", revoke: true }),
    ).resolves.toEqual({ revokedAtGoogle: true });
    expect(calls[0]).toMatchObject({
      path: "/identity/google/connections/c%2F1",
      method: "DELETE",
      body: { revoke: true },
    });
  });

  it("restates the binding once on writer-mismatch, and retries", async () => {
    // Another tab bound the browser's one session cookie to another writer.
    let tokenCalls = 0;
    handler = (call) => {
      if (call.path === "/identity/session") return sessionOpened();
      tokenCalls++;
      return tokenCalls === 1
        ? problem(403, { code: "writer-mismatch" })
        : json({ accessToken: "t", expiresIn: 3600 });
    };
    const platform = identityPlatform();
    await platform.openSession("writer-a");

    await expect(
      platform.driveAccessToken({ connectionId: "c1" }),
    ).resolves.toMatchObject({ accessToken: "t" });
    expect(paths()).toEqual([
      "POST /identity/session",
      "POST /identity/google/token",
      "POST /identity/session",
      "POST /identity/google/token",
    ]);
  });
});

describe("the session proof", () => {
  it("keeps the proof the service answered and sends it on every session call", async () => {
    handler = (call) =>
      call.path === "/identity/session"
        ? sessionOpened("proof-a")
        : json({ accessToken: "t", expiresIn: 3600 });
    const platform = identityPlatform();
    await platform.openSession("writer-a");
    await platform.driveAccessToken({ connectionId: "c1" });
    await platform.disconnectDrive({ connectionId: "c1", revoke: true });

    expect(localStorage.getItem("identity.proof.writer-a")).toBe("proof-a");
    expect(calls[0].headers["X-Phospheare-Session"]).toBeUndefined();
    expect(calls[1].headers["X-Phospheare-Session"]).toBe("proof-a");
    expect(calls[2].headers["X-Phospheare-Session"]).toBe("proof-a");
  });

  it("lets another tab of the origin keep the session with the stored proof", async () => {
    localStorage.setItem("identity.proof.writer-a", "proof-a");
    handler = () => sessionOpened("proof-a");
    await identityPlatform().openSession("writer-a");
    expect(calls[0].headers["X-Phospheare-Session"]).toBe("proof-a");
  });

  it("sends the newest proof another tab kept", async () => {
    handler = (call) =>
      call.path === "/identity/session"
        ? sessionOpened("proof-a")
        : json({ accessToken: "t", expiresIn: 3600 });
    const platform = identityPlatform();
    await platform.openSession("writer-a");
    localStorage.setItem("identity.proof.writer-a", "proof-b");
    await platform.driveAccessToken({ connectionId: "c1" });
    expect(calls[1].headers["X-Phospheare-Session"]).toBe("proof-b");
  });

  it("reads a session answer without a proof as unavailable", async () => {
    handler = () => noContent();
    await expect(
      identityPlatform().openSession("writer-a"),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(localStorage.getItem("identity.proof.writer-a")).toBeNull();
  });

  it("forgets the proof when the session closes, or moves to another writer", async () => {
    const platform = identityPlatform();
    await platform.openSession("writer-a");
    await platform.openSession("writer-b");
    expect(localStorage.getItem("identity.proof.writer-a")).toBeNull();
    expect(localStorage.getItem("identity.proof.writer-b")).toBe("proof-1");
    await platform.closeSession();
    expect(localStorage.getItem("identity.proof.writer-b")).toBeNull();
  });

  it("forgets one writer's proof on request", () => {
    localStorage.setItem("identity.proof.writer-a", "proof-a");
    localStorage.setItem("identity.proof.writer-b", "proof-b");
    forgetIdentityProof("writer-a");
    expect(localStorage.getItem("identity.proof.writer-a")).toBeNull();
    expect(localStorage.getItem("identity.proof.writer-b")).toBe("proof-b");
    expect(IDENTITY_PROOF_PREFIX).toBe("identity.proof.");
  });
});

describe("the consent popup", () => {
  const identity = {
    iss: "https://accounts.google.com",
    sub: "sub-1",
    email: "maren@example.com",
    emailVerified: true,
    name: "Maren",
    picture: null,
  };

  it("refuses a blocked popup as popup-blocked, before asking the service", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const platform = identityPlatform();
    await expect(
      platform.signInWithGoogle({ writerId: "writer-a" }),
    ).rejects.toMatchObject({ code: "popup-blocked" });
    expect(calls.some((c) => c.path === "/identity/google/flows")).toBe(false);
  });

  it("opens the popup inside the call, before any await", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const platform = identityPlatform();
    void platform.signInWithGoogle({ writerId: "writer-a" }).catch(() => {});
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("sends the popup to Google and resolves the identity the service finished with", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    handler = (call) => {
      if (call.path === "/identity/google/flows")
        return json({
          flowId: "f1",
          authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s",
        });
      if (call.path === "/identity/google/flows/f1/finish")
        return json({ identity });
      return answered(call);
    };
    const platform = identityPlatform();
    const signIn = platform.signInWithGoogle({
      writerId: "writer-a",
      loginHint: "maren@example.com",
    });

    await vi.waitFor(() =>
      expect(popup.location.href).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth?state=s",
      ),
    );
    expect(
      calls.find((c) => c.path === "/identity/google/flows")?.body,
    ).toEqual({
      purpose: "identity",
      writerId: "writer-a",
      loginHint: "maren@example.com",
    });
    // Another flow's callback is not this one's.
    callback({ type: "phospheare-oauth", flowId: "other", status: "ok" });
    callback({ type: "phospheare-oauth", flowId: "f1", status: "ok" });

    await expect(signIn).resolves.toEqual(identity);
    expect(paths()).not.toContain("POST /identity/google/flows/other/finish");
  });

  it("asks the service for the outcome whatever status the callback reports", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    handler = (call) => {
      if (call.path === "/identity/google/flows")
        return json({
          flowId: "f2",
          authorizeUrl: "https://accounts.google.com/auth",
        });
      if (call.path === "/identity/google/flows/f2/finish")
        return problem(409, { code: "account-mismatch" });
      return answered(call);
    };
    const platform = identityPlatform();
    const connect = platform.connectDrive({
      writerId: "writer-a",
      expectedSub: "sub-1",
    });
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    expect(
      calls.find((c) => c.path === "/identity/google/flows")?.body,
    ).toEqual({
      purpose: "drive",
      writerId: "writer-a",
      expectedSub: "sub-1",
      loginHint: "sub-1",
    });
    callback({ type: "phospheare-oauth", flowId: "f2", status: "ok" });

    await expect(connect).rejects.toMatchObject({ code: "account-mismatch" });
  });

  it("resolves a Drive grant with its access token", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const connection = {
      connectionId: "c1",
      sub: "sub-1",
      email: "m@example.com",
      scopes: [],
    };
    handler = (call) => {
      if (call.path === "/identity/google/flows")
        return json({
          flowId: "f3",
          authorizeUrl: "https://accounts.google.com/auth",
        });
      if (call.path === "/identity/google/flows/f3/finish")
        return json({ connection, accessToken: "t" });
      return answered(call);
    };
    const platform = identityPlatform();
    const connect = platform.connectDrive({
      writerId: "writer-a",
      expectedSub: "sub-1",
    });
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    callback({ type: "phospheare-oauth", flowId: "f3", status: "ok" });

    await expect(connect).resolves.toEqual({
      grant: connection,
      token: { accessToken: "t", expiresIn: 3600 },
    });
  });

  it("finishes on the opener message when the channel cannot open", async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("Detached", "InvalidStateError");
        }
      },
    );
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    handler = (call) => {
      if (call.path === "/identity/google/flows")
        return json({
          flowId: "f4",
          authorizeUrl: "https://accounts.google.com/auth",
        });
      if (call.path === "/identity/google/flows/f4/finish")
        return json({ identity });
      return answered(call);
    };
    const platform = identityPlatform();
    const signIn = platform.signInWithGoogle({ writerId: "writer-a" });
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "phospheare-oauth", flowId: "f4", status: "ok" },
      }),
    );

    await expect(signIn).resolves.toEqual(identity);
  });

  it("refuses a consent address that is not Google's", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    handler = (call) =>
      call.path === "/identity/google/flows"
        ? json({
            flowId: "f4",
            authorizeUrl: "https://accounts.google.com.evil.example/auth",
          })
        : answered(call);
    const platform = identityPlatform();
    await expect(
      platform.signInWithGoogle({ writerId: "writer-a" }),
    ).rejects.toMatchObject({ code: "flow-failed" });
    expect(popup.location.href).toBe("");
  });

  it("closes the popup when the service cannot open the session", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    handler = () => new Response("<html>", { status: 502 });
    const platform = identityPlatform();
    await expect(
      platform.signInWithGoogle({ writerId: "writer-a" }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe("");
  });

  it("closes the popup when the service refuses to start the flow", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    handler = (call) =>
      call.path === "/identity/google/flows"
        ? problem(409, { code: "flow-failed" })
        : answered(call);
    const platform = identityPlatform();
    await expect(
      platform.signInWithGoogle({ writerId: "writer-a" }),
    ).rejects.toMatchObject({ code: "flow-failed" });
    expect(popup.close).toHaveBeenCalled();
  });

  it("restates a lost binding and starts the flow again in the same open popup", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    let begun = 0;
    handler = (call) => {
      if (call.path === "/identity/google/flows") {
        begun++;
        if (begun === 1) {
          expect(popup.close).not.toHaveBeenCalled();
          return problem(401, { code: "no-session" });
        }
        return json({
          flowId: "f5",
          authorizeUrl: "https://accounts.google.com/auth",
        });
      }
      if (call.path === "/identity/google/flows/f5/finish")
        return json({ identity });
      return answered(call);
    };
    const platform = identityPlatform();
    const signIn = platform.signInWithGoogle({ writerId: "writer-a" });
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    callback({ type: "phospheare-oauth", flowId: "f5", status: "done" });

    await expect(signIn).resolves.toEqual(identity);
    expect(popup.close).not.toHaveBeenCalled();
    expect(paths()).toEqual([
      "POST /identity/session",
      "POST /identity/google/flows",
      "POST /identity/session",
      "POST /identity/google/flows",
      "POST /identity/google/flows/f5/finish",
    ]);
  });

  it("never runs a flow again once Google has had its window", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    handler = (call) => {
      if (call.path === "/identity/google/flows")
        return json({
          flowId: "f6",
          authorizeUrl: "https://accounts.google.com/auth",
        });
      if (call.path === "/identity/google/flows/f6/finish")
        return problem(401, { code: "no-session" });
      return answered(call);
    };
    const platform = identityPlatform();
    const signIn = platform.signInWithGoogle({ writerId: "writer-a" });
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    callback({ type: "phospheare-oauth", flowId: "f6", status: "done" });

    await expect(signIn).rejects.toMatchObject({ code: "no-session" });
    expect(
      calls.filter((c) => c.path === "/identity/google/flows"),
    ).toHaveLength(1);
  });

  describe("a window the writer closes", () => {
    const started = (finish: () => Response) => (call: Call) => {
      if (call.path === "/identity/google/flows")
        return json({
          flowId: "f7",
          authorizeUrl: "https://accounts.google.com/auth",
        });
      if (call.path === "/identity/google/flows/f7/finish") return finish();
      return answered(call);
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("settles as flow-cancelled once this tab has focus back", async () => {
      const popup = fakePopup();
      vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
      const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
      handler = started(() => problem(409, { code: "flow-pending" }));
      const platform = identityPlatform();
      const signIn = platform.signInWithGoogle({ writerId: "writer-a" });
      const outcome = signIn.catch((err: unknown) => err);
      await vi.waitFor(() => expect(popup.location.href).not.toBe(""));

      // Google's own opener policy cuts the handle: `closed` reads true while
      // the writer is still at Google, and this tab has no focus.
      popup.closed = true;
      vi.advanceTimersByTime(2_000);
      expect(paths()).not.toContain("POST /identity/google/flows/f7/finish");

      focused.mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));
      await expect(outcome).resolves.toMatchObject({ code: "flow-cancelled" });
      expect(paths()).toContain("POST /identity/google/flows/f7/finish");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("notices the close on its poll when focus came back first", async () => {
      const popup = fakePopup();
      vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      handler = started(() => problem(409, { code: "flow-pending" }));
      const platform = identityPlatform();
      const signIn = platform.signInWithGoogle({ writerId: "writer-a" });
      const outcome = signIn.catch((err: unknown) => err);
      await vi.waitFor(() => expect(popup.location.href).not.toBe(""));

      popup.closed = true;
      vi.advanceTimersByTime(500);
      await expect(outcome).resolves.toMatchObject({ code: "flow-cancelled" });
    });

    it("answers the flow whose callback ran just before the close", async () => {
      const popup = fakePopup();
      vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      handler = started(() => json({ identity }));
      const platform = identityPlatform();
      const signIn = platform.signInWithGoogle({ writerId: "writer-a" });
      await vi.waitFor(() => expect(popup.location.href).not.toBe(""));

      popup.closed = true;
      window.dispatchEvent(new Event("focus"));
      await expect(signIn).resolves.toEqual(identity);
    });

    it("passes on what Google's cancel recorded", async () => {
      const popup = fakePopup();
      vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      handler = started(() => problem(409, { code: "flow-cancelled" }));
      const platform = identityPlatform();
      const signIn = platform.signInWithGoogle({ writerId: "writer-a" });
      await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
      callback({ type: "phospheare-oauth", flowId: "f7", status: "cancelled" });

      await expect(signIn).rejects.toMatchObject({ code: "flow-cancelled" });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe("an origin without the identity service", () => {
  it.each([
    ["a proxy's error page", () => new Response("<html>", { status: 502 })],
    ["another server's refusal", () => problem(404)],
    [
      "a page answered as success",
      () => new Response("<html>", { status: 200 }),
    ],
  ])("reads %s as unavailable", async (_label, answer) => {
    handler = answer;
    await expect(
      identityPlatform().driveAccessToken({ connectionId: "c1" }),
    ).rejects.toMatchObject({ name: "PlatformError", code: "unavailable" });
  });
});
