// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { withSkillDetectors, type Obsession } from "../domain/obsessions";
import {
  candidateCount,
  signalGroups,
  type SignalGroup,
} from "../domain/signals/briefing";
import type { AiSkill } from "../domain/skills";

/** A text the run attached, scanned when the pass starts. */
export interface AttachedProse {
  id: string;
  text: string;
}

/**
 * One run's signal pre-pass: what a word list finds in the prose for the
 * persona's obsessions, handed over as candidates to judge. The attached
 * prose is scanned when the pass starts, for the request; every Section a
 * `read_source` returns is scanned beside its text, since a remote model
 * reads every Section through the tool. Each text is scanned once per run,
 * and the count lands on the turn, so a chat file says whether the pre-pass
 * ran at all.
 */
export class SignalPass {
  /** The attached prose's candidates, for the request's briefing. */
  readonly attached: readonly SignalGroup[];
  private obsessions: readonly Obsession[];
  private candidates: number;
  private readonly scannedIds: ReadonlySet<string>;
  private readonly scannedReads = new Set<string>();

  constructor(
    obsessions: readonly Obsession[],
    private readonly languageCode: string | undefined,
    prose: readonly AttachedProse[],
  ) {
    this.obsessions = obsessions;
    this.attached = signalGroups(
      prose.map((one) => one.text),
      languageCode,
      obsessions,
    );
    this.candidates = candidateCount(this.attached);
    this.scannedIds = new Set(prose.map((one) => one.id));
  }

  /** How many candidates the pass has handed over in this run. */
  get count(): number {
    return this.candidates;
  }

  /**
   * A skill picked up mid-answer: from now on, the Sections read carry that
   * skill's candidates too.
   */
  addSkill(skill: AiSkill): void {
    this.obsessions = withSkillDetectors(this.obsessions, skill);
  }

  /**
   * The candidates in a text a tool read, or none for a text this run has
   * already scanned: attached prose, or the same read again.
   */
  scan(sourceId: string, read: string): readonly SignalGroup[] {
    const key = `${sourceId}:${read.length}:${read.slice(0, 80)}`;
    if (this.scannedIds.has(sourceId) || this.scannedReads.has(key)) return [];
    this.scannedReads.add(key);
    const groups = signalGroups([read], this.languageCode, this.obsessions);
    this.candidates += candidateCount(groups);
    return groups;
  }
}
