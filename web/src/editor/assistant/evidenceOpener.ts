// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Evidence, EvidenceAnchor, SourceDescriptor } from "../../ai";
import { REFERENCE_DIR } from "../../project/naming";
import { findNode } from "../../project/structure";
import type { DocumentStructure } from "../../project/types";
import type { EvidenceContext } from "../searchArrival";

// The evidence entry point: the host half of the AI core's `Evidence` port.
// Given a source id (and, for `reveal`, a validated quotation), it opens that
// source where the writer can see it. A manuscript source opens its node's
// file and arrives at the passage through the arrival the project search uses,
// with no coordinate mapping, as its evidence kind. A reference-shaped source
// opens the reader on its own face.

/**
 * The two entry points the writing surface lends the AI composition root.
 * The surface owns the arrival state and the reference face, so it registers
 * them once; `null` until it has.
 */
export interface EvidenceTargets {
  /**
   * Arrive in `file` at `passage`, marked as evidence. `file` is the node's
   * bare adopted file name, the spelling `activeFile` uses and `marksFor`
   * compares against, never its path on disk. `passage` is the
   * quote as the surface shows it (`evidencePassage`); `ordinal` is which of
   * its occurrences the anchor cites (`evidenceOrdinal`).
   */
  arrive: (file: string, passage: string, ordinal: number) => void;
  openDocument: (fileName: string) => void;
}

export interface EvidenceOpenerDependencies {
  /** The live source catalogue: the click-time check. */
  list: () => Promise<SourceDescriptor[]>;
  structure: () => DocumentStructure | null;
  /** The file the surface has open, by its bare adopted name. */
  activeFile: () => string | null;
  /**
   * Whether the open file holds unsaved edits. `openFile` then only asks the
   * writer whether to keep them, and returns before they answer.
   */
  unsaved: () => boolean;
  openFile: (fileName: string) => Promise<unknown>;
  /**
   * The quote as the now-open document shows it, or null when it cannot be
   * shown as one passage (`evidencePassage` over the engine's document).
   * Asked after the file opens, because that is the document it must be in.
   */
  passage: (quote: string) => string | null;
  /**
   * Which occurrence of that passage the anchor's context names, counted the
   * way the painter counts (`evidenceOrdinal` over the same document).
   */
  ordinal: (passage: string, context: EvidenceContext) => number;
  targets: () => EvidenceTargets | null;
  /**
   * The host's `Evidence.watch`: it alone can see the open file and the
   * engine's document, so the predicate is built there and only forwarded.
   */
  watch: () => () => boolean;
}

/**
 * Return focus once the surface has settled. The prose takes it as the
 * Section opens and again as the arrival commits, so this waits a frame
 * rather than racing either; an element gone by then is left alone.
 */
function giveBack(element: HTMLElement): void {
  requestAnimationFrame(() => {
    if (element.isConnected) element.focus({ preventScroll: true });
  });
}

export function createEvidenceOpener(
  deps: EvidenceOpenerDependencies,
): Evidence {
  // The one entry point both verbs go through. The catalogue lookup is the
  // click-time check: an id the live listing does not name opens
  // nothing. An anchor only decides whether a manuscript source also lands on
  // a passage, and on which of a repeated quote's places; a reference opens
  // on its own face either way.
  const show = async (
    sourceId: string,
    anchor?: EvidenceAnchor,
    onlyIf?: () => boolean,
  ): Promise<"selected" | "unavailable" | "withheld" | "held"> => {
    const targets = deps.targets();
    if (!targets) return "unavailable";
    const source = (await deps.list()).find((one) => one.id === sourceId);
    if (!source) return "unavailable";
    // Checked after the entry point's own await and before anything moves: the
    // writer may have started typing while the catalogue was read.
    // Never after the file opens: opening it is this entry point's own switch,
    // not the writer's, and the predicate would count it against them.
    if (onlyIf && !onlyIf()) return "withheld";
    // A landing nobody clicked for (`onlyIf` is `/where`'s own) leaves focus
    // where the writer left it, in the composer they asked from.
    // Opening a Section focuses the prose, which is right for a click and
    // wrong here: the writer's next key would land in their manuscript. Focus
    // is handed back on every path past the switch, including the ones that
    // cannot mark. `giveBack` waits a frame, so calling it before
    // `arrive` still lands after the arrival's own focus.
    const held = onlyIf ? document.activeElement : null;
    const handBack = () => {
      if (held instanceof HTMLElement) giveBack(held);
    };
    if (source.kind === "manuscript") {
      const structure = deps.structure();
      const node =
        source.nodeId && structure ? findNode(structure, source.nodeId) : null;
      if (!node) return "unavailable";
      // Over unsaved prose, opening another Section only asks the writer
      // whether to keep it, and the engine still holds the old document, so
      // no passage lands under the question. A click asks, since the writer
      // chose to go there, and is `held`: the question speaks, not a refusal.
      // A landing nobody clicked for never asks, so the writer's prose is
      // never one hasty answer away from discarded.
      if (
        anchor !== undefined &&
        deps.activeFile() !== node.adopted &&
        deps.unsaved()
      ) {
        if (onlyIf) return "unavailable";
        await deps.openFile(node.adopted);
        return "held";
      }
      await deps.openFile(node.adopted);
      handBack();
      if (anchor === undefined) return "selected";
      // The whole quote or nothing. A quote the open document cannot
      // show as one passage leaves the Section open and says so, rather than
      // painting part of it, which would read as a search hit.
      const passage = deps.passage(anchor.quote);
      if (passage === null) return "unavailable";
      // The context that verified a repeated quote travels to the landing,
      // so the arrival marks the cited copy, not the first.
      const ordinal = deps.ordinal(passage, {
        prefix: anchor.prefix,
        suffix: anchor.suffix,
      });
      // The bare adopted name, the spelling `activeFile` carries. A path on
      // disk never matches the open file in `marksFor`, so the arrival would
      // open the right Section and mark nothing.
      targets.arrive(node.adopted, passage, ordinal);
      return "selected";
    }
    if (source.path.startsWith(`${REFERENCE_DIR}/`)) {
      targets.openDocument(source.path.slice(REFERENCE_DIR.length + 1));
      handBack();
      return "selected";
    }
    return "unavailable";
  };
  return {
    reveal: (anchor, options) => show(anchor.sourceId, anchor, options?.onlyIf),
    // `show` answers `withheld` only when handed a predicate, and `open`
    // never hands it one.
    open: async (sourceId) =>
      (await show(sourceId)) === "selected" ? "selected" : "unavailable",
    watch: deps.watch,
  };
}
