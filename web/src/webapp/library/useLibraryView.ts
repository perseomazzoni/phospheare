// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useMemo, useState } from "react";
import { getPref, setPref } from "../../profile/profileSync";
import { shown, type SourceFilter } from "./libraryFilter";
import { sourceCounts, type ProjectCard as Card } from "./useProjects";

export type Density = "grid" | "list";

/**
 * The shelf's own view state (search, source, density) and what derives from
 * it. What a query or filter does to the list lives in `libraryFilter.ts`,
 * where it is tested; this hook holds the controls and their prefs.
 */
export function useLibraryView(cards: Card[]) {
  const [query, setQuery] = useState("");

  // Grid or list and the source filter go through the account's profile:
  // read from local storage at once for first paint, written back and
  // delivered to the profile on every change.
  const [filter, setFilterState] = useState<SourceFilter>(() =>
    getPref("filter", "all"),
  );
  const [density, setDensityState] = useState<Density>(() =>
    getPref("density", "grid"),
  );
  const setFilter = useCallback((value: SourceFilter) => {
    setFilterState(value);
    setPref("filter", value);
  }, []);
  const setDensity = useCallback((value: Density) => {
    setDensityState(value);
    setPref("density", value);
  }, []);

  /**
   * Re-reads the view prefs into state once the profile pull has settled, so
   * a first sync on this device matches the rest of the account.
   */
  const reconcile = useCallback(() => {
    setFilterState(getPref("filter", "all"));
    setDensityState(getPref("density", "grid"));
  }, []);

  const counts = useMemo(() => sourceCounts(cards), [cards]);

  // Do not snap the filter back to All when one store is left: a store is a
  // place, and a place with nothing in it is an answer, which `emptyState.ts`
  // draws.

  // `shown()` needs items shaped like `Listing`, but a card's fields sit
  // under `ref` and `content`. Each card is wrapped, not cloned, so
  // `shown()`'s filter and sort carry the original `card` reference through,
  // and unwrapping hands `ProjectCard`'s memo the same object for every
  // unchanged card.
  const visible = useMemo(
    () =>
      shown(
        cards.map((card) => ({
          providerId: card.ref.providerId,
          name: card.ref.name,
          title: card.content?.title ?? null,
          editedAt: card.content?.updatedAt ?? "",
          card,
        })),
        query,
        filter,
      ).map((wrapped) => wrapped.card),
    [cards, query, filter],
  );

  const filtering = query.trim().length > 0 || filter !== "all";

  return {
    query,
    setQuery,
    filter,
    setFilter,
    density,
    setDensity,
    reconcile,
    counts,
    visible,
    filtering,
  };
}
