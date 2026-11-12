// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import type { AnswerTextContext } from "../../ai";
import { citableTitles, sameTitles } from "../../ai/domain/citations";
import type { ChatTurn, Finding } from "../../ai/domain/types";
import {
  groupLabel,
  type CitedSource,
  type WebCitations,
} from "../../ai/domain/webCitations";
import { mapAsText, type LiveStructure } from "./mapAnswer";
import { settledVerdict, verifyAsText } from "./verifyAnswer";
import {
  answerEnv,
  markdown,
  type CitationEnv,
} from "../components/safeMarkdown";

// ── A turn as words ──────────────────────────────────────────────────────────
//
// Two surfaces put a turn on the clipboard: the answer's own Copy, and the
// panel's Copy when a chat could not be saved. One producer serves both, so
// neither copies a `/where` answer's history line, with its `node:` ids, to a
// writer who has never seen one, and the next kind of answer is taught to
// both at once.
//
// ── Plain words as the screen shows ──────────────────────────────────────────
//
// An answer is copied as what the screen shows, written out from the
// renderer's own parse (`plainOf`), never as its Markdown source. The
// clipboard is `text/plain`, and everywhere a writer pastes it (a document,
// an email, the manuscript itself) shows `**` and `##` as junk. Every answer
// copies in this one shape. Block structure stays, because a list run
// together or a quotation without its marker misattributes words. The parse
// is the renderer's, env and core rule included, so citations, web groups and
// the inert links of a chat that searched are decided once, for the screen
// and the copy alike: a model's link in such a chat reaches the clipboard as
// its words and nothing else.
//
// What it writes literally is what the screen shows literally: code, and
// escaped Markdown. So `` `![](https://x/?q=…)` `` copies as those characters,
// and pasted where Markdown renders it becomes an image. That residual is
// accepted: the url is on screen, the paste is the writer's own act, and
// closing it would take a second definition of Markdown syntax. A
// `text/html` flavour made from the inert render would close it.

/**
 * A source's title for a person, or the words for one missing from the
 * catalogue; never its raw id, which is the app's address, not theirs.
 */
export function titleOf(
  id: string,
  titles: ReadonlyMap<string, string>,
  t: TFunction,
): string {
  return titles.get(id) ?? t("dock.sourceGone");
}

/** What `turnAsText` needs besides the turn. */
export interface TurnTextContext {
  titles: ReadonlyMap<string, string>;
  /** The turn's entry from its chat's `webCitations`, never a fresh walk. */
  web: WebCitations;
  t: TFunction;
  /** The live Structure, once read, for a `/map` answer's titles. */
  live?: LiveStructure;
  /**
   * Whether this chat draws a `/map` answer at all, which a reader chat never
   * does. One that does not has nothing of it to copy either.
   */
  offersMap: boolean;
}

/**
 * An assistant turn as plain text with its citations read as titles,
 * or null when there is nothing a person should copy: a question,
 * an answer with no text yet, or a `/where` answer, whose text is the
 * history line while what the writer reads is its rows. A `/map`
 * answer is what its rows say, in words (`mapAsText`), never its stored
 * text. A review answer is its line and then its findings, as the rows show
 * them: a review's text is one count line, and a clipboard holding a count
 * and none of what it counted is no copy of the answer.
 */
export function turnAsText(
  turn: ChatTurn,
  { titles, web, t, live, offersMap }: TurnTextContext,
): string | null {
  if (turn.role !== "assistant") return null;
  if (turn.mapped)
    return offersMap
      ? mapAsText(
          turn.mapped,
          titles,
          live,
          turn.model?.modelId ?? t("dock.assistant"),
          t,
        )
      : null;
  // A `/verify` answer is its verdict in words (`verifyAsText`), and nothing
  // until it settled: an interrupted check's text is empty, and an unjudged
  // one's is the line kept for the model, never the writer's.
  if (turn.verifies) {
    const verified = settledVerdict(turn);
    return verified
      ? verifyAsText(
          verified,
          turn.web ?? [],
          web.cited,
          answerBody(turn, citableTitles(turn, titles), web),
          (source) => sourceLine(source, source.url),
          t,
        )
      : null;
  }
  if (turn.located || !turn.text.trim()) return null;
  const text = answerBody(turn, citableTitles(turn, titles), web);
  const sources = web.cited.map((source) => sourceLine(source, source.url));
  const findings = (turn.findings ?? []).map((one) =>
    findingAsText(one, titles, t),
  );
  return [text, ...(sources.length ? [sources.join("\n")] : []), ...findings]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * An answer as the chat search indexes it (`searchDocuments`): the same body
 * the copy writes, then each cited source as `[n] Title · host`, never a url,
 * so no link a model chose is found by searching. Module-level and free of
 * `t`, because the search's memo lists neither.
 */
export function indexText(
  turn: ChatTurn,
  { titles, web }: AnswerTextContext,
): string {
  const hit = indexed.get(turn);
  if (hit && hit.web === web && sameTitles(hit.titles, titles)) return hit.text;
  const text = [
    answerBody(turn, titles, web),
    ...web.cited.map((source) => sourceLine(source)),
  ]
    .filter(Boolean)
    .join("\n");
  indexed.set(turn, { titles, web, text });
  return text;
}

// ── Index text kept per turn ─────────────────────────────────────────────────
//
// The chat search rebuilds its documents on every keystroke of the query, and
// an answer's text is one Markdown parse: over the largest chat the codec
// admits, parsing every answer again is most of a cold index build. A turn is
// never edited in place, so the same turn object has the same text, but not
// the same index text if what it cites changed (its web entry, which keeps
// its identity while it is equal, `webCitations`' `previous`) or a source it
// cites was renamed (its titles, a new Map every search, compared by value).
// Either one misses. Keyed weakly, so a turn that leaves the chats leaves
// this too.
const indexed = new WeakMap<
  ChatTurn,
  { titles: ReadonlyMap<string, string>; web: WebCitations; text: string }
>();

/**
 * One source as a line: `[n] Title · url` in a copy, `[n] Title · host` in
 * the index. A result the engine named without a title shows its host in the
 * title's place, as its row does, whole and never cut as the row is.
 */
function sourceLine(source: CitedSource, url?: string): string {
  const name = source.title || source.site;
  const tail = url ?? (source.title ? source.site : "");
  return tail ? `[${source.n}] ${name} · ${tail}` : `[${source.n}] ${name}`;
}

function answerBody(
  turn: ChatTurn,
  titles: ReadonlyMap<string, string>,
  web: WebCitations,
): string {
  // The label is the title itself: it is an accessible name, never printed.
  return plainOf(
    turn.text,
    answerEnv({ web, titles, final: true, citationLabel: (title) => title }),
  );
}

type Tokens = ReturnType<typeof markdown.parse>;

/**
 * Markdown as the screen shows it, in plain words. Blocks are
 * parted by a blank line; a heading is its own line without `#`; a list item
 * is one line, `- ` or its number counted from the list's `start` as the
 * screen counts it, two spaces deeper per level; a quoted line keeps `> `
 * per level; code is its content, without fences; a table row is one line,
 * its cells parted by tabs. Emphasis, backticks and `hr` go. An image is its
 * alt, as on screen. A live link is `words (href)`, with the href the
 * screen's anchor carries after `validateLink`, never re-read from the
 * source, and an autolink is its text once, since its words are the url. In
 * a chat that searched there is no link token left to write (the core rule
 * dropped it).
 *
 * `env` is the renderer's (`answerEnv`), and a new object: parsing writes
 * `env.references`, and a shared one would arm one answer's definitions in
 * the next.
 */
export function plainOf(text: string, env: CitationEnv): string {
  const numbers = env.webNumbers ?? new Map<string, number>();
  const lines: string[] = [];
  const lists: { next: number | null }[] = [];
  let quote = 0;
  let marker: string | null = null;
  // The quote depth a blank line before the next block belongs to, if any.
  let gap: number | null = null;
  let row: string[] | null = null;
  const indent = () => "  ".repeat(Math.max(0, lists.length - 1));
  const emit = (line: string) => {
    if (gap !== null && lines.length > 0)
      lines.push("> ".repeat(Math.min(gap, quote)).trimEnd());
    gap = null;
    const lead =
      marker !== null
        ? indent() + marker
        : lists.length > 0
          ? `${indent()}  `
          : "";
    marker = null;
    lines.push("> ".repeat(quote) + lead + line);
  };
  // Inside a list the items run on consecutive lines; the list itself is
  // one block.
  const endBlock = () => {
    if (lists.length === 0) gap = quote;
  };
  for (const token of markdown.parse(text, env)) {
    switch (token.type) {
      case "blockquote_open":
        quote += 1;
        break;
      case "blockquote_close":
        quote -= 1;
        endBlock();
        break;
      case "bullet_list_open":
        lists.push({ next: null });
        break;
      case "ordered_list_open":
        lists.push({ next: Number(token.attrGet("start") ?? 1) });
        break;
      case "bullet_list_close":
      case "ordered_list_close":
        lists.pop();
        endBlock();
        break;
      case "list_item_open": {
        const list = lists[lists.length - 1];
        if (list?.next === null || list === undefined) marker = "- ";
        else {
          marker = `${list.next}. `;
          list.next += 1;
        }
        break;
      }
      case "paragraph_close":
      case "heading_close":
      case "table_close":
      case "hr":
        endBlock();
        break;
      case "inline": {
        const words = inlineText(token.children ?? [], numbers);
        if (row) row.push(words.replace(/\n/g, " "));
        else for (const line of words.split("\n")) emit(line);
        break;
      }
      case "fence":
      case "code_block":
        for (const line of token.content.replace(/\n$/, "").split("\n"))
          emit(line);
        endBlock();
        break;
      case "tr_open":
        row = [];
        break;
      case "tr_close":
        emit((row ?? []).join("\t"));
        row = null;
        break;
    }
  }
  return lines.join("\n");
}

/** One inline token run as the screen reads it. */
function inlineText(
  children: Tokens,
  numbers: ReadonlyMap<string, number>,
): string {
  let out = "";
  const links: (string | null)[] = [];
  for (const child of children) {
    switch (child.type) {
      case "text":
      case "code_inline":
      case "image":
        out += child.content;
        break;
      case "softbreak":
        out += " ";
        break;
      case "hardbreak":
        out += "\n";
        break;
      case "citation":
        out += (child.meta as { title: string }).title;
        break;
      case "web_cite": {
        const meta = child.meta as { ids: string[]; text: string };
        const label = groupLabel(meta.ids, numbers);
        out += label ? `[${label}]` : meta.text;
        break;
      }
      case "link_open":
        links.push(
          child.markup === "autolink"
            ? null
            : String(child.attrGet("href") ?? ""),
        );
        break;
      case "link_close": {
        const href = links.pop();
        if (href) out += ` (${href})`;
        break;
      }
      // A token this does not know prints the text it carries (an emphasis
      // marker carries none), so a new inline kind loses no words on the
      // clipboard before anyone teaches it here.
      default:
        out += child.content;
    }
  }
  return out;
}

/**
 * One finding as its row reads, in the map rows' plain-text shape: the head,
 * then the body and each quote indented, the quote's Section by its title.
 * A resolved or dismissed one is its title and its verdict, as on screen.
 */
function findingAsText(
  finding: Finding,
  titles: ReadonlyMap<string, string>,
  t: TFunction,
): string {
  if (finding.status === "dismissed" || finding.status === "resolved")
    return `${finding.title} · ${t(`dock.finding.${finding.status}`)}`;
  return [
    `${t(`dock.severity.${finding.severity}`)} · ${finding.title}`,
    `  ${finding.explanation}`,
    ...(finding.uncertainty ? [`  ${finding.uncertainty}`] : []),
    ...finding.evidence.map(
      (anchor) =>
        `  “${anchor.quote}” · ${titleOf(anchor.sourceId, titles, t)}`,
    ),
  ].join("\n");
}
