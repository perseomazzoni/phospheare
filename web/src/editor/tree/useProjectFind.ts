// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useProjectState, useWriteStamps } from "../ProjectContext";
import { searchProject, sourcesFor } from "../../project/search";
import type { DocumentStructure } from "../../project/types";
import { regexSearch } from "../engine";
import { useProjectBodies } from "../useProjectBodies";
import type { Assistant } from "../../ai";
import { indexText } from "../assistant/turnText";
import { FRAME_GEOMETRY } from "../../theme/editor";

/**
 * The structure panel's project find: whether it has the panel, the query
 * and its deferred twin, the index of the book's words, and the results.
 */
export function useProjectFind({
  structure,
  referenceFiles,
  assistant,
  placing,
  onEndFind,
}: {
  structure: DocumentStructure | null;
  referenceFiles: readonly string[];
  /** Brings the project's chats into the search as documents. */
  assistant: Assistant | null;
  /** A Move… holds the panel, so the find is suspended. */
  placing: boolean;
  /** The find is over, or its query moved: the prose's marks end. */
  onEndFind: () => void;
}) {
  const { ref: projectRef, provider } = useProjectState();
  const writes = useWriteStamps();
  const [query, setQuery] = useState("");
  // Whether the panel shows results rather than the tree is derived, never
  // stored and never cleared on the way into a placement, as `shownExpanded`
  // is. `placing` owns the panel while a node looks for somewhere to land:
  // every row is a destination, and `.dt-moving`'s Cancel is inside the tree
  // body, so a live query must not hide them. Deriving also keeps the typed
  // text for when the placement ends.
  //
  // A placement is entered only by a click, which blurs the field, so
  // `:focus-within` is false and `data-query` is "0": the field never claims
  // to filter a visibly unfiltered list.
  /**
   * The find has the panel, whether or not anything is typed in it yet.
   * Opening it starts the sweep, so the project is usually read by the first
   * keystroke. The read never leaves the machine.
   *
   * It survives blur: focus leaves the field when the writer reaches into the
   * results, and folding then would take the list away.
   */
  const [findOpen, setFindOpen] = useState(false);
  // The back control hands the caret back to the page; nothing else reaches
  // into the field.
  const findInput = useRef<HTMLInputElement>(null);
  // One way out of a find, shared by the back control and Escape:
  // clear the query, fold the face, end any arrival the query left in the
  // prose, and hand the caret back to the page. The blur is required:
  // `:focus-within` also opens the box, so a caret left in the field would
  // keep it a field over a tree it does not filter.
  const leaveFind = useCallback(() => {
    setQuery("");
    setFindOpen(false);
    onEndFind();
    findInput.current?.blur();
  }, [onEndFind]);
  const finding = !placing && (findOpen || query.trim() !== "");
  const searching = finding && query.trim() !== "";

  // The query the results are computed from, which may lag the field's: the
  // work is a regex over every file in the book. A debounce would make every
  // writer wait a fixed time; `useDeferredValue` costs a render only under
  // contention.
  const deferred = useDeferredValue(searching ? query : "");

  // The search session, the number `useProjectBodies` re-reads the book on:
  // 0 until the writer starts a search, and a new number for each search
  // after that.
  const session = useRef(0);
  const wasFinding = useRef(false);
  if (!wasFinding.current && finding) session.current += 1;
  wasFinding.current = finding;
  /**
   * Which quotation the writer opened, so the list marks the line they went
   * to rather than the group it was under.
   *
   * Panel state, because "which row is selected" is a question about this
   * list. The shell holds the arrival (file, query, ordinal), a different
   * fact that survives the panel collapsing.
   *
   * Dropped whenever the query moves, because the ordinals belong to the
   * list on screen when it was clicked; kept, the mark would land on
   * whichever line is at that ordinal under the new query. The open node is
   * checked at render, so opening another file un-marks it with no effect.
   */
  const [openedAt, setOpenedAt] = useState<{
    id: string;
    ordinal: number;
  } | null>(null);
  const lastQuery = useRef(deferred);
  if (lastQuery.current !== deferred) {
    lastQuery.current = deferred;
    if (openedAt) setOpenedAt(null);
  }

  // The field's onChange ends the arrival, but a result list can outlive its
  // query by a render, since `deferred` lags, and a click on the stale list
  // re-arrives with the old query. Once the list answers the new one, the
  // prose would stay lit for the old query under a count for the new one.
  // So a deferred move between two non-empty queries also ends the
  // arrival; the move to empty is the find face's own way out.
  const lastDeferred = useRef(deferred);
  useEffect(() => {
    const previous = lastDeferred.current;
    lastDeferred.current = deferred;
    if (
      previous !== deferred &&
      previous.trim() !== "" &&
      deferred.trim() !== ""
    ) {
      onEndFind();
    }
  }, [deferred, onEndFind]);

  // Built here and passed down, never inside the search: `project/` may not
  // import from `editor/` (the editor is the lazy half), and the engine's
  // port is the one authority on escaping, whole-word and hyphen-joining.
  // Memoized per query, as `FindPanel` does, to avoid a regex per keystroke.
  // Case-insensitive and not whole-word: this is recall, and the narrowing
  // toggles belong to the in-document find.
  const regex = useMemo(
    () =>
      regexSearch.buildRegex(deferred.trim(), {
        caseSensitive: false,
        wholeWord: false,
      }),
    [deferred],
  );

  // Which files the search reads: the book and the reference folder; chats
  // arrive from the Assistant as documents, never as files. `sourcesFor` owns
  // both the paths and the keys the results are looked up by, so no second
  // module spells the key format.
  const sources = useMemo(
    () => sourcesFor(structure, referenceFiles),
    [structure, referenceFiles],
  );

  /**
   * A file the search reads was written while the writer was looking at the
   * results, so the answer on screen is about a book that has moved.
   *
   * Every write is stamped by path and handed to the index, which re-reads
   * those files alone; the session, which re-reads the whole book, moves only
   * for a new search.
   *
   * Gated on the path, not on any write: the undo journal, the properties
   * file and the structure file go through the same port and are not prose,
   * and a journal flush would otherwise sweep per keystroke with autosave on.
   *
   * Held while nothing is typed: there is no answer on screen to be wrong.
   * The stamps are still kept, so every file written meanwhile is read when
   * the next query is typed, not only the last one.
   */
  const written = useRef<ReadonlyMap<string, number>>(new Map());
  if (
    sources.some(
      (source) => writes.get(source.path) !== written.current.get(source.path),
    )
  ) {
    const next = new Map<string, number>();
    for (const source of sources) {
      const stamp = writes.get(source.path);
      if (stamp !== undefined) next.set(source.path, stamp);
    }
    written.current = next;
  }

  // The index is lazy and outlives one search (`useProjectBodies`).
  const { bodies, reading } = useProjectBodies(
    projectRef,
    provider,
    sources,
    session.current,
    written.current,
    !searching,
  );

  // The chats are indexed only while there is a query: an answer's searchable
  // text costs a parse (`indexText`), and `structure` and `bodies`
  // move on every edit, when nothing is being found. `searchProject` finds
  // nothing in an empty query anyway.
  const results = useMemo(() => {
    const query = searching ? deferred : "";
    return searchProject({
      structure,
      referenceFiles,
      query,
      regex,
      bodies,
      chats:
        assistant && query.trim() ? assistant.searchDocuments(indexText) : [],
      window: FRAME_GEOMETRY.findExcerpt,
    });
  }, [
    structure,
    referenceFiles,
    deferred,
    searching,
    regex,
    bodies,
    assistant,
  ]);

  /**
   * The list on screen is not yet the answer to what is in the field.
   *
   * The sweep may still be running: the project is re-read on every search,
   * so a query matching no name has an empty result set nobody has
   * looked for yet. Or `results` may still answer the previous query, because
   * `deferred` lags the field by a render.
   *
   * Either way, nothing may state that the book holds no match. The drawn
   * sentence and the spoken count come from the same locale key, so a screen
   * reader never hears what the screen does not say, and both are withheld
   * together.
   *
   * The field's loader is gated on `reading` alone: a deferred value catching
   * up is one frame, and a loader for it would flicker on every keystroke.
   */
  const searchPending = reading || deferred !== (searching ? query : "");

  return {
    query,
    setQuery,
    setFindOpen,
    findInput,
    leaveFind,
    finding,
    searching,
    deferred,
    results,
    reading,
    searchPending,
    openedAt,
    setOpenedAt,
  };
}

/** What the project find gives the panel and its head. */
export type ProjectFind = ReturnType<typeof useProjectFind>;
