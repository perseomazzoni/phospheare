// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SummaryMetadata, SummaryState } from "../domain/types";
import { summaryFreshness } from "../domain/summaryFreshness";

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// Generated summaries on disk. Metadata and body are one artifact. The body
// hash tells "Unverified" from "Current": a file the writer edited outside the
// app stops matching its own metadata, and a summary whose source revision
// moved on is Outdated without a model call.

/**
 * The summary's metadata and body, or `null` for anything that is not a
 * schema-1 summary with a node id, string source hashes and a body hash, so
 * a hand-edited or foreign file reads as Unverified.
 */
export function parseSummary(
  raw: string,
): { metadata: SummaryMetadata; body: string } | null {
  const match = FRONTMATTER.exec(raw.replace(/^\uFEFF/, ""));
  if (!match) return null;
  try {
    const metadata = parseYaml(match[1]) as SummaryMetadata;
    if (
      !metadata ||
      metadata.schemaVersion !== 1 ||
      typeof metadata.nodeId !== "string" ||
      !Array.isArray(metadata.sources) ||
      metadata.sources.some(
        (source) =>
          typeof source?.nodeId !== "string" ||
          typeof source?.contentHash !== "string",
      ) ||
      typeof metadata.bodyHash !== "string"
    )
      return null;
    return { metadata, body: match[2].trim() };
  } catch {
    return null;
  }
}

/**
 * The summary's text: the file with its metadata block taken off.
 * The block is the app's bookkeeping (hashes, the model, the
 * recipe), and a model reading it spends a row's room on it. It comes off
 * whenever the file opens with a block, valid or not: a hand-edited block
 * that fails to parse is still bookkeeping, never what happens in the
 * Section.
 */
export function summaryBody(raw: string): string {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const match = FRONTMATTER.exec(text);
  return match ? match[2].trim() : raw;
}

export function serializeSummary(
  metadata: SummaryMetadata,
  body: string,
): string {
  return `---\n${stringifyYaml(metadata, { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

/**
 * Current requires a parseable artifact, matching source hashes and an intact
 * body hash. Outdated means a known dependency changed. Anything that cannot
 * be checked (an unreadable artifact, a missing body hash, an unresolvable
 * source) is Unverified rather than assumed good.
 */
export async function summaryState(
  raw: string,
  current: ReadonlyMap<string, string>,
): Promise<SummaryState> {
  const summary = parseSummary(raw);
  if (!summary) return "unverified";
  return summaryFreshness(summary, current);
}
