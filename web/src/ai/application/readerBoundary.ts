// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatRecord, SourceDescriptor } from "../domain/types";
import { readerExtras } from "../domain/sourceView";
import { allowedSourceIds, readerContamination } from "./context";
import type {
  AssistantDependencies,
  AssistantSnapshot,
} from "./assistantTypes";

/** What the reader boundary reads of the aggregate. */
export interface BoundaryHost {
  readonly dependencies: AssistantDependencies;
  publish(patch: Partial<AssistantSnapshot>): void;
  listCatalogue(): Promise<SourceDescriptor[]>;
}

/**
 * The reader boundary, checked wherever a run may begin: a reader chat
 * without a horizon is refused, and one whose history already saw
 * out-of-horizon material is refused before anything is sent. The refusal
 * is published here so every caller answers identically.
 */
export async function readerBoundary(
  host: BoundaryHost,
  chat: ChatRecord,
): Promise<
  | { ok: true; allowed: ReadonlySet<string>; catalog: SourceDescriptor[] }
  | { ok: false }
> {
  const catalog = await host.listCatalogue();
  const reader = chat.kind === "alpha-reader" || chat.kind === "beta-reader";
  let readerAllowed: ReadonlySet<string> | null = null;
  if (reader) {
    const scope = chat.preferences.readerScope;
    if (!scope) {
      host.publish({
        problem: { kind: "reader-horizon-missing" },
        error: null,
      });
      return { ok: false };
    }
    // The horizon the port allows, and the room's few extras beside it:
    // the alpha reader's intent, the beta reader's back cover (`rooms.ts`).
    // Only these: nothing a room reads may widen a reader, so the extras
    // are a list of their own and not the room's reads.
    readerAllowed = new Set([
      ...(await host.dependencies.sources.allowedReaderSources(scope)),
      ...readerExtras(chat.kind, catalog).map((source) => source.id),
    ]);
    const contaminated = readerContamination(
      chat,
      allowedSourceIds(catalog, readerAllowed),
    );
    if (contaminated.length > 0) {
      host.publish({
        problem: { kind: "reader-contaminated" },
        error: null,
      });
      return { ok: false };
    }
  }
  return {
    ok: true,
    allowed: allowedSourceIds(catalog, readerAllowed),
    catalog,
  };
}
