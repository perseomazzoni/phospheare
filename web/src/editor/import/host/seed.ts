// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { hashOf } from "../../../text/hash";
import { snapshotFileName, toSlug } from "../../../project/naming";
import type { AgeCategory, GenreId } from "../../../project/genres";
import type { ProjectSeed } from "../../../project/scaffold";
import {
  STRUCTURE_VERSION,
  type DocNode,
  type NodeStat,
} from "../../../project/types";
import { anchorForQuote } from "../../comments/domain/anchor";
import { writeComments } from "../../comments/domain/codec";
import { editorsFile, type EditorThread } from "../../comments/domain/imported";
import type { Draft, DraftNode, DraftComment } from "../domain/draft";
import type { ManuscriptWriter, ProjectRules } from "../ports";

// The draft, as a project the Library can write. The one hand-off from the
// import to the rest of the app: a `ProjectSeed`, the same shape the
// creation wizard hands the Library's `createFrom`, so an imported book is
// made by the code that makes a blank one: folder, scaffold, card,
// and the editor opening on it.
//
// What the seed carries, node by node, in pre-order (which is how ids are
// given, `EL1`, `EL2`…):
//   - the file name with the node's id in it, so two chapters both
//     called "Anna" are two files;
//   - its text, serialised by the engine's own codec;
//   - the content hash of that text, so the first open finds nothing out of
//     band;
//   - one snapshot, adopted, titled "<title> 1" like every first snapshot;
//   - its word count, the app's way, so the shelf card and the spine are
//     right from the first second.
//
// And the editors' comments the source carried, as each chapter's comments
// file: a reply joins the thread it answers, a resolved thread stays
// resolved, and each passage is found again in the text as the editor will
// show it, so the margin finds what the editor marked. A comment
// whose place the source lost lands on the first chapter, unanchored, rather
// than nowhere.

export interface ProjectFactsInput {
  title: string;
  author: string;
  language: string;
  type: string;
  goal: number;
  /** The creation wizard's Genre step, answered as for a blank project. */
  genres: GenreId[];
  ageCategory: AgeCategory | null;
  tropes: string[];
}

export async function seedFrom(
  draft: Draft,
  facts: ProjectFactsInput,
  destination: ProjectSeed["destination"],
  folderName: string,
  writer: ManuscriptWriter,
  rules: ProjectRules,
  now = new Date().toISOString(),
): Promise<ProjectSeed> {
  let next = 0;
  const files: { fileName: string; content: string }[] = [];
  const texts = new Map<string, string>();
  const stats: NodeStat[] = [];

  const build = async (node: DraftNode): Promise<DocNode> => {
    next += 1;
    const id = `EL${next}`;
    const file = snapshotFileName(node.kind, toSlug(node.title), id, 0);
    const content = writer.serialize(node.paragraphs);
    files.push({ fileName: file, content });
    texts.set(id, content);
    stats.push({ nodeId: id, words: rules.countWords(content) });
    const snapshot = {
      file,
      title: `${node.title} 1`,
      created: now,
      contentHash: await hashOf(content),
    };
    if (node.kind === "section")
      return {
        kind: "section",
        id,
        title: node.title,
        adopted: file,
        snapshots: [snapshot],
      };
    const children: DocNode[] = [];
    for (const child of node.children) children.push(await build(child));
    return {
      kind: "part",
      id,
      title: node.title,
      adopted: file,
      snapshots: [snapshot],
      children,
    };
  };

  const children: DocNode[] = [];
  for (const root of draft.roots) children.push(await build(root));

  return {
    destination,
    folderName,
    init: {
      shape: { structure: { version: STRUCTURE_VERSION, children }, files },
      document: {
        title: facts.title,
        author: facts.author,
        language: facts.language,
        type: facts.type,
        goal: facts.goal,
        genres: facts.genres,
        ageCategory: facts.ageCategory,
        tropes: facts.tropes,
        structure: null,
      },
      stats,
      ...(draft.comments.length > 0
        ? { comments: commentsFiles(draft.comments, texts, writer, now) }
        : {}),
    },
  };
}

/** Each chapter's comments file, from the draft's comments. */
function commentsFiles(
  comments: readonly DraftComment[],
  texts: ReadonlyMap<string, string>,
  writer: ManuscriptWriter,
  now: string,
): { nodeId: string; content: string }[] {
  const bySource = new Map(
    comments.map((comment) => [comment.sourceId, comment]),
  );
  // The comment a reply ultimately answers; a chain that loops or names a
  // comment the source did not carry ends at the last one it can reach.
  const rootOf = (comment: DraftComment): DraftComment => {
    const seen = new Set<DraftComment>();
    let at = comment;
    while (at.parentId && !seen.has(at)) {
      seen.add(at);
      const parent = bySource.get(at.parentId);
      if (!parent) break;
      at = parent;
    }
    return at;
  };
  const first = texts.keys().next().value;
  const paragraphs = new Map<string, string[]>();
  const visible = (nodeId: string) => {
    let out = paragraphs.get(nodeId);
    if (!out) {
      out = writer.visibleParagraphs(texts.get(nodeId) ?? "");
      paragraphs.set(nodeId, out);
    }
    return out;
  };

  const threads = new Map<DraftComment, EditorThread>();
  const byNode = new Map<string, EditorThread[]>();
  for (const comment of comments) {
    const root = rootOf(comment);
    let thread = threads.get(root);
    if (!thread) {
      const nodeId = root.anchor ? `EL${root.anchor.node + 1}` : first;
      if (!nodeId || !texts.has(nodeId)) continue;
      thread = {
        anchor: root.anchor
          ? anchorForQuote(visible(nodeId), {
              quote: root.anchor.quote.exact,
              prefix: root.anchor.quote.prefix,
              suffix: root.anchor.quote.suffix,
            })
          : null,
        resolved: root.resolved ?? false,
        entries: [],
      };
      threads.set(root, thread);
      byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), thread]);
    }
    thread.entries.push({
      name: comment.author ?? "",
      at: comment.date ?? now,
      body: comment.body
        .map((para) => para.map((run) => run.text).join(""))
        .join("\n"),
    });
  }

  let id = 0;
  const newId = () => {
    id += 1;
    return `c${id.toString(16).padStart(12, "0")}`;
  };
  return [...byNode].map(([nodeId, list]) => ({
    nodeId,
    content: writeComments(editorsFile(list, newId)),
  }));
}
