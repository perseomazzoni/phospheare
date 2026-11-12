// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { AiConnectionSettings } from "./domain/types";

export const DEFAULT_AI: AiConnectionSettings = {
  endpoint: "http://localhost:11434",
};

/**
 * The localStorage prefix for the device-local connection. It lives here, in
 * the AI module's public entry and free of host imports, because the account
 * teardown (`profile/forgetAccount.ts`) must sweep these keys by prefix
 * without pulling the adapter that writes them. Neutral, like everything in
 * browser storage: developer tools show it, so it names no product.
 */
export const AI_SETTINGS_PREFIX = "ai.connection";

/**
 * The account's own key, or `null` when nobody is signed in: there is no
 * signed-out bucket. `getCurrentUserId` also returns `null` before a writer
 * session is adopted, so a signed-out key would catch a write in that window
 * and hand it to the next account.
 */
export function aiSettingsKey(userId: string | null): string | null {
  return userId === null ? null : `${AI_SETTINGS_PREFIX}.${userId}`;
}

/**
 * The one loopback allow-list for a local runtime. Normalize through the URL
 * parser and accept only explicit loopback hosts with no credentials, query,
 * fragment, path, redirect or non-HTTP scheme; anything else is refused
 * rather than corrected. Cloud models are excluded separately, because a
 * localhost URL does not by itself prove local inference.
 */
export function normalizeOllamaEndpoint(raw: string): string {
  const url = new URL(raw.trim());
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("invalid-scheme");
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host))
    throw new Error("loopback-only");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("invalid-endpoint");
  if (url.pathname !== "/" && url.pathname !== "")
    throw new Error("invalid-path");
  // The IPv6 loopback literal folds to `localhost`. CSP3's host-source
  // grammar has no production for a bracketed IPv6 address, so no policy,
  // `security/csp.ts` included, can admit `http://[::1]`. Refusing it would
  // be false, since it is loopback; `localhost` resolves to ::1.
  if (host === "[::1]" || host === "::1")
    return `${url.protocol}//localhost${url.port ? `:${url.port}` : ""}`;
  const port = url.port
    ? Number.parseInt(url.port, 10)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("invalid-endpoint");
  return `${url.protocol}//${url.host}`;
}

/**
 * Parse stored JSON into a safe settings value; anything malformed falls
 * back to the default. Only the endpoint is read, and any other field a
 * stored value carries is ignored, because a model selection lives on the
 * chat.
 */
export function parseAiSettings(raw: string | null): AiConnectionSettings {
  if (!raw) return DEFAULT_AI;
  try {
    const value = JSON.parse(raw) as Partial<AiConnectionSettings>;
    return {
      endpoint: normalizeOllamaEndpoint(value.endpoint ?? DEFAULT_AI.endpoint),
    };
  } catch {
    return DEFAULT_AI;
  }
}

export function serializeAiSettings(next: AiConnectionSettings): string {
  const safe: AiConnectionSettings = {
    endpoint: normalizeOllamaEndpoint(next.endpoint),
  };
  return JSON.stringify(safe);
}
