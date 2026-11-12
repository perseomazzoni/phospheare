// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { WebResult } from "./types";

// Web text: everything the SPA does to text that crosses to or from a search
// engine, written once. Two promises rest on it:
//
// - What the writer approved is what leaves. The card shows
//   `normaliseQuery`'s value, and each engine refuses to send anything else,
//   so the two sides of that comparison run through the same function.
// - What comes back is only what a click opens. Every engine's rows pass
//   `webResultsOf`, the one row check, through `normalizeSearchResults`;
//   `chatCodec` reads planted files through the same `webUrl`.
//
// The numbers below bound what crosses the search port in either direction:
// `acceptableQuery` holds a query to them before it leaves, and
// `webResultsOf` holds an engine's rows to them before anything reads them.
// They live in the domain because the
// helpers here read them and this layer imports nothing above it. How much of
// a result a model reads is a context decision, and lives in `budgets.ts`.

/** The longest query, in code points. */
export const QUERY_MAX = 120;
/** The longest result URL. A longer URL is dropped, never clipped. */
export const URL_MAX = 2_048;
/** The longest result title kept: a transport ceiling, not a model's read. */
export const TITLE_MAX = 300;
/**
 * A result's title as the model reads it and a citation shows it: one clip,
 * so the source row, the copy and the replay line name a result as the model
 * was shown it. Below `TITLE_MAX`, the transport's bound.
 */
export const WEB_TITLE_CHARACTERS = 200;
/** The longest result excerpt kept: a transport ceiling, like `TITLE_MAX`. */
export const EXCERPT_MAX = 2_000;
/** The most results one search returns; both engines ask for this many. */
export const WEB_RESULTS_MAX = 5;

/**
 * The longest quote `/verify` keeps from a result, in code points: long
 * enough for the sentence that settles a claim, too short to carry a page.
 */
export const WEB_QUOTE_MAX = 200;
/**
 * The fewest words a kept quote has. Fewer is not a quote but a phrase, and
 * a phrase is found in almost any excerpt. More would refuse a short
 * deciding quote such as "19 settembre 1985", which is three.
 */
export const WEB_QUOTE_MIN_WORDS = 3;

/**
 * Words in a plain line: runs between spaces that hold a letter or a digit.
 * Not `bookWords`' `TOKEN`, which splits "l'anno" and "1885-1889" into several
 * words for a different job (finding the writer's words in a query); here a
 * date or an elided article is one word as a reader counts it.
 */
function quoteWords(line: string): number {
  return line.split(" ").filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * Whether a text may stand as a kept quote: already one plain line (the app's
 * own slice, never re-normalised here), within the ceiling and at or over the
 * floor. The one bound, so `/verify` and the codec cannot keep different
 * quotes.
 */
export function quoteBounded(text: string): boolean {
  return (
    text.length > 0 &&
    plainLine(text) === text &&
    [...text].length <= WEB_QUOTE_MAX &&
    quoteWords(text) >= WEB_QUOTE_MIN_WORDS
  );
}

/**
 * Everything that renders as nothing: controls, format characters (bidi
 * overrides and isolates, zero-widths, the BOM) and the rest of Unicode's
 * default-ignorables, which sit in other categories (variation selectors,
 * the Hangul fillers, the combining grapheme joiner).
 *
 * The last group is why this is not `\p{Cc}\p{Cf}` alone. In a query they
 * are a covert channel: a model steered by an injected reference or result
 * can spell the writer's prose in characters the card cannot show, one byte
 * a code point, after a query that looks harmless, and the writer approves
 * what they see. In third-party text they carry instructions the reader of
 * the screen never sees.
 *
 * A lone surrogate (`\p{Cs}`) is no character at all: it renders as a
 * replacement box or nothing, and JSON writes it as a six-character escape,
 * so one "code point" of a title would cost six in the model's context and
 * put the fitting's worst case out of reach.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]+/gu;

/**
 * One line of visible text: each run of invisibles becomes one space, then
 * each run of whitespace does, then the ends are trimmed.
 *
 * An engine's rows are made plain by it too (`webResultsOf`). It runs on both
 * sides of every comparison it serves (the card against what is sent, a
 * quote against the excerpt it claims), because two normalisers that differ
 * by one character class make a match a coin toss.
 *
 * Not for prompts: `oneLine` feeds writer titles into prompts, where dropping
 * a zero-width joiner would change the writer's words.
 */
export function plainLine(text: string): string {
  return text.replace(INVISIBLE, " ").replace(/\s+/gu, " ").trim();
}

/**
 * At most `max` code points, cut at the last space when one falls in the
 * final tenth. Further back than that, a clean edge costs more text than half
 * a word does. `webResultsOf` clips an engine's rows with it.
 *
 * No marker is appended. A quote is checked against the excerpt as the model
 * saw it, so an ellipsis added here would be quotable text that no page
 * contains; whoever clips says so with a flag, never with a glyph.
 */
export function clipAt(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space >= max - Math.floor(max / 10)
    ? cut.slice(0, space).join("").trimEnd()
    : cut.join("");
}

/**
 * The query a card shows and an engine sends, or null when nothing visible
 * is left.
 *
 * Composed (NFC) first: canonically equivalent spellings render alike, so the
 * choice between them is another bit the writer cannot see. Then one
 * visible line, then `QUERY_MAX`. Idempotent, because the engines'
 * guard compares a query with its normal form, and a function that moved on
 * its own output would refuse every query it produced.
 */
export function normaliseQuery(raw: string): string | null {
  const line = plainLine(raw.normalize("NFC"));
  return line ? clipAt(line, QUERY_MAX) : null;
}

/** The shortest query worth sending, in code points (the tool's schema). */
export const QUERY_MIN = 2;

/**
 * The query a search may send, or null: `normaliseQuery`'s value when it
 * still has `QUERY_MIN` code points. The one rule for a model's proposal and
 * for the writer's edit of it, so neither can send what the other could not.
 */
export function usableQuery(raw: string): string | null {
  const query = normaliseQuery(raw);
  return query !== null && Array.from(query).length >= QUERY_MIN ? query : null;
}

/**
 * What a writer's field may send, or null: `usableQuery`'s value, unless
 * normalising would clip it. The field caps what is typed at
 * `QUERY_MAX` code points, but composing can lengthen text (U+0958 and U+0344
 * are composition exclusions that NFC writes as two code points), and
 * `normaliseQuery` would then cut the tail off silently, sending something
 * other than what the ask showed. A row it refuses cannot be approved, so the
 * writer sees why Search waits. The ask on screen reads it; the pause's
 * `answer()` keeps its own stricter check, that a sent query is already
 * `usableQuery`'s value.
 */
export function sendableQuery(raw: string): string | null {
  const line = plainLine(raw.normalize("NFC"));
  return Array.from(line).length <= QUERY_MAX ? usableQuery(raw) : null;
}

/**
 * The Wikipedia edition for a project's language: its primary subtag,
 * lower-cased, or `en`.
 *
 * The project's `language` is a free string from a file that may be
 * attacker-written, and it becomes part of the host name the Wikipedia
 * engine calls. Anything that is not a plain primary subtag
 * reads as `en`, so a planted value can neither choose another host nor
 * stop the search; the engine checks the result against `WIKI_LANGUAGE`
 * again before it builds the host. The region is dropped, because the book
 * languages Phospheare offers are primary subtags.
 */
export function wikiLanguage(code: string | undefined): string {
  const primary = (code ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,12}$/.test(primary) ? primary : "en";
}

/**
 * A URL as the browser will open it, or null.
 *
 * The raw string is refused, not cleaned, when it holds whitespace, a backslash
 * or an invisible (the same class `plainLine` strips): the WHATWG parser strips
 * a tab, reads `\` as `/`, and maps a default-ignorable out of a host, and each
 * would hand back a host other than the one the checked string showed.
 * Then http(s) only, no userinfo (the host is what a writer
 * reads, and `user@` makes one host look like another), a host, and the cap
 * measured on the value returned, the parsed `href`, since that is what a link
 * opens.
 */
export function webUrl(raw: string): string | null {
  if (/[\s\\\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(raw))
    return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.href.length <= URL_MAX ? url.href : null;
}

/** The longest a host name can be (RFC 1035), so the longest `site`. */
export const SITE_MAX = 253;

/**
 * What a host may hold to be shown at all: ASCII letters, digits, `-` and
 * `_` in dot-separated labels, as the parser lower-cases them. The WHATWG
 * parser keeps `"`, `;` and `(` in a host (`http://a"b;c(d).com/`) and
 * decodes `%22` and `%3B` into one, and `webUrl` passes all of them; a host
 * like that could close the replay line's quoting or forge an entry after
 * ` from `. An IPv6 literal fails it too: its brackets and colons name no
 * site a writer can read.
 */
const SITE_HOST = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/;

/**
 * The host a click opens, the one name for the sources list, the replay line
 * and the model's `site`. Derived every time, never stored, so a planted file
 * cannot pair one host's name with another's link.
 *
 * The ASCII form the parser returns: an `xn--` host is what exposes a
 * homograph, and decoding it would hide one. A leading `www.` goes; nothing
 * else is taken out of it. A host past what DNS allows (the parser does no
 * length check) or outside `SITE_HOST` is no site at all: null, so the result
 * is shown to the model without one and never becomes a source, while its
 * record still says the turn searched. How a long host is shown is
 * `shownSite`'s, and that cuts whole labels only.
 */
export function siteOf(url: string): string | null {
  const href = webUrl(url);
  if (!href) return null;
  const host = new URL(href).hostname;
  if (host.length > SITE_MAX || !SITE_HOST.test(host)) return null;
  return host.startsWith("www.") && host.length > 4 ? host.slice(4) : host;
}

/** The longest site a row shows whole; past it leading labels go. */
const SHOWN_SITE_MAX = 24;

/**
 * A site as a source row shows it: whole up to 24 characters, and past that
 * "…" and the longest run of whole trailing labels that fits 23, never fewer
 * than the last three labels, and the whole host when it has three or fewer.
 *
 * Cut from the start, because the end is the registrable name and its TLD:
 * `en.wikipedia.org.evil.example` must still read `evil.example`. Never
 * inside a label, because the `xn--` that exposes a homograph sits at a
 * label's start, and two long names cut mid-label can read the same. Three
 * labels, because with no public-suffix list that is what keeps the name
 * under a `co.uk`: two would show `…co.uk`. What is kept is never clipped
 * again; a long tail wraps, and the title yields its width first.
 */
export function shownSite(site: string): string {
  if (site.length <= SHOWN_SITE_MAX) return site;
  const labels = site.split(".");
  if (labels.length <= 3) return site;
  let kept = labels.slice(-3).join(".");
  for (let count = 4; count < labels.length; count += 1) {
    const longer = labels.slice(-count).join(".");
    if (longer.length > SHOWN_SITE_MAX - 1) break;
    kept = longer;
  }
  return `…${kept}`;
}

/**
 * Which page a URL names: the URL without its fragment. Scheme and host are
 * already lower-case once `webUrl` has parsed it, which makes this the page
 * `webResultsOf` dedupes by. One spelling, because the searches of
 * one chat (and one `/verify`) are deduped by it too, and two would disagree.
 */
export function webPageKey(url: string): string {
  try {
    const page = new URL(url);
    page.hash = "";
    return page.href;
  } catch {
    return url;
  }
}

/**
 * An engine's rows, held to the one row check every reader relies on.
 *
 * A row survives only as three strings with a URL that passes `webUrl` and an
 * excerpt with something visible in it: a bare title invites a model to fill
 * the page in from memory and cite it. Title and excerpt become plain lines
 * clipped at the transport ceilings. Duplicate pages go, and at most
 * `WEB_RESULTS_MAX` remain, in the engine's order.
 *
 * `host` pins the rows to one host, the Wikipedia edition that was asked,
 * over https on the default port, so the keyless route can only ever
 * hand back links to the edition the writer's search went to.
 */
export function webResultsOf(
  rows: unknown,
  options: { host?: string } = {},
): WebResult[] {
  if (!Array.isArray(rows)) return [];
  const kept: WebResult[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (kept.length >= WEB_RESULTS_MAX) break;
    if (typeof row !== "object" || row === null) continue;
    const { url, title, excerpt } = row as Record<string, unknown>;
    if (
      typeof url !== "string" ||
      typeof title !== "string" ||
      typeof excerpt !== "string"
    )
      continue;
    const href = webUrl(url);
    if (!href) continue;
    if (options.host !== undefined && !onHost(href, options.host)) continue;
    const text = clipAt(plainLine(excerpt), EXCERPT_MAX);
    if (!text) continue;
    const page = webPageKey(href);
    if (seen.has(page)) continue;
    seen.add(page);
    kept.push({
      url: href,
      title: clipAt(plainLine(title), TITLE_MAX),
      excerpt: text,
    });
  }
  return kept;
}

function onHost(href: string, host: string): boolean {
  const url = new URL(href);
  return url.protocol === "https:" && url.port === "" && url.hostname === host;
}
