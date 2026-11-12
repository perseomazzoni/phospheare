// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The comments model and every change it allows. A comment is a thread in the
// margin of one chapter. It is anchored on a passage of the chapter's prose,
// or on the chapter as a whole, and holds one or more entries. Three kinds of
// author write them: the writer, an editor whose comments came in through an
// import, and a persona. A thread belongs to whoever opened it (`ownerOf`):
// that decides the colour it is counted in and, for a persona, who answers a
// reply.
//
// A ghost comment is not a separate thing: it is a thread in the `proposed`
// state, which only a persona creates. Keeping it or replying to it makes it
// `open`; dismissing it removes it and records the dismissal, so the persona
// does not raise it again.
//
// Everything here is pure: ids and times come in as arguments, so every rule
// is testable without a clock.

export type Author =
  | { kind: "writer" }
  | { kind: "editor"; name: string }
  | { kind: "persona"; id: string };

/**
 * Where a thread stands in the prose: the passage as the writer sees it
 * (visible text, never markdown), with a little of the text either side to
 * find it again after the prose around it changes (`anchor.ts`).
 */
export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface Entry {
  id: string;
  author: Author;
  /** ISO time. */
  at: string;
  /** Plain text. Never rendered as HTML or Markdown, from anyone. */
  body: string;
  /**
   * The web searches a persona's reply made on the writer's word,
   * in the order they went. Absent on every other entry.
   */
  searched?: readonly Searched[];
}

/**
 * One web search behind a reply, as the file keeps it: what was sent, to
 * which engine, and the pages it returned by address and title, never their
 * text, as a chat file keeps none.
 */
export interface Searched {
  engine: "wikipedia" | "web";
  query: string;
  links: readonly { url: string; title: string }[];
}

export type ThreadState = "proposed" | "open" | "resolved";

/** How much a persona's comment matters, for ranking against the cap. */
export type Weight = "major" | "minor" | "observation";

export interface Thread {
  id: string;
  state: ThreadState;
  /** Null: the thread is about the chapter, not one passage. */
  anchor: CommentAnchor | null;
  weight?: Weight;
  /** Never empty: `entries[0]` opens the thread, and its author owns it. */
  entries: Entry[];
}

/**
 * What a persona raised and the writer turned away, by dismissing a ghost
 * comment or removing a kept one. Kept so the same persona does not raise it
 * on the same passage again (`proposals.ts`).
 */
export interface Dismissal {
  persona: string;
  /** The passage it was about; empty for a chapter-level comment. */
  quote: string;
  /** The first line of what was said. */
  gist: string;
  at: string;
}

/** One chapter's comments: `comments/<nodeId>.json`. */
export interface CommentsFile {
  threads: Thread[];
  dismissed: Dismissal[];
}

export const EMPTY_FILE: CommentsFile = { threads: [], dismissed: [] };

/** Who opened the thread, and so owns it. */
export function ownerOf(thread: Thread): Author {
  return thread.entries[0].author;
}

/** The persona that owns the thread, or null when a person does. */
export function personaOf(thread: Thread): string | null {
  const owner = ownerOf(thread);
  return owner.kind === "persona" ? owner.id : null;
}

/** The first line of a body, for a dismissal's gist and a card's summary. */
export function firstLine(body: string): string {
  return body.trim().split("\n", 1)[0] ?? "";
}

function withThread(
  file: CommentsFile,
  id: string,
  change: (thread: Thread) => Thread,
): CommentsFile {
  if (!file.threads.some((thread) => thread.id === id)) return file;
  return {
    ...file,
    threads: file.threads.map((thread) =>
      thread.id === id ? change(thread) : thread,
    ),
  };
}

export interface NewThread {
  id: string;
  anchor: CommentAnchor | null;
  entry: Entry;
  /** Only a persona proposes; anyone else opens. */
  state?: ThreadState;
  weight?: Weight;
}

/** A new thread, at the end of the file. */
export function openThread(file: CommentsFile, next: NewThread): CommentsFile {
  const thread: Thread = {
    id: next.id,
    state: next.state ?? "open",
    anchor: next.anchor,
    ...(next.weight ? { weight: next.weight } : {}),
    entries: [next.entry],
  };
  return { ...file, threads: [...file.threads, thread] };
}

/**
 * An entry added to a thread. The writer answering a ghost comment has
 * engaged with it, so it becomes open; a resolved thread someone writes in
 * is open again, because a new word reopens the question.
 */
export function addEntry(
  file: CommentsFile,
  threadId: string,
  entry: Entry,
): CommentsFile {
  return withThread(file, threadId, (thread) => ({
    ...thread,
    state:
      thread.state === "proposed" && entry.author.kind === "persona"
        ? "proposed"
        : "open",
    entries: [...thread.entries, entry],
  }));
}

/** A ghost comment the writer keeps. */
export function keep(file: CommentsFile, threadId: string): CommentsFile {
  return withThread(file, threadId, (thread) =>
    thread.state === "proposed" ? { ...thread, state: "open" } : thread,
  );
}

export function resolve(file: CommentsFile, threadId: string): CommentsFile {
  return withThread(file, threadId, (thread) => ({
    ...thread,
    state: "resolved",
  }));
}

export function reopen(file: CommentsFile, threadId: string): CommentsFile {
  return withThread(file, threadId, (thread) =>
    thread.state === "resolved" ? { ...thread, state: "open" } : thread,
  );
}

/** The thread placed on another passage (or on the chapter, with null). */
export function reanchor(
  file: CommentsFile,
  threadId: string,
  anchor: CommentAnchor | null,
): CommentsFile {
  return withThread(file, threadId, (thread) => ({ ...thread, anchor }));
}

/**
 * The thread taken away. Dismissing a ghost comment and removing a kept
 * comment are the same act here: when a persona owns the thread, what it
 * said is remembered so it is not said again. A person's thread simply goes.
 */
export function remove(
  file: CommentsFile,
  threadId: string,
  at: string,
): CommentsFile {
  const thread = file.threads.find((one) => one.id === threadId);
  if (!thread) return file;
  const threads = file.threads.filter((one) => one.id !== threadId);
  const persona = personaOf(thread);
  if (!persona) return { ...file, threads };
  return {
    threads,
    dismissed: [
      ...file.dismissed,
      {
        persona,
        quote: thread.anchor?.quote ?? "",
        gist: firstLine(thread.entries[0].body),
        at,
      },
    ],
  };
}
