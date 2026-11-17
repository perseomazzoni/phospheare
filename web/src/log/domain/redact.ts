// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The safety net behind the call sites, which write no personal value
// themselves. It removes the values the app knows (the Google account's
// email and name), then every email address, every deSEC name, every IP
// address but loopback, and the value of every query parameter that can
// carry a secret. The desktop program's log has the same net
// (`desktop/internal/adapters/logs/redact.go`).

export const AS_ADDRESS = "[address]";
export const AS_EMAIL = "[email]";
export const AS_NAME = "[name]";
export const AS_USER = "[user]";
export const AS_SECRET = "[secret]";

/** A personal value the app knows, and the placeholder it leaves. */
export interface Known {
  value: string;
  as: string;
  /**
   * Replaced only as a whole word, in the case given: a word of a name, which
   * inside another word or an id ("Ann" in "channel") is not the name, nor
   * is the ordinary word it can also be ("will" for "Will").
   */
  word?: boolean;
}

/** The shortest known value removed: a shorter one would cut ordinary words. */
const MIN_KNOWN = 3;

const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const DEDYN = /\b(?:[a-z0-9_-]+\.)+dedyn\.io\b/gi;
// Four numbers after a product's name and a slash are its version, as a
// user agent writes "Chrome/131.0.0.0", and no address.
const IPV4 = /(?<![A-Za-z]\/)\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
// A whole run of hex digits and colons, with two colons at least and an
// optional zone; what parses as an address is one, what does not (a time)
// stays.
const IPV6 =
  /(?<![0-9A-Fa-f:])[0-9A-Fa-f]*:[0-9A-Fa-f:]*:[0-9A-Fa-f:]*(?:%[0-9A-Za-z._-]+)?/g;
const SECRET_PARAM =
  /([?&#](?:code|state|token|access_token|id_token|refresh_token|key|k)=)[^&#\s"]+/gi;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function ipv4(s: string): string {
  const parts = s.split(".").map(Number);
  if (parts.some((p) => p > 255)) return s;
  // Loopback and the unspecified address name no person's device.
  if (parts[0] === 127 || parts.every((p) => p === 0)) return s;
  return AS_ADDRESS;
}

function ipv6(s: string): string {
  const bare = s.split("%")[0];
  const groups = bare.split(":");
  const compressed = bare.includes("::");
  if (bare.split("::").length > 2) return s;
  // One colon alone at either end is no address: "::ffff:" before an IPv4
  // address already replaced.
  if (/^:[^:]|[^:]:$/.test(bare)) return s;
  if (!compressed && groups.length !== 8) return s;
  if (compressed && groups.filter((g) => g !== "").length > 7) return s;
  if (groups.some((g) => g.length > 4)) return s;
  if (bare === "::1" || bare === "::") return s;
  return AS_ADDRESS;
}

/** `text` with every personal value replaced. */
export function redact(text: string, known: readonly Known[] = []): string {
  let out = text;
  const sorted = known
    .map((k) => ({ ...k, value: k.value.trim() }))
    .filter((k) => k.value.length >= MIN_KNOWN)
    .sort((a, b) => b.value.length - a.value.length);
  for (const k of sorted) {
    const value = escapeRegExp(k.value);
    // A letter or digit on either side makes it part of another word.
    const pattern = k.word
      ? new RegExp(`(?<![\\p{L}\\p{N}])${value}(?![\\p{L}\\p{N}])`, "gu")
      : new RegExp(value, "gi");
    out = out.replace(pattern, k.as);
  }
  return out
    .replace(SECRET_PARAM, `$1${AS_SECRET}`)
    .replace(EMAIL, AS_EMAIL)
    .replace(DEDYN, AS_NAME)
    .replace(IPV4, ipv4)
    .replace(IPV6, (m) => (m.includes(":") ? ipv6(m) : m));
}
