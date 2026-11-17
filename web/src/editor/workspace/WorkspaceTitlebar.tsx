// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { appIcons } from "../../ui/appIcons";
import type { DocNode } from "../../project/types";
import { Avatar, Icon, Kbd, Tip } from "../../ui";
import { IconPage } from "../tree/TreeRow";

/** The open node as the structure panel marks it: its kind, and its number. */
export interface OpenMark {
  kind: DocNode["kind"];
  number: number | null;
}

export interface WorkspaceTitlebarProps {
  /** The way back leads home (the demo), not to the Library. */
  home: boolean;
  /** The way back's one label: its aria-label, its tooltip and the nudge. */
  backLabel: string;
  /** The open project's name, or null with none open. */
  projectName: string | null;
  onGoToDesk?: () => void;
  /** The name the writer gave the open node, or null on the Desk. */
  openTitle: string | null;
  openMark?: OpenMark | null;
  onShortcuts: () => void;
  onPalette: (live: "board" | "field") => void;
  /** Who is signed in, or null with nobody (the demo, a harness). */
  user?: {
    name: string | null;
    email: string;
    avatarUrl: string | null;
    withGoogle?: boolean;
  } | null;
}

/** The shell's titlebar: the way back, the crumb, and the right cluster. */
export function WorkspaceTitlebar({
  home,
  backLabel,
  projectName,
  onGoToDesk,
  openTitle,
  openMark,
  onShortcuts,
  onPalette,
  user,
}: WorkspaceTitlebarProps) {
  const { t } = useTranslation();
  const { returnNudge, returnNudgeIn } = useReturnNudge();
  const right = useRef<HTMLDivElement>(null);
  usePublishedRightRoom(right);
  return (
    <div className="titlebar">
      {/* The frost's veil (`editor.css`): a copy of the ground
        that fades prose passing under the titlebar and shows nothing
        over an empty page, one band across the titlebar. */}
      <span className="titlebar-veil" aria-hidden="true" />
      {/* The way back: the arrow and the wordmark are one button at the
        window's left edge, where the eye lands first. The router's
        leaving guard stands in front of it like every other exit, so a
        dirty buffer asks before the project closes. */}
      <Link
        to={home ? "/" : "/app"}
        viewTransition
        className="titlebar-return"
        data-nudge={returnNudgeIn ? "1" : "0"}
        aria-label={backLabel}
        title={backLabel}
      >
        <Icon
          name={home ? appIcons.backToLibrary : appIcons.backToLibraryBare}
          size={14}
        />
        <span>{home ? backLabel : t("titlebar.back")}</span>
      </Link>
      {returnNudge && (
        <span
          className="titlebar-return-nudge"
          data-on={returnNudgeIn ? "1" : "0"}
          aria-hidden="true"
        >
          {backLabel}
        </span>
      )}
      <div className="titlebar-meta">
        {projectName !== null && (
          <>
            <span className="titlebar-sep">/</span>
            {/* The crumb's middle step goes to the Desk, the view of
              the whole project its name stands for: the crumb reads as
              a path, library / project / file, and every segment of it
              goes somewhere. */}
            <button
              type="button"
              className="titlebar-project"
              title={t("titlebar.toDesk")}
              onClick={() => onGoToDesk?.()}
            >
              {projectName}
            </button>
          </>
        )}
        {openTitle && (
          <>
            <span className="titlebar-sep">/</span>
            <span className="titlebar-file">
              {openMark?.kind === "section" && <IconPage />}
              {openMark?.number != null && (
                <span className="titlebar-idx">
                  {String(openMark.number).padStart(2, "0")}
                </span>
              )}
              <span className="titlebar-name">{openTitle}</span>
            </span>
          </>
        )}
      </div>

      {/* ── The right cluster ───────────────────────────────────────────
        The palette button gives Ctrl/Cmd+K a visible way in: the
        shortcut sheet that teaches keystrokes opens on `?` alone, so
        without it the commands are reachable only by knowing one. It
        carries its shortcut on its face, as the Library's `.app-find`
        does. A palette glyph rather than a magnifier, because it runs
        commands rather than searching. */}
      <div className="titlebar-right" ref={right}>
        {/* The pointer route to the shortcut sheet, which `?` and
            Ctrl+/ open from the keyboard. */}
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-sm ui-btn-square ed-keys"
          aria-label={t("shortcuts.title")}
          data-tip=""
          onClick={onShortcuts}
        >
          <Icon name={appIcons.shortcuts} size={15} />
          <Tip label={t("shortcuts.title")} shortcut="Ctrl+/" />
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-sm ed-palette"
          aria-label={t("titlebar.palette")}
          // A fine pointer opens with the field live, since a palette
          // is "open it, start typing" and no on-screen keyboard
          // competes for room. A coarse one keeps the board live: the
          // field would raise the keyboard over the board it was opened
          // to reach.
          onClick={() =>
            onPalette(
              // A missing `matchMedia` reads as a fine pointer, the
              // same call `useNarrow.ts` makes when it cannot ask.
              typeof window.matchMedia === "function" &&
                window.matchMedia("(pointer: coarse)").matches
                ? "board"
                : "field",
            )
          }
        >
          <Icon
            className="ed-palette-glyph"
            name={appIcons.palette}
            size={14}
          />
          <span className="ed-palette-name">{t("titlebar.palette")}</span>{" "}
          <Kbd>Ctrl K</Kbd>
        </button>

        {/* No account, no face: the demo route has nobody signed in,
          and a placeholder avatar would claim a session that does not
          exist. */}
        {user && (
          /* `role="img"` with a label: the account is real information,
             and the three faces `Avatar` can show (picture, initial,
             glyph) all picture the same fact. Nothing about it is
             pressable. */
          <span
            className="ed-account"
            role="img"
            aria-label={
              user.withGoogle !== false
                ? t("library.accountFor", { email: user.email })
                : t("library.accountWithoutGoogle")
            }
          >
            <Avatar name={user.name} avatarUrl={user.avatarUrl} />
          </span>
        )}
      </div>
    </div>
  );
}

// The first visit of a session teaches the way back: the back control glows
// and a caption names it, then both stay quiet. The flag lives in
// `sessionStorage`, not the prefs store, because it belongs to this visit.
// The key is neutral, like everything in browser storage.
const NUDGE_KEY = "backNudge";
/** How long the caption and glow stay before fading, in milliseconds. */
const NUDGE_MS = 3600;

/**
 * The way back's nudge. `returnNudge` mounts the caption; `returnNudgeIn`
 * flips a macrotask later so the fade has a starting frame. Both are
 * transitions rather than animations: a transition still reaches its end
 * state under reduced motion, and the motion gate accepts token durations.
 */
function useReturnNudge() {
  const [returnNudge, setReturnNudge] = useState(false);
  const [returnNudgeIn, setReturnNudgeIn] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem(NUDGE_KEY)) return;
    sessionStorage.setItem(NUDGE_KEY, "1");
    setReturnNudge(true);
    const inTimer = setTimeout(() => setReturnNudgeIn(true), 0);
    const outTimer = setTimeout(() => setReturnNudgeIn(false), NUDGE_MS);
    return () => {
      clearTimeout(inTimer);
      clearTimeout(outTimer);
    };
  }, []);
  return { returnNudge, returnNudgeIn };
}

/**
 * Publishes `--titlebar-right` on the root element: the room the right
 * cluster takes from the window's right edge. The status notices, rendered
 * outside the shell like the toast that reads `--kb`, keep their width
 * inside it (`.status-notices`, `base.css`), so a notice centred in the
 * titlebar never lies over the cluster's buttons. The cluster's width
 * changes with the language, the account face, the theme and the pointer,
 * so it is measured, not written down.
 */
function usePublishedRightRoom(cluster: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = cluster.current;
    if (!element) return;
    const root = document.documentElement;
    const publish = () => {
      const room = window.innerWidth - element.getBoundingClientRect().left;
      root.style.setProperty(
        "--titlebar-right",
        `${Math.max(0, Math.ceil(room))}px`,
      );
    };
    publish();
    const watch =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(publish);
    watch?.observe(element);
    window.addEventListener("resize", publish);
    return () => {
      watch?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--titlebar-right");
    };
  }, [cluster]);
}
