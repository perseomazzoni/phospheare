// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Which notice a command bound for a remote model needs before it is sent:
// what of the book leaves, read from the parse the submit uses.

import { MAP_ANCHORS_MAX } from "../../ai";
import type { SourceDescriptor } from "../../ai/domain/types";
import { actionOf, asksAt, type AiCommand } from "../../ai/domain/skills";
import { summariesToWrite } from "../../ai/domain/sourceView";
import { isPart, partFor, sectionsInPart } from "../../ai/domain/parts";
import { isFactTask } from "../../ai/domain/policy";
import { nearScope, type OpenNode } from "./summarisePart";

/**
 * Which transit notice a typed command needs, or `null`. `/where` sends
 * summaries and a few whole Sections, `/map` its own list, and a review the
 * Sections it reads; `/line-editing` sweeps the Sections and never maps, so
 * it says no summary leaves. A question sends nothing in bulk.
 */
export function transitOf(
  command: AiCommand,
  catalogue: readonly SourceDescriptor[],
  open: OpenNode | null,
): { key: string; options?: { count: number } } | null {
  // Nothing is sent for a reference the book does not hold.
  if (command.kind === "unknown-reference") return null;
  const action = actionOf(command.skill);
  switch (action) {
    case "locate":
      return { key: "dock.where.remoteTransit" };
    // A claim, a quote the writer attached and the results that came back:
    // what a question sends, so it needs no notice of its own.
    case "verify":
      return null;
    case "map":
      // A Section map sends the Section itself, whole: its own line, chosen
      // from the parse for `section` and for a Section's title alike, so the
      // notice and the run cannot disagree.
      if (
        command.kind === "scoped" &&
        (command.scope.kind === "section" ||
          (command.scope.kind === "node" &&
            catalogue.some(
              (one) =>
                one.nodeKind === "section" &&
                one.nodeId === (command.scope as { nodeId: string }).nodeId,
            )))
      )
        return { key: "dock.map.remoteTransitSection" };
      // The count is the engine's own cap, never a copy of it in the copy: a
      // notice must never understate what leaves.
      return {
        key: "dock.map.remoteTransit",
        options: { count: MAP_ANCHORS_MAX },
      };
    case "review": {
      if (command.kind !== "scoped") return null;
      const { scope } = command;
      const wide =
        scope.kind === "structure" ||
        scope.kind === "part" ||
        (scope.kind === "node" &&
          catalogue.some(
            (one) => one.nodeKind === "part" && one.nodeId === scope.nodeId,
          ));
      // A near review (the open Section, a quote, a named Section) sends the
      // whole Section and the references its command declares, in full.
      // Unlike a question, which attaches nothing the writer did not point
      // at, it is said before it is sent, like any wide one. Shown whether
      // or not the project has references: the budget decides at run time,
      // and a line that sometimes overstates is the safe one.
      //
      // A fact check reads every Section the chat may read into its ledger,
      // whatever the scope, and the fact sheets beside them: all of them the
      // first time, afterwards the ones changed since.
      if (isFactTask(command.skill.reviewTask))
        return { key: "dock.reviewTransit.facts" };
      if (!wide) return { key: "dock.reviewTransit.section" };
      return {
        key:
          command.skill.reviewTask === "line"
            ? "dock.reviewTransit.sections"
            : "dock.reviewTransit.withSummaries",
      };
    }
    case "summarise": {
      if (command.kind !== "scoped") return null;
      const scope = nearScope(command.scope, open);
      // Asked as a question, it sends what a question sends; another
      // Section's title is refused before anything leaves.
      if (
        asksAt(command.skill, scope) ||
        (scope.kind === "node" &&
          catalogue.some(
            (one) => one.nodeKind === "section" && one.nodeId === scope.nodeId,
          ))
      )
        return null;
      const part =
        scope.kind === "part"
          ? open && partFor(catalogue, open.id)
          : scope.kind === "node" && isPart(catalogue, scope.nodeId)
            ? scope.nodeId
            : null;
      // A number only when it is an upper bound. This listing
      // is not re-read on a keystroke, and one edit in a Section whose
      // summary is current makes the run, which re-lists, send it whole too.
      // So the run's own list (`summariesToWrite`) is stated only when it
      // already holds every Section that may leave, barred ones apart, since
      // they never leave. Otherwise, and before the catalogue
      // is read, the whole-Sections clause stays with no number, because
      // overstating is the safe side. "The 0 Sections" is never a sentence.
      const eligible = part
        ? sectionsInPart(catalogue, part).filter(
            (id) => !catalogue.find((one) => one.id === id)?.summaryBarred,
          )
        : [];
      const count = summariesToWrite(catalogue, eligible).length;
      return count > 0 && count === eligible.length
        ? { key: "dock.summarisePart.remoteTransit", options: { count } }
        : { key: "dock.summarisePart.remoteTransitAny" };
    }
    // One whole Section, the back cover and the reader's own journal; a
    // prediction reads no Section at all.
    case "journal":
      return { key: "dock.reading.remoteTransit" };
    case "predict":
      return { key: "dock.reading.remoteTransitPredict" };
    case "question":
      return null;
    default:
      return action satisfies never;
  }
}
