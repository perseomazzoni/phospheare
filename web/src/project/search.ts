// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatKind } from "../ai/domain/types";
import type { DocNode, DocumentStructure } from "./types";
import { walk } from "./structure";
import { filePath, REFERENCE_DIR } from "./naming";
import {
  type ReferenceGroupId,
  groupReference,
  referenceTitle,
} from "./reference";

// ── Searching a project ──────────────────────────────────────────────────────
//
// Which of the project's things is the writer looking for: the structure's
// Parts and Sections, the subtrees in the recycle bin, the reference
// documents, the body text inside them, and the project's chats.
//
// The matcher arrives from outside. The engine's search port
// (`editor/engine/ports/search.ts`) is the one authority on escaping,
// whole-word and hyphen-joining, contract-tested against every adapter, and
// this module takes its compiled `RegExp` rather than importing it. Nothing
// under `project/` imports from `editor/`: the shell loads these modules and
// the editor is the lazy half, so that edge would pull an engine into the
// bundle a visitor downloads to read the homepage.

/**
 * A match, in enough of its surroundings to be recognised.
 *
 * Windowed rather than whole: a body-text hit's line can be a paragraph, and
 * a row the height of a paragraph drives the other results off the screen.
 * `at` and `length` locate the match inside `text`, so the row marks the
 * characters the search found rather than re-searching the excerpt and
 * marking another occurrence.
 */
export interface SearchExcerpt {
  /** The window: one line of the source, ellipsised around the match. */
  text: string;
  /** Where the match starts inside `text`. */
  at: number;
  /** Never zero: the port forbids a zero-length match. */
  length: number;
}

export type SearchResult =
  | {
      kind: "node";
      id: string;
      title: string;
      /** `part` or `section`: the row draws the node's own glyph. */
      nodeKind: DocNode["kind"];
      /**
       * The Part this Section sits in, if any; a Part has none, as in the
       * tree. The structure is two levels deep, so this is a name, never a
       * breadcrumb ellipsised into a lie at 248px.
       */
      within?: string;
      /**
       * Which of its namesakes this is, in reading order, set only when
       * another node in the same place has the same title. Titles are free,
       * so two Sections called "Anna" in one Part would otherwise be
       * two identical rows.
       */
      nth?: number;
    }
  | {
      /**
       * The writer's words matched inside this node's adopted file: every
       * occurrence, under the one node that holds them.
       *
       * The tally counts what was found in the markdown read. It can differ
       * from what the open document highlights when markup splits or spells a
       * match; that is a rounding error in a number, not a reason to
       * withhold the list.
       */
      kind: "body";
      id: string;
      title: string;
      nodeKind: DocNode["kind"];
      within?: string;
      /** As a name row's: which namesake, when the place holds several. */
      nth?: number;
      /**
       * Every occurrence, in file order, with no cap: a search the writer
       * cannot trust to list everything has to be redone by hand.
       */
      excerpts: SearchExcerpt[];
    }
  | {
      kind: "removed";
      id: string;
      title: string;
      nodeKind: DocNode["kind"];
    }
  | {
      kind: "reference";
      /** The identity and what opens it (`character--vera.md`). */
      fileName: string;
      title: string;
      group: ReferenceGroupId;
      /**
       * Present when the words were in the document rather than its name.
       *
       * One row either way, unlike a node, which gets a name row under
       * "Structure" and a prose row under "In the text". A Section is a place
       * in a book, and "the chapter called Storm" and "the chapter that
       * mentions storms" are two answers; a reference document is a small
       * whole the writer opens, and for it they are one.
       */
      excerpt?: SearchExcerpt;
    }
  | {
      /** One turn of a project chat, as the assistant hands it across (`ChatSearchDocument`). */
      kind: "chat";
      chatId: string;
      /** The exact turn a hit reveals. */
      turnId: string;
      title: string;
      /** The chat's kind: a chat still carrying its stored default title is
       * named by its kind, in the writer's language (`chatTitleShown`). */
      chatKind: ChatKind;
      speaker: Speaker;
      excerpt: SearchExcerpt;
    };

/** Who said a chat turn. */
export type Speaker = "you" | "assistant";

/**
 * One chat turn, as the search sees it. The composed AI instance hands these
 * across; this module never parses a chat file, so the panel does not depend
 * on the assistant's storage format, cannot match the format's own words, and
 * is told who spoke.
 */
export interface ChatSearchDocument {
  chatId: string;
  turnId: string;
  title: string;
  kind: ChatKind;
  speaker: Speaker;
  text: string;
}

/** The hits under one heading, in the order they will be drawn. */
export interface SearchGroup {
  /** What the heading says: `structure`, `body`, `chat`, `bin`, or the
   *  reference group's id. */
  head: "structure" | "body" | "chat" | "bin" | ReferenceGroupId;
  results: SearchResult[];
}

export interface ProjectSearch {
  groups: SearchGroup[];
  total: number;
}

export interface SearchInput {
  structure: DocumentStructure | null;
  referenceFiles: readonly string[];
  /** What the writer typed, for the empty-query test; `regex` matches. */
  query: string;
  /**
   * The compiled query, from `regexSearch.buildRegex`. Null when there is no
   * query, and then the search returns nothing.
   */
  regex: RegExp | null;
  /**
   * Source key to that file's text, for whatever the index has read so far.
   * The keys are the ones `sourcesFor` mints, so the key format has one home.
   *
   * Absent or partial is normal: the index fills in the background, and each
   * file it lands adds rows to a list already on screen. With nothing read,
   * the search matches names only.
   */
  bodies?: ReadonlyMap<string, string>;
  /**
   * Project chats as neutral documents from the composed assistant. Absent
   * means no chats to search, never "read them yourself".
   */
  chats?: readonly ChatSearchDocument[];
  /** How much of a line each excerpt quotes. Absent, `EXCERPT_WINDOW`. */
  window?: ExcerptWindow;
}

// ── What the index reads ─────────────────────────────────────────────────────
//
// The search's own answer to which files, so the caller need not know the
// project's layout and the key format has one home.

export interface BodySource {
  /** How the text will be looked up in `SearchInput.bodies`. */
  key: string;
  /** Project-relative, ready for `provider.readFile`. */
  path: string;
}

// A source carries no version, and the index re-reads everything at the start
// of each search. The reads are local: with a remote, `providerFor`
// hands the editor `mirror(cached(base))`, whose `readFile` serves the working
// copy and goes to Remote Storage only on a miss, and a device project reads
// its own disk. So a re-read sees a save the instant it lands, and costs a
// sweep of OPFS, not a burst against a rate limit.
//
// A per-file version would be a fact the save path must keep true in a second
// place, and a cache key another subsystem must remember to move stops moving:
// the panel then answers with the prose the book was opened with.

const NODE = "node:";
const REF = "ref:";

/**
 * Every file this search would like to have read: the book and the reference
 * folder. Chats are not files here; they arrive as `SearchInput.chats`.
 */
export function sourcesFor(
  structure: DocumentStructure | null,
  referenceFiles: readonly string[],
): BodySource[] {
  const sources: BodySource[] = [];
  if (!structure) return sources;

  walk(structure.children, (node) => {
    sources.push({ key: NODE + node.id, path: filePath(node.adopted) });
  });

  // Through `groupReference`, as the name search is: it drops non-markdown
  // and files that declare no group, which a result could otherwise open
  // where the writer cannot go. Summaries are in: their name is a node id, but
  // their text is prose the writer wrote.
  for (const group of groupReference(referenceFiles, structure))
    for (const doc of group.docs)
      sources.push({
        key: REF + doc.fileName,
        path: `${REFERENCE_DIR}/${doc.fileName}`,
      });

  return sources;
}

// ── What the index holds ─────────────────────────────────────────────────────

/**
 * A source's text as the search sees it: the writer's words, without the
 * marks the file format puts around them.
 *
 * `{align:center}` at the head of a paragraph, `# ` before a heading, and the
 * asterisks and backticks around emphasis and monospace are the codec's
 * punctuation (`engine/adapters/commonmark.ts` writes all four). Left
 * in, they leak into the quotations the panel shows, and they break matches
 * that straddle them, so a phrase the writer can see on screen is reported
 * absent.
 *
 * Stripping here keeps the offsets, excerpts and count in the space the
 * parsed `Doc` renders, so the panel's tally and the document's
 * highlights agree except for a match the codec splits across paragraphs.
 * Every source `sourcesFor` lists is markdown, so every one is stripped.
 */
export function prepareSource(text: string): string {
  return plainText(text);
}

/** The codec's block directive, mirrored from it. */
const ALIGN_MARK = /^\{align:(?:left|center|right|justify)\}/;
const HEADING_MARK = /^#{1,2} /;

/**
 * Markdown as prose: the same text the renderer would draw, as a string.
 *
 * Line by line, because a paragraph is one line in this format and every block
 * directive sits at the head of one. The inline pass drops the emphasis and
 * monospace delimiters and unescapes what the serializer escaped, so a
 * writer's literal asterisk (written `\*`) survives while the codec's do not.
 */
function plainText(markdown: string): string {
  return markdown.split("\n").map(plainLine).join("\n");
}

function plainLine(line: string): string {
  // A page break has no content. Emptying the line rather than dropping it
  // keeps every later line at the offset the excerpt window expects.
  if (line === "{pagebreak}") return "";
  // The backslash form is a literal "{align:" the writer typed, escaped by
  // the codec so it is not read as a directive, here or in the parser.
  const rest = line.startsWith("\\{align:")
    ? line.slice(1)
    : line.replace(ALIGN_MARK, "");
  return plainInline(rest.replace(HEADING_MARK, ""));
}

function plainInline(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    // An escape yields the character behind it, marker or not.
    if (ch === "\\" && i + 1 < text.length) {
      out += text[i + 1];
      i += 1;
      continue;
    }
    if (ch === "*" || ch === "`") continue;
    out += ch;
  }
  return out;
}

/**
 * Does this text answer the query?
 *
 * `lastIndex` is reset because the port builds the regex `g`-flagged so
 * `searchDoc` can scan, and a `g` regex carries its position between calls.
 * Shared across many rows without the reset, it makes every second row miss.
 */
function hits(text: string, regex: RegExp): boolean {
  regex.lastIndex = 0;
  return regex.test(text);
}

/**
 * How much of the line to keep, and how much of it to spend before the match.
 *
 * The match sits about a third of the way in rather than centred: what
 * precedes a hit is context the writer knows, and what follows is what they
 * are trying to recognise.
 */
export interface ExcerptWindow {
  /** The characters kept of the line. */
  width: number;
  /** How many of them precede the match. */
  before: number;
}

/**
 * The window for the panel's narrowest 248px, where about this many
 * characters fit in two wrapped lines.
 */
export const EXCERPT_WINDOW: ExcerptWindow = { width: 110, before: 32 };

/**
 * The first match in `text`, with enough either side of it to be read.
 *
 * The line is the unit, not a raw character slice: an excerpt beginning in
 * the paragraph above reads as a mistake, not a quotation. Within the line
 * the window can still ellipsise on both sides, because a paragraph is one
 * line in this markdown.
 */
export function excerptAt(
  text: string,
  regex: RegExp,
  span: ExcerptWindow = EXCERPT_WINDOW,
): SearchExcerpt | null {
  regex.lastIndex = 0;
  const match = regex.exec(text);
  return match ? windowAround(text, match.index, match[0].length, span) : null;
}

/**
 * Every occurrence in one file, windowed, in the order they appear, with no
 * cap (`SearchResult.excerpts`).
 *
 * The port guarantees a global regex, so this walks it, and guards the
 * zero-length advance: a global regex that matches empty never leaves its
 * index and would spin forever. The port forbids a zero-length match; this is
 * a second guard, because a hung panel is worse than a missed pathological
 * query.
 */
export function excerptsAt(
  text: string,
  regex: RegExp,
  span: ExcerptWindow = EXCERPT_WINDOW,
): SearchExcerpt[] {
  regex.lastIndex = 0;
  const excerpts: SearchExcerpt[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    excerpts.push(windowAround(text, match.index, match[0].length, span));
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  regex.lastIndex = 0;
  return excerpts;
}

/** One match's window, in the line that holds it. */
function windowAround(
  text: string,
  start: number,
  length: number,
  span: ExcerptWindow,
): SearchExcerpt {
  const end = start + length;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEndAt = text.indexOf("\n", end);
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt;
  const line = text.slice(lineStart, lineEnd);

  // Everything below is in the line's coordinates, not the file's.
  const at = start - lineStart;
  // Clamped: a query of only spaces could match inside the indent `trim()`
  // removes and push `at` negative.
  if (line.length <= span.width)
    return { text: line.trim(), at: Math.max(0, at - lead(line)), length };

  // Pull back to `before` characters of lead-in, then take the window,
  // clamped at the line's end so a match near the end still shows the words
  // before it rather than running off into nothing.
  let from = Math.max(0, at - span.before);
  from = Math.min(from, Math.max(0, line.length - span.width));
  const to = Math.min(line.length, from + span.width);

  const head = from > 0 ? "…" : "";
  const tail = to < line.length ? "…" : "";
  return {
    text: `${head}${line.slice(from, to)}${tail}`,
    at: at - from + head.length,
    length,
  };
}

/** The whitespace `trim()` takes off the front, for `at` to account for. */
function lead(line: string): number {
  return line.length - line.trimStart().length;
}

/** A chat turn that answers the query, and who said it. */
function turnMatching(
  document: ChatSearchDocument,
  regex: RegExp,
  span: ExcerptWindow,
): { speaker: Speaker; excerpt: SearchExcerpt } | null {
  const excerpt = excerptAt(document.text, regex, span);
  return excerpt ? { speaker: document.speaker, excerpt } : null;
}

/**
 * Every match in the project, grouped and ordered.
 *
 * The order is fixed, never scored: the structure in `walk` order, the body
 * text in the same order, the chats, the bin, then the reference groups in
 * their fixed order. A list that reorders by relevance must be re-read from
 * the top on every keystroke; in this panel things stay where they are.
 *
 * Names come before bodies, and that is the only ranking: a writer who types
 * a Section's name wants that Section, not the places its name is mentioned.
 *
 * A node whose name matched still lists its body occurrences. "The Section is
 * called Light" and "the word light is in its prose nine times, here they
 * are" are two different answers.
 *
 * An empty query answers with nothing rather than everything: the caller
 * swaps the panel's body on it, and no query is not no matches.
 */
export function searchProject(input: SearchInput): ProjectSearch {
  const {
    structure,
    referenceFiles,
    query,
    regex,
    bodies,
    chats: documents,
    window: span = EXCERPT_WINDOW,
  } = input;
  if (!query.trim() || !regex || !structure) return { groups: [], total: 0 };

  const nodes: SearchResult[] = [];
  // A depth-indexed trail is the ancestor chain. Truncating to `depth` before
  // writing keeps a finished branch from leaking into the next.
  const trail: DocNode[] = [];
  const place: { node: DocNode; within?: string; nth?: number }[] = [];
  walk(structure.children, (node, depth) => {
    trail.length = depth;
    trail[depth] = node;
    const within = depth > 0 ? trail[depth - 1]?.title : undefined;
    place.push({ node, within });
  });
  // Namesakes: the same title in the same place, told apart by their order.
  const sameAs = (one: (typeof place)[number]) =>
    JSON.stringify([one.within ?? "", one.node.title.toLowerCase()]);
  const shared = new Map<string, number>();
  for (const one of place)
    shared.set(sameAs(one), (shared.get(sameAs(one)) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const one of place) {
    const key = sameAs(one);
    if ((shared.get(key) ?? 0) < 2) continue;
    one.nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, one.nth);
  }
  for (const { node, within, nth } of place) {
    if (!hits(node.title, regex)) continue;
    nodes.push({
      kind: "node",
      id: node.id,
      title: node.title,
      nodeKind: node.kind,
      within,
      ...(nth ? { nth } : {}),
    });
  }

  // The prose, in `walk` order too, so the second heading reads in book
  // order. Every node is asked, including those whose name matched above.
  const body: SearchResult[] = [];
  const chats: SearchResult[] = [];
  if (bodies) {
    for (const { node, within, nth } of place) {
      const text = bodies.get(NODE + node.id);
      if (text !== undefined) {
        const excerpts = excerptsAt(text, regex, span);
        if (excerpts.length > 0)
          body.push({
            kind: "body",
            excerpts,
            id: node.id,
            title: node.title,
            nodeKind: node.kind,
            within,
            ...(nth ? { nth } : {}),
          });
      }
    }
  }

  // Project chats arrive as documents, not files, so they are searched
  // whether or not the body index has read anything. At most 20 turns list.
  let chatRows = 0;
  for (const document of documents ?? []) {
    const turn = turnMatching(document, regex, span);
    if (turn && chatRows < 20) {
      chatRows += 1;
      chats.push({
        kind: "chat",
        chatId: document.chatId,
        turnId: document.turnId,
        title: document.title,
        chatKind: document.kind,
        speaker: turn.speaker,
        excerpt: turn.excerpt,
      });
    }
  }

  // The bin's top-level entries only: a subtree goes to the bin and comes
  // back whole, so a row inside one could not be restored.
  const removed: SearchResult[] = (structure.removed ?? [])
    .filter((node) => hits(node.title, regex))
    .map((node) => ({
      kind: "removed",
      id: node.id,
      title: node.title,
      nodeKind: node.kind,
    }));

  // Through `groupReference`, as `sourcesFor` is, so no result leads where
  // the reference panel does not go.
  const reference: SearchGroup[] = [];
  for (const group of groupReference(referenceFiles, structure)) {
    // A summary's name is not matched, only its text: the name of
    // `summary--EL2.md` is "EL2", which a writer never types. `nameOnly`
    // gates the title match, not the group.
    const nameOnly = group.id !== "summaries";
    const hitDocs: SearchResult[] = [];
    for (const doc of group.docs) {
      // The name first, then the text only if the name did not answer: one
      // row per reference document either way.
      if (nameOnly && hits(doc.title, regex)) {
        hitDocs.push({
          kind: "reference",
          fileName: doc.fileName,
          title: referenceTitle(doc.fileName),
          group: group.id,
        });
        continue;
      }
      const text = bodies?.get(REF + doc.fileName);
      const excerpt = text === undefined ? null : excerptAt(text, regex, span);
      if (excerpt)
        hitDocs.push({
          kind: "reference",
          fileName: doc.fileName,
          title: referenceTitle(doc.fileName),
          group: group.id,
          excerpt,
        });
    }
    if (hitDocs.length > 0)
      reference.push({ head: group.id, results: hitDocs });
  }

  const groups: SearchGroup[] = [];
  // A heading with nothing under it never draws. The book's own matter
  // comes first (its structure, its text, its reference), then the
  // conversations about it, then what is in the bin.
  if (nodes.length > 0) groups.push({ head: "structure", results: nodes });
  if (body.length > 0) groups.push({ head: "body", results: body });
  groups.push(...reference);
  if (chats.length > 0) groups.push({ head: "chat", results: chats });
  if (removed.length > 0) groups.push({ head: "bin", results: removed });

  return {
    groups,
    // Occurrences, not rows: a Section holding the word nine times draws nine
    // quotations, and "1 match" over them would contradict the screen.
    total: groups.reduce(
      (n, group) =>
        n +
        group.results.reduce(
          (m, r) => m + (r.kind === "body" ? r.excerpts.length : 1),
          0,
        ),
      0,
    ),
  };
}
