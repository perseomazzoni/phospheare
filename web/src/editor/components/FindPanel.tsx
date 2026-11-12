// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { CommandBarFind, Icon, Tip } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type { EditorEngine } from "../views/engine";
import { regexSearch, type Match } from "../engine";

// Find and replace in the bar. The field is the bar's trailing segment and
// morphs open in place; the other controls grow below it on the grid-rows
// morph, only while find is open.
//
// `segment` goes into the bar and `panel` under it, but both are this one
// component's state, so no second owner of the query has to agree with this
// one about focus.
//
// A query may hold a paragraph break: Shift+Enter in the field puts
// one in, and a pasted line break is one. A one-line field cannot show a line
// break, so it shows each as a pilcrow (`BREAK_GLYPH`) and the search reads
// it as the break. Only the panel's buttons walk the matches, so
// Enter and Shift+Enter in the field are the field's own.

/** How a paragraph break shows in a find or replace field. */
export const BREAK_GLYPH = "¶";

/** A field's text as the search reads it: each glyph a paragraph break. */
export function fieldToQuery(field: string): string {
  return field.split(BREAK_GLYPH).join("\n");
}

/** A query as a field shows it: each paragraph break a glyph. */
export function queryToField(query: string): string {
  return query.split("\n").join(BREAK_GLYPH);
}

/**
 * Pasted text as a field keeps it: line endings normalised, a run of blank
 * lines one break (prose copied with a blank line between paragraphs is one
 * paragraph break in the book), each break a glyph.
 */
export function pastedToField(text: string): string {
  return queryToField(
    text.replace(/\r\n?/g, "\n").replace(/\n(?:[ \t]*\n)+/g, "\n"),
  );
}

/** Put `glyphs` where the field's caret or selection is, and move past it. */
function insertInto(
  field: HTMLInputElement,
  glyphs: string,
  set: (value: string) => void,
) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  set(field.value.slice(0, start) + glyphs + field.value.slice(end));
  requestAnimationFrame(() =>
    field.setSelectionRange(start + glyphs.length, start + glyphs.length),
  );
}

export interface FindHandle {
  /** With a query, seeds the field with it and selects it. */
  open: (query?: string) => void;
  close: () => void;
  isOpen: () => boolean;
}

export interface FindPanelProps {
  engine: EditorEngine;
  onQueryChange: (query: string | null) => void;
  onResult: (matches: Match[], currentIndex: number) => void;
  onOptionsChange: (
    caseSensitive: boolean,
    wholeWord: boolean,
    hyphensJoinWords: boolean,
  ) => void;
  onOpenChange: (open: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  /**
   * The query a fresh mount starts with. The shell re-seeds the field after
   * the review modes unmount the panel, so the writer's query survives the
   * review mode and Ctrl+F reopens with it. A close inside the panel
   * still clears it. Only the first mount reads it; later changes are
   * ignored while the panel is alive.
   */
  initialQuery?: string;
  /**
   * The bar has no find segment (the phone bar), so the field heads the panel
   * and `segment` is null. The panel only opens from the palette there, so
   * the field is held open with it.
   */
  fieldInPanel?: boolean;
  /** Rendered by the caller: `segment` in the bar, `panel` beneath it. */
  children: (parts: {
    segment: React.ReactNode;
    panel: React.ReactNode;
  }) => React.ReactNode;
}

const FindPanel = forwardRef<FindHandle, FindPanelProps>(function FindPanel(
  {
    engine,
    initialQuery,
    fieldInPanel,
    onQueryChange,
    onResult,
    onOptionsChange,
    onOpenChange,
    onFocusChange,
    children,
  },
  ref,
) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const replaceField = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  // The field's text, glyphs and all; `searched` is what the search reads.
  const [query, setQuery] = useState(queryToField(initialQuery ?? ""));
  const searched = fieldToQuery(query);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [hyphensJoinWords, setHyphensJoinWords] = useState(false);
  const [plain, setPlain] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  const regex = useMemo(
    () =>
      regexSearch.buildRegex(searched, {
        caseSensitive,
        wholeWord,
        hyphensJoinWords,
      }),
    [searched, caseSensitive, wholeWord, hyphensJoinWords],
  );

  // The engine object never changes identity, so a replace re-runs this
  // shared scan explicitly.
  const runSearch = useCallback(
    () => regexSearch.searchDoc(engine.doc, regex),
    [engine, regex],
  );

  useEffect(() => {
    if (!open) return;
    const results = runSearch();
    setMatches(results);
    setCurrentIndex(results.length > 0 ? 0 : -1);
  }, [runSearch, open]);

  // The matches are offsets into the doc they were found in, so every change
  // to it, an edit or another file opened, finds them again. The walk keeps
  // its place where the new list still reaches it.
  useEffect(() => {
    if (!open) return;
    return engine.subscribe((reason) => {
      if (reason !== "doc") return;
      const results = runSearch();
      setMatches(results);
      setCurrentIndex((i) =>
        results.length === 0
          ? -1
          : Math.max(0, Math.min(i, results.length - 1)),
      );
    });
  }, [engine, runSearch, open]);

  useEffect(() => {
    onResult(matches, currentIndex);
  }, [matches, currentIndex, onResult]);
  useEffect(() => {
    onQueryChange(open ? searched : null);
  }, [searched, open, onQueryChange]);
  useEffect(() => {
    onOpenChange(open);
  }, [open, onOpenChange]);
  // The search dies with the panel. The shell unmounts the whole bar while
  // either review mode owns the screen, and the shell's mode-entry close
  // works through this component's handle, so without this report the marks
  // would stay painted over the merged document. A StrictMode double-run is
  // harmless: state survives, and the remount's effects re-report it.
  //
  // The unmount also reports the live query, which the shell re-seeds into
  // the next mount. It reads a ref, not `query`, because a
  // cleanup depending on `query` would fire on every keystroke. An empty
  // query reports nothing, the same as "closed": a closed search was
  // cleared, and stays cleared.
  const queryRef = useRef("");
  useEffect(() => {
    queryRef.current = searched;
  }, [searched]);
  useEffect(() => {
    return () => {
      onOpenChange(false);
      if (queryRef.current) onQueryChange(queryRef.current);
    };
  }, [onOpenChange, onQueryChange]);
  useEffect(() => {
    onOptionsChange(caseSensitive, wholeWord, hyphensJoinWords);
  }, [caseSensitive, wholeWord, hyphensJoinWords, onOptionsChange]);

  // The focus `show` asked for and the field has not taken yet: "select"
  // when a query was seeded, so the next keystroke can replace it.
  const focusOwed = useRef<"focus" | "select" | null>(null);
  // Bumped by `show`, so a search that is already open with this query
  // still commits and the debt is paid.
  const [, askFocus] = useState(0);
  const takeFocus = useCallback(() => {
    const field = input.current;
    if (!field || focusOwed.current === null) return;
    field.focus();
    // Refused while the panel is still hidden; owed until a commit shows it.
    if (document.activeElement !== field) return;
    if (focusOwed.current === "select") field.select();
    focusOwed.current = null;
  }, []);

  /**
   * @param query seeds the field — the selection bubble's "every one" hands
   *              over the writer's selection. Omitted, the field opens as it
   *              was.
   */
  const show = useCallback((query?: string) => {
    setOpen(true);
    if (query !== undefined) setQuery(queryToField(query));
    focusOwed.current = query === undefined ? "focus" : "select";
    askFocus((n) => n + 1);
  }, []);

  // Paid after the commit that opens the search, not a frame later. That
  // commit also closes the palette, whose teardown hands the focus back to
  // the prose, and keys typed before a late focus land there. A field in the
  // panel mounts with the panel, a render after `open`, so every commit
  // checks for the debt.
  useEffect(() => {
    takeFocus();
  });

  const hide = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCurrentIndex(0);
    input.current?.blur();
  }, []);

  useImperativeHandle(
    ref,
    () => ({ open: show, close: hide, isOpen: () => open }),
    [show, hide, open],
  );

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const handleReplace = useCallback(
    (advance: 1 | -1) => {
      if (matches.length === 0 || currentIndex < 0) return;
      engine.replaceCurrent(
        matches[currentIndex],
        fieldToQuery(replacement),
        plain,
        {
          query: searched,
          opts: { caseSensitive, wholeWord, hyphensJoinWords },
        },
      );
      const results = runSearch();
      if (results.length === 0) {
        setMatches(results);
        setCurrentIndex(-1);
        return;
      }
      const next =
        (Math.max(0, Math.min(currentIndex, results.length - 1)) +
          advance +
          results.length) %
        results.length;
      setMatches(results);
      setCurrentIndex(next);
    },
    [
      engine,
      matches,
      currentIndex,
      replacement,
      plain,
      searched,
      caseSensitive,
      wholeWord,
      hyphensJoinWords,
      runSearch,
    ],
  );

  const handleReplaceAll = useCallback(() => {
    if (!query || matches.length === 0) return;
    engine.replaceAll(
      searched,
      fieldToQuery(replacement),
      { caseSensitive, wholeWord, hyphensJoinWords },
      plain,
    );
    const results = runSearch();
    setMatches(results);
    setCurrentIndex(results.length > 0 ? 0 : -1);
  }, [
    engine,
    query,
    searched,
    replacement,
    caseSensitive,
    wholeWord,
    hyphensJoinWords,
    plain,
    runSearch,
    matches.length,
  ]);

  // Escape closes, scoped to the panel so it cannot fire while the writer
  // is in the prose. In either field Shift+Enter is a paragraph break, and
  // Enter in the replace field replaces. No key walks the matches; the
  // buttons do.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      }
      if (e.key !== "Enter") return;
      // `contains` takes a Node or null and throws on anything else, and an
      // event dispatched at the window has the window as its target, so the
      // guard keeps one throw from swallowing every Enter here.
      const target = e.target;
      const inReplace =
        target instanceof Node &&
        (replaceField.current?.contains(target) ?? false);
      const inQuery = input.current !== null && target === input.current;
      if (e.shiftKey && inQuery && input.current) {
        e.preventDefault();
        insertInto(input.current, BREAK_GLYPH, setQuery);
        return;
      }
      if (e.shiftKey && inReplace && replaceField.current) {
        e.preventDefault();
        insertInto(replaceField.current, BREAK_GLYPH, setReplacement);
        return;
      }
      if (inReplace) {
        e.preventDefault();
        handleReplace(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, hide, handleReplace]);

  // A pasted line break is a paragraph break, as the writer meant it: the
  // field would otherwise drop it and run the paragraphs together.
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!/[\r\n]/.test(text)) return;
      e.preventDefault();
      insertInto(field, pastedToField(text), (next) => {
        setQuery(next);
        setOpen(true);
      });
    };
    field.addEventListener("paste", onPaste);
    return () => field.removeEventListener("paste", onPaste);
  }, []);

  // A click on the writing surface while the field is open but empty
  // collapses the whole search, field and panel, so the panel never floats
  // under a folded button. The fold behaviour collapses the field (blur drops
  // the segment's `data-open`); this tells React the panel is done, so the
  // drop closes and the bar's lift relaxes. With a query in the field the
  // search stays: the writer has not asked to be done.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (query) return;
      const target = e.target;
      // The bar and its panels are the search itself; reaching for a control
      // there is not a click away from it.
      if (target instanceof Element && target.closest(".bar-stack")) return;
      hide();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, query, hide]);

  const canReplace = matches.length > 0;
  const count = query
    ? `${matches.length > 0 ? currentIndex + 1 : 0}/${matches.length}`
    : "";

  const segment = (
    <CommandBarFind
      label={t("toolbar.search")}
      placeholder={t("search.placeholder")}
      value={query}
      onChange={(next) => {
        setQuery(next);
        if (!open) setOpen(true);
      }}
      count={count}
      clearLabel={t("search.clear")}
      inputRef={input}
      onFocus={() => {
        setOpen(true);
        onFocusChange(true);
      }}
      onBlur={() => onFocusChange(false)}
      open={fieldInPanel ? open : undefined}
    />
  );

  const panel = (
    <div className="ed-card find-panel">
      {fieldInPanel && segment}
      <div className="find-row">
        <Toggle
          label={t("search.caseSensitive")}
          pressed={caseSensitive}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </Toggle>
        <Toggle
          label={t("search.wholeWord")}
          pressed={wholeWord}
          onClick={() => setWholeWord((v) => !v)}
        >
          <Icon name={appIcons.wholeWord} size={15} />
        </Toggle>
        <Toggle
          label={t("search.hyphensJoinWords")}
          pressed={hyphensJoinWords}
          onClick={() => setHyphensJoinWords((v) => !v)}
        >
          a&#8209;b
        </Toggle>

        <span className="ui-spacer" />

        <span className="find-count" aria-live="polite">
          {count}
        </span>

        <Toggle
          label={t("search.prev")}
          disabled={!canReplace}
          onClick={goPrev}
        >
          <Icon
            name={appIcons.expand}
            size={13}
            style={{ transform: "rotate(180deg)" }}
          />
        </Toggle>
        <Toggle
          label={t("search.next")}
          disabled={!canReplace}
          onClick={goNext}
        >
          <Icon name={appIcons.expand} size={13} />
        </Toggle>

        <Toggle label={t("search.close")} onClick={hide}>
          <Icon name={appIcons.close} size={13} />
        </Toggle>
      </div>

      <div className="find-row">
        <input
          ref={replaceField}
          type="text"
          placeholder={t("search.replacePlaceholder")}
          aria-label={t("search.replacePlaceholder")}
          value={replacement}
          disabled={!canReplace}
          spellCheck={false}
          onChange={(e) => setReplacement(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain");
            if (!/[\r\n]/.test(text)) return;
            e.preventDefault();
            insertInto(e.currentTarget, pastedToField(text), setReplacement);
          }}
        />
        <Toggle
          label={t("search.clearFormatting")}
          pressed={plain}
          onClick={() => setPlain((v) => !v)}
        >
          <Icon name={appIcons.normalText} size={14} />
        </Toggle>
        <button
          type="button"
          className="find-act"
          disabled={!canReplace}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleReplace(1)}
        >
          {t("search.replace")}
        </button>
        <button
          type="button"
          className="find-act"
          disabled={!canReplace}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleReplaceAll}
        >
          {t("search.replaceAll")}
        </button>
      </div>
    </div>
  );

  return <>{children({ segment: fieldInPanel ? null : segment, panel })}</>;
});

export default FindPanel;

/** A find control: pressed state, a tip, and it never takes the caret. */
function Toggle({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="find-tog"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-tip=""
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
      <Tip label={label} shortcut={shortcut} />
    </button>
  );
}
