// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * The creation job's segments, in the order the work happens.
 *
 * The progress bar and the executor both read this array, so a new step is
 * one row here plus one `onStep(id)` emit at the write site.
 *
 * The labels say what is being made for the writer ("Setting up your
 * manuscript"), never a file name.
 */
export const CREATE_STEPS = [
  { id: "folder", labelKey: "create.progress.folder" },
  { id: "documents", labelKey: "create.progress.documents" },
  { id: "properties", labelKey: "create.progress.properties" },
  { id: "structure", labelKey: "create.progress.structure" },
  { id: "workspace", labelKey: "create.progress.workspace" },
  { id: "adopt", labelKey: "create.progress.adopt" },
] as const;

export type CreateStepId = (typeof CREATE_STEPS)[number]["id"];

/** The segment a step id occupies, which is the bar's `current`. */
export function createStepIndex(id: CreateStepId): number {
  return CREATE_STEPS.findIndex((step) => step.id === id);
}
