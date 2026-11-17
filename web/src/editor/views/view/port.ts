// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The writing view port. A view renders the prose on its own
// `.editor-surface`, holds the caret where its scrolling strategy says to,
// and answers the shell through `WritingViewHandle`. The shell knows only
// this file and the registry, never a concrete view.
//
// Types only; `contract.test.ts` pins the contract.

import type { ReactNode } from "react";
import type { EditorEngine } from "../engine";

/** The prose sizes a view draws, in stored steps (`proseScale` maps them). */
export type ProseSize = 17 | 19 | 21;

/**
 * How much of the page recedes around the writing line. Independent of the
 * typewriter: each answers a different question, and the two combine freely.
 */
export type FocusMode = "off" | "line" | "paragraph";

/**
 * Puts rendered HTML into an element. It is the page's one way in for
 * markup, so the host hands it over with its own security policy.
 */
export type HtmlSink = (el: Element, html: string) => void;

/**
 * What the view needs of the page it is drawn on. The core imports nothing
 * outside itself, so the shell hands these in.
 */
export interface ViewHost {
  /** Whether the window is a phone's, which sets the chrome the caret clears. */
  phone: boolean;
  /** The height the on-screen keyboard hides along the bottom, in pixels. */
  keyboardInset: number;
  setHtml: HtmlSink;
  /**
   * The typewriter's station mark, drawn once on each side of the writing
   * line with the class the view gives it.
   */
  guideMark: (className: string) => ReactNode;
  /**
   * Hears an input the view does not handle, by its type only. The view
   * cannot log; the host may. Absent, nothing hears it.
   */
  unhandledInput?: (inputType: string, cancelable: boolean) => void;
}

/** What a find session asks the view to paint; mirrors the shell's state. */
export interface ViewSearchState {
  query: string | null;
  currentIndex: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  hyphensJoinWords: boolean;
  /**
   * Where the current match should sit once the view has scrolled to it.
   * "nearest" is the find bar's, so stepping through matches in a document
   * already being read does not jump the page. "center" is an arrival's from
   * the panel, into prose the writer has not seen yet.
   */
  scrollTo?: "nearest" | "center";
  /**
   * Which kind of mark the query paints. `search` (the default) marks every
   * occurrence and the current one brighter; `evidence` marks only the
   * current occurrence, as the passage the assistant pointed at.
   */
  mark?: "search" | "evidence";
}

/** What a selection asks the view to mark: the repetition highlights. */
export interface ViewSelectionState {
  text: string | null;
  exactText: string | null;
  showRepetitions: boolean;
}

export interface WritingViewProps {
  engine: EditorEngine;
  host: ViewHost;
  /** The writer's own prose size, used by the surface the view owns. */
  proseSize: ProseSize;
  /**
   * The pixels each stored step is drawn at, which the theme chooses. Absent,
   * a step is drawn at its own number.
   */
  proseScale?: Readonly<Record<ProseSize, number>>;
  /** Focus dimming does not depend on scrolling, so every view honours it. */
  focus: FocusMode;
  /** The caret's typing spring, which the project turns on. */
  smoothCaret: boolean;
  search: ViewSearchState;
  selection: ViewSelectionState;
  searchOpen: boolean;
  onClearHighlights?: () => void;
  /**
   * The marks beside the prose (the save gutter), drawn outside the editable
   * element. The view owns the surface, so it hands the gutter the scroller.
   */
  gutter?: (
    editor: HTMLElement | null,
    surface: HTMLElement | null,
  ) => ReactNode;
  /**
   * The Desk, standing in for prose when nothing is open: rendered by the
   * view inside its own surface, hidden by CSS (`data-desk`), never unmounted.
   */
  desk?: ReactNode;
  /**
   * The running head and folio: rendered inside the surface, before and after
   * the editable element and never inside it, so the three scroll together.
   */
  frame?: { head?: ReactNode; foot?: ReactNode };
}

export interface WritingViewHandle {
  /** The scroller the view holds the caret in; null before mount. */
  surface(): HTMLElement | null;
  /** The shell may ask the view to take the keyboard, as when find closes. */
  focus(): void;
}
