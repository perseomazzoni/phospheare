// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a run leaves as evidence: the context it used, the anchors and
// findings it cites, and the receipts of its tool calls.

import type { ContextCoverage, SourceDescriptor } from "./sources";

/**
 * A receipt, and only a receipt: which source entered a turn, at what revision,
 * and how much of it.
 *
 * It carries no text. The receipt is persisted on the turn, so text here
 * would put a second copy of the writer's prose in the chat record once per
 * turn, and the turn footer shows only title, authority, coverage and origin.
 * The text lives beside the receipts for the length of one run
 * (`ContextSelection.texts`) and is dropped with it.
 */
export interface ContextUse extends SourceDescriptor {
  /**
   * `declared`: a reference or note the review's command says it reads,
   * attached by the app before the model asked. `named`: one the
   * writer named for this review (`/canon Marta`), required.
   */
  reason: "default" | "pinned" | "retrieved" | "tool" | "declared" | "named";
  coverage: ContextCoverage;
  characters: number;
  /**
   * Where the bytes came from when this use was captured: the writer's unsaved
   * buffer or the file on disk. A receipt is frozen: `revision` above is the
   * captured revision, and the receipt says what was sent, not what the
   * source says now.
   */
  origin?: "live-buffer" | "project-file";
}

export interface EvidenceAnchor {
  sourceId: string;
  /**
   * The revision the quote was captured against. Validation compares the
   * quote to the captured text first; a missing or mismatched revision means
   * the anchor cannot be verified and must not be shown as fact.
   */
  revision?: string;
  quote: string;
  /** Neighbouring text, used only to disambiguate a repeated quotation. */
  prefix?: string;
  suffix?: string;
  /**
   * Set by the evidence check, never by the model: on a reference whose page
   * the catalogue knows, the field the quote sits in (`fieldRef`).
   * It is found by the quote's place in the file, so the same words under two
   * fields name the one the quote was taken from.
   */
  field?: string;
}

export type FindingStatus = "open" | "dismissed" | "resolved" | "stale";

export interface Finding {
  id: string;
  severity: "observation" | "minor" | "major";
  title: string;
  explanation: string;
  /** The model's own statement of doubt: an explanation, never a percentage. */
  uncertainty?: string;
  /**
   * Set by the evidence check, never by the model, when it demoted the
   * finding: `all` when none of its quotations is in the text, `half` when a
   * claim between sources kept only one side (`validateFinding`). A flag, not
   * a sentence appended to `uncertainty`, so the screen says it in the
   * writer's language rather than as an English note inside a finding in
   * another language.
   */
  unverified?: "all" | "half";
  evidence: EvidenceAnchor[];
  status: FindingStatus;
}

/**
 * What a tool call did: the turn footer's display data, and enough to put the
 * exchange back in front of the model on a later turn, so a chapter read on
 * turn one is still there on turn two. A web search's is display
 * data only (`keepsNoReceiptBody`): its query and results live in
 * `turn.web`, checked, and are never replayed as a tool message.
 *
 * `result` is bounded (`TOOL_RESULT_RETAINED`) and truncation is marked in
 * the text the model sees. A `read_source` payload is the writer's prose, and
 * a chat file that kept every one whole would carry a second copy of the
 * manuscript, once per turn, toward `CHAT_MAX_BYTES`. Bounded is safe because
 * the tools are addressable: a model that needs more of a source than the
 * retained slice calls `read_source` again with a range.
 */
export interface ToolReceipt {
  callId: string;
  name: string;
  status: "ok" | "error";
  /** Present for read-shaped tools. */
  sourceId?: string;
  /**
   * Every source a many-source result drew words from, such as a grep's
   * matches. The reader check (`readerContamination`) needs them: a
   * grep's excerpts are the writer's prose, and a result that names many
   * sources has no one `sourceId` to record.
   */
  sourceIds?: string[];
  /** What the model asked for. Replayed verbatim, never re-executed. */
  arguments?: unknown;
  /** What came back, serialized and capped. Absent on an unreplayable call. */
  result?: string;
  /** True when `result` is a prefix of what the tool returned. */
  truncated?: boolean;
}
