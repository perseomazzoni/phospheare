// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { allFamilies, allThemes } from "./application/registry";
import { choiceKey, parseChoice } from "./domain/choice";
import { account, choices, page } from "./compose";
import type { SchemeChoice, Theme, ThemeFamily } from "./domain/types";

const {
  currentChoice,
  firstChoice,
  forgetOnDevice,
  keepOnDevice,
  rememberChoice,
  resolveChoice,
} = choices;

// Which theme is on. This is the one place that puts a theme on the page
// after the first paint, because it is the one place that can change both
// the page and React's state in one move: a writer's choice, a change of
// account, a synced choice from another device, and the system's scheme
// under a choice that follows it all come through here.

interface ThemeState {
  /** The variant on the page. Its `family` is the theme the writer chose. */
  theme: Theme;
  /** The variant the writer chose, or `system` when it follows the system. */
  mode: SchemeChoice;
  /** Every variant, in registration order. */
  themes: Theme[];
  /** The themes a writer chooses between, each with its two variants. */
  families: ThemeFamily[];
  /** Put a choice on the page by id (`shine-dark`, `shine-system`). */
  setTheme: (id: string) => void;
  /** Change theme and keep the variant: still dark stays still dark. */
  setFamily: (family: string) => void;
  /** Change variant, or follow the system's, and keep the theme. */
  setScheme: (mode: SchemeChoice) => void;
  /**
   * Puts the stored choice on the page, as after a sync brought one from
   * another device, without writing it back.
   */
  followStored: () => void;
}

/** The variant on the page and the mode that put it there. */
interface Shown {
  theme: Theme;
  mode: SchemeChoice;
}

/**
 * The provider's two positions. `latest` is the latest choice, which moves
 * at once, so a theme and then its variant chosen in one tick compose;
 * `onPage` is what the page uses, which moves when a sheet has arrived and
 * the fade has taken its picture. They differ while a switch is in flight.
 * `shown` is what React shows, the fallback while the page uses nothing.
 */
interface Painter {
  latest: Shown;
  onPage: Shown | null;
  shown: Shown;
  setShown: (shown: Shown) => void;
}

function keyOf(shown: Shown): string {
  return choiceKey({ family: shown.theme.family, mode: shown.mode });
}

function same(a: Shown | null, b: Shown): boolean {
  return a !== null && a.theme.id === b.theme.id && a.mode === b.mode;
}

/** What a stored choice shows now, or `null` when it names no theme. */
function shownBy(choice: string): Shown | null {
  const theme = resolveChoice(choice);
  const parsed = parseChoice(choice);
  return theme && parsed ? { theme, mode: parsed.mode } : null;
}

/**
 * Makes `next` the latest choice and puts it on the page, once its sheet is
 * here, then runs `shown`. A choice made meanwhile wins. A sheet that cannot
 * be fetched leaves the page in the theme it wore, and the latest choice
 * with it.
 */
function putOn(next: Shown, painter: Painter, shown?: () => void): void {
  painter.latest = next;
  if (page.sheetLoaded(next.theme)) {
    show(next, painter, shown);
    return;
  }
  page.loadSheet(next.theme).then(
    () => {
      if (painter.latest === next) show(next, painter, shown);
    },
    () => {
      if (painter.latest === next)
        painter.latest = painter.onPage ?? painter.shown;
    },
  );
}

/**
 * Puts `next` on the page and in React's state together. Behind the switch's
 * fade, both land inside the fade's update, so the new picture the browser
 * fades to is the page and the state already agreeing. The fade runs its
 * update later, so a choice made before it does wins.
 */
function show(next: Shown, painter: Painter, shown?: () => void): void {
  const put = (inFade: boolean) => {
    if (painter.latest !== next) return;
    page.apply(next.theme);
    painter.onPage = next;
    painter.shown = next;
    keepOnDevice(keyOf(next));
    shown?.();
    if (inFade) flushSync(() => painter.setShown(next));
    else painter.setShown(next);
  };
  if (!page.fade(next.theme.id, () => put(true))) put(false);
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // `main.tsx` has already put this choice on the page before the first
  // paint, when its sheet arrived; reading the same source here makes state
  // and page agree from the start.
  const [shown, setShown] = useState<Shown>(() => {
    const first = shownBy(firstChoice());
    if (!first) throw new Error("the first choice names no theme");
    return first;
  });
  const { theme, mode } = shown;
  // One for the life of the provider: the callbacks below read it rather
  // than closing over the state, so they keep one identity and a consumer's
  // effect does not re-run on every repaint.
  const [painter] = useState<Painter>(() => ({
    latest: shown,
    onPage: page.isApplied(shown.theme) ? shown : null,
    shown,
    setShown,
  }));

  const choose = useCallback(
    (family: string, mode: SchemeChoice) => {
      const choice = choiceKey({ family, mode });
      const next = shownBy(choice);
      if (!next) return;
      // Kept once the page uses it: a theme whose sheet never arrives is
      // not a choice the writer's other devices should follow.
      putOn(next, painter, () => rememberChoice(choice));
    },
    [painter],
  );
  const setTheme = useCallback(
    (id: string) => {
      const parsed = parseChoice(id);
      if (parsed) choose(parsed.family, parsed.mode);
    },
    [choose],
  );
  const setFamily = useCallback(
    (family: string) => choose(family, painter.latest.mode),
    [choose, painter],
  );
  const setScheme = useCallback(
    (next: SchemeChoice) => choose(painter.latest.theme.family, next),
    [choose, painter],
  );

  // Not `choose`: re-deriving a choice is not making one, and writing it
  // back through `rememberChoice` would stamp a fresh timestamp on a
  // preference nobody touched, enough to win the next last-write-wins merge
  // against the device where the writer changed it. Choices are compared,
  // theme and mode, not the variants they resolve to: a choice that follows
  // the system and one fixed to the same variant are different choices.
  const followStored = useCallback(() => {
    const next = shownBy(currentChoice());
    if (!next) return;
    if (same(painter.latest, next) && same(painter.onPage, next)) return;
    putOn(next, painter);
  }, [painter]);

  // Signing in, out, or switching accounts changes whose stored choice
  // `currentChoice` resolves to: a signed-in writer's own theme replacing
  // the first paint's guess, or the app's default replacing a writer's theme
  // the moment they stop being the one looking at the page.
  useEffect(
    () =>
      account.onUserChange((userId) => {
        if (!userId) forgetOnDevice();
        followStored();
      }),
    [followStored],
  );

  // A choice that follows the system repaints when the system's scheme
  // changes, with the page open. The choice itself is unchanged, so nothing
  // is written back.
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (painter.latest.mode !== "system") return;
      const next = shownBy(keyOf(painter.latest));
      if (!next || next.theme.id === painter.latest.theme.id) return;
      putOn(next, painter);
    };
    query.addEventListener?.("change", follow);
    return () => query.removeEventListener?.("change", follow);
  }, [painter]);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      mode,
      themes: allThemes(),
      families: allFamilies(),
      setTheme,
      setFamily,
      setScheme,
      followStored,
    }),
    [theme, mode, setTheme, setFamily, setScheme, followStored],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** The theme state, or `null` outside a `ThemeProvider`. */
export function useThemeIfAny(): ThemeState | null {
  return useContext(ThemeContext);
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside a ThemeProvider");
  return ctx;
}
