// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  createPkce,
  exchangeCode,
  inspectKey,
} from "./openrouterAuth";

// Pins the PKCE flow's proof (RFC 7636 `S256`), the three fetch controls on
// both calls, and that every failure is a fixed word.

interface Call {
  url: string;
  init: RequestInit;
}

function wire(answer: (init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (init.signal?.aborted)
      throw new DOMException("The operation was aborted.", "AbortError");
    return answer(init);
  };
  return { calls, fetcher };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("the PKCE proof", () => {
  it("draws a 64-character verifier from the unreserved set, and a long state", async () => {
    const pkce = await createPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
    expect(pkce.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await createPkce()).verifier).not.toBe(pkce.verifier);
  });

  it("derives the challenge as BASE64URL(SHA-256(verifier))", async () => {
    // RFC 7636 appendix B, with the test's own random source.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(expected).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");

    const pkce = await createPkce();
    const own = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(pkce.verifier),
    );
    expect(pkce.challenge).toBe(
      btoa(String.fromCharCode(...new Uint8Array(own)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
    );
  });

  it("redraws the bytes past the alphabet's last whole multiple, so no character is favoured", async () => {
    // 66 characters: bytes 198 and above are rejected. A source that offers
    // only 255 first and then zeros must yield all "A"s.
    let first = true;
    const source = {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        const bytes = array as unknown as Uint8Array;
        bytes.fill(first ? 255 : 0);
        first = false;
        return array;
      },
      subtle: crypto.subtle,
    } as unknown as Crypto;
    const pkce = await createPkce(source);
    expect(pkce.verifier).toBe("A".repeat(64));
  });
});

describe("the consent page's address", () => {
  it("carries the challenge, the method, the state and the label", () => {
    const url = new URL(
      authorizeUrl({
        callbackUrl: "https://app.example/app/connect/openrouter",
        challenge: "abc",
        state: "s1",
        keyLabel: "Phospheare",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      callback_url: "https://app.example/app/connect/openrouter",
      code_challenge: "abc",
      code_challenge_method: "S256",
      state: "s1",
      key_label: "Phospheare",
    });
  });

  it("refuses a callback that is not http(s)", () => {
    for (const callbackUrl of ["javascript:alert(1)", "/relative"])
      expect(() =>
        authorizeUrl({
          callbackUrl,
          challenge: "a",
          state: "b",
          keyLabel: "c",
        }),
      ).toThrow();
  });
});

describe("trading the code for a key", () => {
  it("posts the code, the verifier and the method, and nothing else", async () => {
    const { calls, fetcher } = wire(() => json({ key: "sk-or-v1-test" }));
    expect(
      await exchangeCode(fetcher, { code: "c0de", verifier: "v" }),
    ).toEqual({
      ok: true,
      key: "sk-or-v1-test",
    });
    const [call] = calls;
    expect(call?.url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(call?.init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse(String(call?.init.body))).toEqual({
      code: "c0de",
      code_verifier: "v",
      code_challenge_method: "S256",
    });
  });

  it.each([
    [403, "expired"],
    [400, "refused"],
    [404, "refused"],
    [429, "unreachable"],
    [500, "unreachable"],
  ] as const)("reads a %i as %s", async (status, failure) => {
    const { fetcher } = wire(() =>
      json({ error: { message: "the vendor's words" } }, status),
    );
    expect(await exchangeCode(fetcher, { code: "c", verifier: "v" })).toEqual({
      ok: false,
      failure,
    });
  });

  it("refuses an answer with no key in it", async () => {
    for (const body of [{}, { key: "" }, { key: 5 }, null]) {
      const { fetcher } = wire(() => json(body));
      expect(await exchangeCode(fetcher, { code: "c", verifier: "v" })).toEqual(
        {
          ok: false,
          failure: "refused",
        },
      );
    }
  });

  it("tells a dead network from the writer closing the window", async () => {
    const dead: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await exchangeCode(dead, { code: "c", verifier: "v" })).toEqual({
      ok: false,
      failure: "unreachable",
    });
    const stopped = new AbortController();
    stopped.abort();
    const { fetcher } = wire(() => json({ key: "k" }));
    expect(
      await exchangeCode(fetcher, { code: "c", verifier: "v" }, stopped.signal),
    ).toEqual({
      ok: false,
      failure: "cancelled",
    });
  });
});

describe("reading what a key is", () => {
  const description = {
    data: {
      label: "k",
      limit: 5,
      limit_remaining: 5,
      limit_reset: null,
      include_byok_in_limit: true,
      usage: 0,
    },
  };

  it("sends the key as a bearer, uncached, with the three controls", async () => {
    const { calls, fetcher } = wire(() => json(description));
    const read = await inspectKey(
      fetcher,
      "sk-or-v1-test",
      new AbortController().signal,
    );
    expect(read).toMatchObject({
      ok: true,
      info: { limitUsd: 5, includeByokInLimit: true },
    });
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/key");
    expect(calls[0]?.init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Authorization: "Bearer sk-or-v1-test" },
    });
  });

  it.each([401, 403])(
    "reads a %i as a key the vendor does not honour",
    async (status) => {
      const { fetcher } = wire(() => json({ error: { code: status } }, status));
      expect(
        await inspectKey(fetcher, "k", new AbortController().signal),
      ).toEqual({
        ok: false,
        failure: "unauthorized",
      });
    },
  );

  it("reads anything else that is not a description as unreachable or unreadable", async () => {
    const down = wire(() => json({}, 502));
    expect(
      await inspectKey(down.fetcher, "k", new AbortController().signal),
    ).toEqual({
      ok: false,
      failure: "unreachable",
    });
    const odd = wire(() => new Response("<html>", { status: 200 }));
    expect(
      await inspectKey(odd.fetcher, "k", new AbortController().signal),
    ).toEqual({
      ok: false,
      failure: "unreadable",
    });
    const shapeless = wire(() => json({ data: [] }));
    expect(
      await inspectKey(shapeless.fetcher, "k", new AbortController().signal),
    ).toEqual({
      ok: false,
      failure: "unreadable",
    });
  });

  it("gives up on its own after its deadline", async () => {
    const silent: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    expect(
      await inspectKey(silent, "k", new AbortController().signal, 20),
    ).toEqual({
      ok: false,
      failure: "unreachable",
    });
  });
});
