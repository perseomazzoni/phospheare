// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Icon } from "../../ui/icons";
import { appIcons } from "../../ui/appIcons";
import type {
  ProjectSearch,
  SearchExcerpt,
  SearchResult,
} from "../../project/search";
import type { DocNode } from "../../project/types";
import { chatTitleShown } from "../assistant/chatTitleShown";

// The structure panel's second face: what the writer's query turned up, in
// place of the tree. It is a leaf, handed results and callbacks, and knows
// nothing about providers, projects or how the search ran. The `.dt-scroll`
// on its container gives it the tree's grip margin, top padding, scrollbar
// rules and layout, none of which it restates.

export interface GlobalSearchProps {
  results: ProjectSearch;
  /** What the writer typed, for the row to hand back on a body hit. */
  query: string;
  /**
   * This list is not yet the answer to what is in the field.
   *
   * It gates the "Nothing matches." sentence, which a writer believes, so it
   * may only be said about a list that is the answer. The sweep may still be
   * running, or the results may lag the field by a render (a deferred value);
   * a stale non-empty list is harmless, a stale "Nothing matches." is wrong.
   * Meanwhile the body stays empty under the field's own loader.
   */
  pending: boolean;
  /** The open file's node, so a hit on it reads as the row already does. */
  activeId: string | null;
  /**
   * The occurrence the writer last opened from this list, if it is still the
   * one they are standing in. The mark belongs on the line they clicked, not
   * on the whole body group.
   */
  activeOccurrence: { id: string; ordinal: number } | null;
  /** A structure hit: open the node's own file. */
  onOpenNode: (id: string) => void;
  /**
   * A body hit: open the node's file and land on the occurrence clicked.
   *
   * The query travels, never an offset: the editor re-runs the
   * search on the parsed `Doc` and walks to the Nth match, because the index
   * counts characters in raw markdown and the engine in a parsed document,
   * and no mapping between the two survives markup.
   *
   * The ordinal travels with it: which occurrence in this file the writer
   * pointed at. The two counts agree for every query that does not straddle
   * markup, and where they disagree the editor finds no Nth match to scroll
   * to. Every occurrence is still marked, so the writer lands in the file
   * with their words lit.
   */
  onOpenBody: (id: string, query: string, ordinal: number) => void;
  /** A chat hit: open the node, and the face its conversation lives on. */
  onOpenChat: (chatId: string, turnId: string) => void;
  /** A reference hit: open that document. */
  onOpenReference: (fileName: string) => void;
  /** A bin hit: begin putting it back, which is what the bin's own row does. */
  onRestore: (id: string) => void;
  /**
   * The panel is showing the tree, not this.
   *
   * This face is mounted whenever the tree is, so the two slide past each
   * other rather than cut: an element that is not laid out cannot be
   * animated. Which one is on is one attribute on the panel's head, read by
   * the stylesheet. That answer must reach a screen reader without a
   * stylesheet too: `visibility: hidden` takes this out of the accessibility
   * tree in a browser, and nothing does in jsdom, so `aria-hidden` says it.
   */
  atRest?: boolean;
}

export default function GlobalSearch({
  atRest,
  results,
  query,
  pending,
  activeId,
  activeOccurrence,
  onOpenNode,
  onOpenBody,
  onOpenChat,
  onOpenReference,
  onRestore,
}: GlobalSearchProps) {
  const { t } = useTranslation();
  const groups = results.groups;

  // No landmark, neither one for the face nor one per group. The `aside` is
  // this panel's landmark, and the tree face declares none of its own
  // (`Region` renders an unnamed `section`, which maps to `generic`). A named
  // region here would make the sidebar's landmark map change as the writer
  // types, and a keystroke must not reshape the document's skeleton. A
  // screen reader navigates by the headings, so they are real headings, not
  // styled divs.
  return (
    <div className="dt-scroll dt-search" aria-hidden={atRest || undefined}>
      {query.trim() === "" ? (
        // The face comes up before there is a query, so it opens on one line
        // saying what it is for rather than an empty panel. Not
        // `.dt-moving-none`, the panel's voice for "this mode has nothing for
        // you": a mode nobody has asked a question of has nothing to report.
        <p className="dt-search-invite">{t("tree.findInvite")}</p>
      ) : results.total === 0 && !pending ? (
        // The mode's own statement, in the voice the panel uses when a mode
        // has nothing to offer, not the empty-container voice, which is a
        // fact about a node. The same key the count speaks, with the same
        // count: a drawn sentence and a spoken one that differ are two
        // answers to one question.
        <p className="dt-moving-none">{t("tree.findCount", { count: 0 })}</p>
      ) : (
        groups.map((group) => (
          <div className="dt-search-group" key={group.head}>
            <h3 className="dt-region-label">{headingFor(group.head, t)}</h3>
            {group.results.map((result) =>
              result.kind === "body" ? (
                <OccurrenceGroup
                  key={keyFor(result)}
                  result={result}
                  activeAt={
                    activeOccurrence?.id === result.id
                      ? activeOccurrence.ordinal
                      : null
                  }
                  onOpen={(ordinal) => onOpenBody(result.id, query, ordinal)}
                />
              ) : (
                <Row
                  key={keyFor(result)}
                  result={result}
                  activeId={activeId}
                  onOpenNode={onOpenNode}
                  onOpenChat={onOpenChat}
                  onOpenReference={onOpenReference}
                  onRestore={onRestore}
                />
              ),
            )}
          </div>
        ))
      )}
    </div>
  );
}

/**
 * The heading's words, all of them already in the locale files.
 *
 * `tree.structure` is the key the tree face's own heading uses, because a
 * second word for one object would ask the writer whether it now means
 * something else. What tells them the body changed is a second heading
 * where there was one, over rows with no chevrons.
 */
function headingFor(
  head: ProjectSearch["groups"][number]["head"],
  t: (key: string) => string,
): string {
  if (head === "structure") return t("tree.structure");
  // Not "Body text" beside "Structure" as if they were two kinds of object:
  // one heading names what was searched, `tree.findInText` names where the
  // words were.
  if (head === "body") return t("tree.findInText");
  // The Dock's own word for the face this leads to.
  if (head === "chat") return t("dock.ask");
  if (head === "bin") return t("bin.label");
  return t(`reference.group.${head}`);
}

function keyFor(result: SearchResult): string {
  if (result.kind === "reference") return `ref:${result.fileName}`;
  if (result.kind === "chat") return `chat:${result.chatId}:${result.turnId}`;
  return `${result.kind}:${result.id}`;
}

/**
 * Whether this row is about a node, and which. A chat turn is about no node:
 * chats are project-wide, and the search is handed none to point at.
 */
function nodeOf(result: SearchResult): string | null {
  if (result.kind === "reference" || result.kind === "chat") return null;
  return result.id;
}

/**
 * The excerpt, with the words that matched marked inside it by `<mark>`, as
 * the in-document highlighter marks them.
 *
 * The slice is taken at the offsets the search returned rather than by
 * searching the excerpt again, which would find the first occurrence inside
 * the window, not necessarily the row's: "the storm before the storm" would
 * mark the wrong half.
 */
function Excerpt({ excerpt }: { excerpt: SearchExcerpt }) {
  const { text, at, length } = excerpt;
  return (
    <span className="dt-search-excerpt">
      {text.slice(0, at)}
      <mark>{text.slice(at, at + length)}</mark>
      {text.slice(at + length)}
    </span>
  );
}

/**
 * One hit, one line, except a quotation, which is two.
 *
 * A name row stays one line: two would halve the hits visible in a 248px
 * column. A hit in a conversation or a reference document takes two, because
 * a hit that does not show the writing says only "it is in here somewhere".
 * Body text is `OccurrenceGroup`.
 *
 * The panel does not widen for excerpts: an excerpt is windowed around the
 * match (`excerptAt`), because a panel that resizes as the writer types
 * moves on its own.
 *
 * The location slot carries only what the heading does not: a Section says
 * which Part it is in; a Part, a bin item and a reference say nothing.
 */
function Row({
  result,
  activeId,
  onOpenNode,
  onOpenChat,
  onOpenReference,
  onRestore,
}: {
  result: Exclude<SearchResult, { kind: "body" }>;
  activeId: string | null;
  onOpenNode: (id: string) => void;
  onOpenChat: (chatId: string, turnId: string) => void;
  onOpenReference: (fileName: string) => void;
  onRestore: (id: string) => void;
}) {
  const { t } = useTranslation();
  // Present on a hit in the writing rather than in a name: body text, a
  // reference document's contents, something said in a conversation.
  const excerpt = "excerpt" in result ? result.excerpt : undefined;
  // A bin row is never "the open one": what is in the bin is not open, and
  // marking it would say a node and its copy in the bin are one thing.
  //
  // The `!== null` keeps two absences apart. A reference document is about
  // no node, so `nodeOf` answers `null` for it, and `activeId` is also `null`
  // until the writer opens something, so without it every reference row
  // would read as the open one on a fresh project's first search.
  const owner = nodeOf(result);
  const active =
    result.kind !== "removed" && owner !== null && owner === activeId;
  // A reference document has no glyph anywhere in this app (`ref-card-row`
  // draws its title alone), so the face does not invent one. The slot is
  // still held, empty, so every label in the column starts at the same x
  // whichever heading it sits under.
  const glyph =
    result.kind === "removed"
      ? appIcons.delete
      : result.kind === "chat"
        ? appIcons.assistant
        : result.kind === "node"
          ? glyphFor(result.nodeKind)
          : null;

  return (
    <button
      type="button"
      className={`dt-search-row${active ? " active" : ""}${
        excerpt ? " dt-search-quote" : ""
      }`}
      aria-current={active ? "true" : undefined}
      onClick={() => {
        if (result.kind === "reference") onOpenReference(result.fileName);
        else if (result.kind === "removed") onRestore(result.id);
        else if (result.kind === "chat")
          onOpenChat(result.chatId, result.turnId);
        else onOpenNode(result.id);
      }}
    >
      <span className="dt-search-glyph">
        {glyph && <Icon name={glyph} size={11} />}
      </span>
      <span className="dt-search-label">
        {result.kind === "chat"
          ? chatTitleShown(t, { title: result.title, kind: result.chatKind })
          : result.title}
      </span>
      {result.kind === "node" && (result.within || result.nth) && (
        <span className="dt-search-where">{placeOf(result)}</span>
      )}
      {result.kind === "chat" && (
        <span className="dt-search-where">
          {t(result.speaker === "you" ? "dock.you" : "dock.assistant")}
        </span>
      )}
      {excerpt && <Excerpt excerpt={excerpt} />}
    </button>
  );
}

function glyphFor(kind: DocNode["kind"]) {
  return kind === "part" ? appIcons.part : appIcons.section;
}

/**
 * One Part or Section, and every place inside it where the words turn up.
 *
 * A heading naming the node and how many times it holds the query, then one
 * quotation per occurrence, each somewhere the writer can go. A panel that
 * finds a word nine times and prints it once withholds the useful half.
 *
 * The heading is not a button: every occurrence under it opens this node,
 * so a target meaning "the same file, at no particular place" would be a
 * choice with nothing in it. It carries no mark either: `activeOccurrence`
 * marks the line the writer clicked.
 */
function OccurrenceGroup({
  result,
  activeAt,
  onOpen,
}: {
  result: Extract<SearchResult, { kind: "body" }>;
  /** Which occurrence the writer is standing in, or `null` for none. */
  activeAt: number | null;
  onOpen: (ordinal: number) => void;
}) {
  // A `group` carrying the node's name, so the quotations under the heading
  // are announced as belonging to it. Each button reads out the writer's own
  // sentence, the only useful label a quotation can have; without the group
  // they would be a run of sentences from nowhere.
  return (
    <div role="group" aria-label={result.title} className="dt-search-source">
      <div className="dt-search-row dt-search-head">
        <span className="dt-search-glyph">
          <Icon name={glyphFor(result.nodeKind)} size={11} />
        </span>
        <span className="dt-search-label">{result.title}</span>
        {(result.within || result.nth) && (
          <span className="dt-search-where">{placeOf(result)}</span>
        )}
        <span className="dt-search-tally">{result.excerpts.length}</span>
      </div>
      {result.excerpts.map((excerpt, ordinal) => (
        <button
          key={ordinal}
          type="button"
          className={`dt-search-row dt-search-occurrence${
            ordinal === activeAt ? " active" : ""
          }`}
          // The line clicked, where the writer is standing, is state, not
          // decoration: the tint alone fails WCAG 1.4.1, and a fact drawn
          // twice (the mark in the prose is the other half) must be sayable
          // twice.
          aria-current={ordinal === activeAt ? "true" : undefined}
          onClick={() => onOpen(ordinal)}
        >
          <Excerpt excerpt={excerpt} />
        </button>
      ))}
    </div>
  );
}

/**
 * Where a Section sits, as its row prints it: its Part and, when the place
 * holds more than one node of that title, which of them this is ("Part One
 * #2"). Titles are free, so a name alone may open the wrong chapter.
 */
function placeOf(result: { within?: string; nth?: number }): string {
  return [result.within, result.nth ? `#${result.nth}` : undefined]
    .filter(Boolean)
    .join(" ");
}
