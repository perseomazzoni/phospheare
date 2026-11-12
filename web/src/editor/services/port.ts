// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What the editor needs from the program around it: who is signed in, which
// models answer, how storage reconnects and what the sync queue holds. The
// route that mounts the editor supplies one set (`context.tsx`), so the
// editor never asks which program or route it runs in, and imports no
// account, sync or provider module.
//
// Members named `use…` are React hooks: the editor calls each one on every
// render, in a fixed order.

import type { ProjectRef } from "../../storage/types";
import type { ConnectionVerbs } from "../../storage/connections";
import type { ModelProvider, WebSearch } from "../../ai/ports";
import type { ModelRef } from "../../ai/domain/types";
import type { KeyVerdict } from "../assistant/keyVerdict";

/** A project's place, as the sync queue keys it. */
export type ProjectPlace = Pick<ProjectRef, "providerId" | "key">;

/** The signed-in writer as the titlebar draws them. */
export interface EditorFace {
  name: string | null;
  email: string;
  avatarUrl: string | null;
  /** False for the account without Google, which has no email to name. */
  withGoogle?: boolean;
}

/** What the Assistant answers with on this route. */
export interface AssistantWiring {
  /** Builds the model for one Assistant; called once per Assistant built. */
  createModel(): ModelProvider;
  /** The model every new chat starts on, when the route fixes one. */
  defaultModel?: ModelRef;
  /** The web search offered; absent means none. */
  webSearch?: WebSearch;
}

export interface EditorServices {
  /** Where the titlebar's way back leads. */
  readonly exit: "library" | "landing";
  /** The face the titlebar draws, or `null` for none. */
  useFace(): EditorFace | null;
  /**
   * The Assistant's wiring, or `null` when this route offers no Assistant.
   * The same object until the account it acts for changes, so an Assistant
   * built on it is not rebuilt by a re-read of that account.
   *
   * @param languageCode the open book's language, read per search.
   */
  useAssistantWiring(
    languageCode: () => string | undefined,
  ): AssistantWiring | null;
  /** The key verdicts the dock renders, by provider id. */
  useRemoteProviders():
    Record<string, KeyVerdict & { upstreamHost?: string }> | undefined;
  /**
   * Registers a writer that a sign-out runs before it leaves; returns the
   * unregistration.
   */
  holdOpenWork(write: () => Promise<unknown>): () => void;
  /** How a lapsed project's storage reconnects, or `null` for no verbs. */
  connectionFor(providerId: string): ConnectionVerbs | null;
  /** The project's paths that still owe the remote a change. */
  usePendingPaths(place: ProjectPlace | null): ReadonlySet<string>;
  /** The project's paths whose queued change was lost. */
  useLostPaths(place: ProjectPlace | null): ReadonlySet<string>;
  /** Whether `path` was opened from the remote while its put was owed. */
  readStale(place: ProjectPlace, path: string): boolean;
  /** Forgets a loss the editor repaired by saving its buffer. */
  forgetLostAt(place: ProjectPlace, path: string): Promise<void>;
  /**
   * Whether the last sync's pull into the project at `place` stopped
   * partway: files came down whose records did not.
   */
  pullUnfinished(place: ProjectPlace): Promise<boolean>;
}
