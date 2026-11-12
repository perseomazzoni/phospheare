// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { EvidenceTargets } from "../assistant/evidenceOpener";
import type { Doc, Match } from "../engine";
import {
  arrivalAfter,
  marksFor,
  type ArrivalEnd,
  type SearchArrival,
} from "../searchArrival";
import type { EditorEngine } from "../views/engine";
import type { WritingViewHandle } from "../views/view/port";

// The find's query and options, an arrival from the project search or from
// the assistant's evidence, and the marks the writing surface paints for
// them. The rules live in `searchArrival.ts`; this hook holds the state they
// read and the events that end an arrival.

export interface SearchArrivalOptions {
  engine: EditorEngine;
  viewRef: RefObject<WritingViewHandle | null>;
  activeFile: string | null;
  findOpen: boolean;
  /** Lends the evidence entry points to the AI composition root. */
  registerEvidence?: (targets: EvidenceTargets) => void;
  requestOpenReference: (fileName: string) => void;
}

export function useSearchArrival({
  engine,
  viewRef,
  activeFile,
  findOpen,
  registerEvidence,
  requestOpenReference,
}: SearchArrivalOptions) {
  // Search results, which the writing surface draws as marks.
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(0);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchHyphensJoinWords, setSearchHyphensJoinWords] = useState(false);

  // Arriving from a search result. The query travels, never an offset
  // (`searchArrival.ts`), and the surface finds the words again with the find
  // bar's scan over the open document. The arrival lasts while its file is
  // open, with no effect to clear it.
  const [arrival, setArrival] = useState<SearchArrival | null>(null);
  // Which occurrence of the arrival's query the writer stands on: the ordinal
  // of the row they clicked, since the panel lists every occurrence a Part or
  // Section holds.
  const [arrivalAt, setArrivalAt] = useState(0);
  // The one way an arrival starts, for both kinds, so they spell a file the
  // same way.
  const arrive = useCallback((next: SearchArrival, at: number) => {
    setArrival(next);
    setArrivalAt(at);
  }, []);
  const handleFindInText = useCallback(
    (file: string, query: string, at: number) =>
      arrive({ kind: "search", file, query }, at),
    [arrive],
  );
  // What the writer did that may end an evidence mark; `arrivalAfter` holds
  // the rule, and a search arrival survives all three.
  const endArrival = useCallback(
    (event: ArrivalEnd) => setArrival((now) => arrivalAfter(now, event)),
    [],
  );
  // The document an evidence arrival was painted over. The first edit is a
  // fact the engine owns, since its document is a new object after any
  // change, not a counter this component keeps that some edit path could
  // skip. A notification whose document is still this one (a selection move,
  // a save confirmation) is not an edit.
  const evidenceDoc = useRef<Doc | null>(null);
  /**
   * Ends the project search, and the marks it put in the prose: the field
   * emptied, the query moved, or the find left by its back control or
   * Escape.
   */
  const endFind = useCallback(() => setArrival(null), []);

  // The evidence entry points: this surface owns the arrival state and the
  // reference face, so it lends them to the AI composition root once. An
  // evidence arrival goes through the setter the project search uses
  // (`arriveAt`).
  useEffect(() => {
    registerEvidence?.({
      arrive: (file, passage, ordinal) => {
        evidenceDoc.current = engine.doc;
        arrive({ kind: "evidence", file, query: passage }, ordinal);
      },
      openDocument: (fileName) => requestOpenReference(fileName),
    });
  }, [registerEvidence, requestOpenReference, arrive, engine]);

  // Opening the find ends an evidence mark rather than hiding it: the find
  // wins while open (`marksFor`), and a mark returning when it closes would
  // be the assistant's claim reappearing unasked.
  useEffect(() => {
    if (findOpen) endArrival("find");
  }, [findOpen, endArrival]);

  // Escape in the page ends the mark. Only in the page: Escape in the chat
  // composer or a dialog belongs to them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const surface = viewRef.current?.surface();
      if (surface && e.target instanceof Node && surface.contains(e.target))
        endArrival("escape");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [endArrival, viewRef]);

  // The first edit after an evidence arrival ends it. Its own subscription,
  // keyed only on the engine, so no notify is lost to a re-subscribe.
  useEffect(
    () =>
      engine.subscribe((reason) => {
        if (
          evidenceDoc.current !== null &&
          reason !== "selection" &&
          engine.doc !== evidenceDoc.current
        ) {
          evidenceDoc.current = null;
          endArrival("edit");
        }
      }),
    [engine, endArrival],
  );

  const marks = marksFor(
    {
      open: findOpen,
      query: searchQuery,
      currentIndex: searchCurrentIndex,
      caseSensitive: searchCaseSensitive,
      wholeWord: searchWholeWord,
      hyphensJoinWords: searchHyphensJoinWords,
    },
    arrival,
    activeFile,
    arrivalAt,
  );

  const handleSearchResult = useCallback((_matches: Match[], index: number) => {
    setSearchCurrentIndex(index);
  }, []);

  const handleSearchOptionsChange = useCallback(
    (caseSensitive: boolean, wholeWord: boolean, hyphensJoinWords: boolean) => {
      setSearchCaseSensitive(caseSensitive);
      setSearchWholeWord(wholeWord);
      setSearchHyphensJoinWords(hyphensJoinWords);
    },
    [],
  );

  return {
    arrival,
    handleFindInText,
    endFind,
    marks,
    searchQuery,
    setSearchQuery,
    handleSearchResult,
    handleSearchOptionsChange,
  };
}
