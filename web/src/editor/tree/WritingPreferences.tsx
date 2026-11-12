// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { FOCUS_LABEL, delayLabel, proseSizeLabel } from "../preferenceLabels";
import { useProjectActions, useProjectState } from "../ProjectContext";
import { useDismissOnPointerAway } from "../../ui/overlay/useDismissOnPointerAway";
import { useOverlay } from "../../ui/overlay/useOverlay";
import { useBackCloses } from "../../ui/overlay/useBackCloses";
import {
  AUTOSAVE_DELAY_PRESETS,
  PROSE_SIZES,
  type FocusMode,
  type ProseSize,
} from "../../project/types";
import {
  BUILT_IN_PREFS,
  loadGlobalEditorSettings,
  overrideOf,
  settingsOf,
  type ResolvedPrefs,
} from "../writingPreferences";
import { usePhone } from "../useNarrow";
import { APP_LANGUAGES } from "../../locales/languages";
import { setLanguage } from "../../locales/i18n";
import { Button, CommandBarTrack, Scrim, Tick, onScreen } from "../../ui";
import { appIcons } from "../../ui/appIcons";

/**
 * The settings card's width, in px. Fixed to fit the longest localized
 * labels rather than tracking the structure panel's width.
 */
const PREFS_CARD_W = 300;

/**
 * The writing preferences card the foot's gear opens: a popover over the
 * prose on the desktop, a bottom sheet on the phone.
 */
export default function WritingPreferences({
  open,
  onClose,
  gearRef,
  panelRef,
  sheet,
  rail,
}: {
  open: boolean;
  onClose: () => void;
  /** The gear: the card's anchor, and a press the card does not close on. */
  gearRef: React.RefObject<HTMLButtonElement | null>;
  /** The panel, made inert behind the phone's sheet. */
  panelRef: React.RefObject<HTMLElement | null>;
  /** The panel is the phone's sheet, so the card is portalled inside it. */
  sheet: boolean;
  /** The panel is folded to its rail, which moves the gear. */
  rail: boolean;
}) {
  const { t, i18n } = useTranslation();
  // The base tag only: `i18n.language` can carry a region ("en-GB") and the
  // picker's options are bare codes, so an unsplit value would select
  // nothing.
  const appLanguage = i18n.language.split("-")[0];
  const { props } = useProjectState();
  const { setPrefs, notify } = useProjectActions();
  // The plane decides what the settings are here, not only how they pack, so
  // it is read before the three hooks that serve the desktop popover.
  const phone = usePhone();
  const prefsRef = useRef<HTMLDivElement>(null);
  // Desktop only, all three of the popover's mechanisms: the phone's dialog
  // brings its own dismissal, its own layer and no anchor.
  useDismissOnPointerAway(
    open && !phone,
    [prefsRef.current, gearRef.current],
    onClose,
  );
  // On the layer stack as a `menu`: no focus trap (the gear keeps focus, and
  // this is a popover), but Escape reaches the innermost layer. A card off
  // the stack lets Escape fall through to the sheet, closing the settings and
  // the panel that opened them in one press.
  const { ref: prefsLayer } = useOverlay(open && !phone, {
    role: "menu",
    moveFocusIn: false,
    onClose,
  });
  // Back is the dismiss on Android, and the dialog is the second layer over
  // an open structure sheet: one history entry each, innermost first.
  useBackCloses(phone && open, onClose);

  // A popover over the prose, not a region of the panel: it must open on the
  // 52px rail too. Positioned by hand, right edge to the gear's right and
  // bottom edge just above the gear's top, clamped with `onScreen`, and
  // re-measured when the panel's width changes and on window resize, because
  // the gear moves with them.
  const [prefsPos, setPrefsPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  useEffect(() => {
    if (!open || phone) return;
    // Deferred through a double-rAF, as `EditorCore` defers its measure: the
    // panel's width change animates, and a gear rect read mid-reflow reflects
    // the old geometry.
    let frame = 0;
    const place = () => {
      const gear = gearRef.current;
      if (!gear) return;
      const rect = gear.getBoundingClientRect();
      const size = {
        width: Math.min(PREFS_CARD_W, window.innerWidth - 16),
        height: 0,
      };
      const at = onScreen(rect.right - size.width, 0, size);
      setPrefsPos({ left: at.left, bottom: window.innerHeight - rect.top + 8 });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(place);
      });
    };
    schedule();
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
    };
  }, [open, rail, phone, gearRef]);
  // The open project's own `ui` block resolved over the writer's global Editor
  // Settings (`writingPreferences`). Context state updates on every write, so
  // a changed setting repaints the panel and the prose in the same render.
  const settings = settingsOf(props, loadGlobalEditorSettings());
  // Where the panel's floating surfaces are portalled. On the desktop,
  // `<body>`: the panel's `backdrop-filter` makes it a containing block for
  // fixed positioning, so a card fixed inside it is cut off at its edge. As a
  // sheet, inside the panel: the sheet sits on a `z-index: 500` scrim and the
  // card is 120, so in `<body>` it would render behind the sheet. The sheet
  // is opaque and drops the `backdrop-filter`, so the containing-block
  // problem does not arise there.
  const portalHost = () => (sheet ? panelRef.current : null) ?? document.body;
  // The message names no subject ("Needs a wider screen"): the writer has
  // just pressed the control and read its label. The label still travels as
  // the toast's title, so the record says which setting was refused.
  const sayDesktopOnly = useCallback(
    (labelKey: string) => notify("desktopOnly", t(labelKey)),
    [notify, t],
  );
  // The writer's global Editor Settings, in their portable profile: the
  // defaults a project with no override inherits. Read once per mount, like
  // every other preference; a change in the app's Settings lands on the next
  // visit.
  const globals = useMemo(() => loadGlobalEditorSettings(), []);

  /**
   * Write a project setting as an override-or-inherit (`overrideOf`), and arm
   * the "for this project only" toast when it diverges. Every control on the
   * card goes through here, so no setting becomes project-only silently.
   *
   * `valueLabel` arrives translated. A boolean passes none and names its
   * toast instead, `settingOn` or `settingOff`, because "on" and "off" would
   * have to agree with the setting's gender in Italian.
   */
  const applyPref = useCallback(
    <K extends keyof ResolvedPrefs>(
      key: K,
      labelKey: string,
      next: ResolvedPrefs[K],
      valueLabel: string,
      code: "settingOverride" | "settingOn" | "settingOff" = "settingOverride",
    ) => {
      // The toast's test is the same resolved default `overrideOf` normalizes
      // against, so the two cannot disagree.
      const defaultFor = globals[key] ?? BUILT_IN_PREFS[key];
      setPrefs({ [key]: overrideOf(next, globals[key], BUILT_IN_PREFS[key]) });
      if (next !== defaultFor) notify(code, t(labelKey), valueLabel);
    },
    [globals, setPrefs, notify, t],
  );

  const togglePref = useCallback(
    (
      key: "typewriter" | "smoothCaret" | "autosave" | "henosis",
      labelKey: string,
      next: boolean,
    ) => applyPref(key, labelKey, next, "", next ? "settingOn" : "settingOff"),
    [applyPref],
  );

  // One set of controls, handed to one of two surfaces: a popover anchored to
  // the gear on the desktop, and below 720 a bottom sheet on the shared scrim,
  // since an anchored card would lie across the sheet and the manuscript.
  //
  // Each on/off preference is the kit's tick row, not a switch, so it is a
  // checkbox to a screen reader as to the eye.
  //
  // Typewriter and Focus are not honoured on the phone plane but stay,
  // showing what the writer chose, since the setting is in force on the
  // desktop for the same project file. Typewriter is locked with
  // `aria-disabled`, not `disabled`: a disabled button fires no click, and
  // pressing the locked control explains why it is off.
  const prefsBody = (
    <>
      <Tick
        checked={settings.typewriter}
        locked={phone}
        onLockedPress={() => sayDesktopOnly("tree.typewriter")}
        onToggle={() =>
          togglePref("typewriter", "tree.typewriter", !settings.typewriter)
        }
      >
        {t("tree.typewriter")}
      </Tick>
      {/* Focus combines freely with Typewriter: how much of the page
          recedes, versus where on the screen the writer writes. */}
      <div className="dt-size">
        <span>{t("tree.focus")}</span>
        <CommandBarTrack
          label={t("tree.focus")}
          cell={40}
          seat="sunk"
          value={settings.focus}
          unavailable={phone}
          onChange={(next) =>
            phone
              ? sayDesktopOnly("tree.focus")
              : applyPref(
                  "focus",
                  "tree.focus",
                  next as FocusMode,
                  t(FOCUS_LABEL[next as FocusMode]),
                )
          }
          options={[
            { value: "off", text: "—", label: t(FOCUS_LABEL.off) },
            { value: "line", text: "Ln", label: t(FOCUS_LABEL.line) },
            {
              value: "paragraph",
              text: "¶",
              label: t(FOCUS_LABEL.paragraph),
            },
          ]}
        />
      </div>
      <Tick
        checked={settings.smoothCaret}
        onToggle={() =>
          togglePref("smoothCaret", "tree.smoothCaret", !settings.smoothCaret)
        }
      >
        {t("tree.smoothCaret")}
      </Tick>
      {/* A phone browser discards a backgrounded tab without warning, so
          autosave must be as reachable off as on. The delay is a native
          `<select>`, because a custom popup would have to escape the card's
          clip and the platform's listbox cannot be cut. */}
      <Tick
        checked={settings.autosave}
        onToggle={() =>
          togglePref("autosave", "toolbar.autosave", !settings.autosave)
        }
      >
        {t("toolbar.autosave")}
      </Tick>
      {settings.autosave && (
        <div className="dt-pick">
          <span>{t("tree.autosaveEvery")}</span>
          <select
            className="dt-pick-select"
            aria-label={t("tree.autosaveEvery")}
            value={settings.autosaveDelay}
            onChange={(event) =>
              applyPref(
                "autosaveDelay",
                // "Autosave", not the row's "Autosave every": the toast reads
                // "{title} is {value} …", and "every" belongs to the value,
                // where it makes one grammatical phrase in English and in
                // Italian.
                "toolbar.autosave",
                Number(event.target.value),
                t("tree.autosaveEveryValue", {
                  value: delayLabel(Number(event.target.value), t),
                }),
              )
            }
          >
            {AUTOSAVE_DELAY_PRESETS.map((delay) => (
              <option key={delay} value={delay}>
                {delayLabel(delay, t)}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Henosis, the switch alone: its delay and fade length are set in
          Settings. Locked on the phone like Typewriter. */}
      <Tick
        checked={settings.henosis}
        locked={phone}
        onLockedPress={() => sayDesktopOnly("tree.henosis")}
        onToggle={() =>
          togglePref("henosis", "tree.henosis", !settings.henosis)
        }
      >
        {t("tree.henosis")}
      </Tick>
      {/* The measure stays 680px at every step; what changes is how much
          of it a line uses. Named rather than numbered, because a pixel
          size does not tell a writer whether the text looks big or
          small. */}
      <div className="dt-size">
        <span>{t("tree.proseSize")}</span>
        <CommandBarTrack
          label={t("tree.proseSize")}
          cell={46}
          seat="sunk"
          className="dt-size-steps"
          value={String(settings.proseSize)}
          onChange={(next) =>
            applyPref(
              "proseSize",
              "tree.proseSize",
              Number(next) as ProseSize,
              t(proseSizeLabel(Number(next) as ProseSize)),
            )
          }
          options={PROSE_SIZES.map((size) => ({
            value: String(size),
            icon:
              size === 17
                ? appIcons.textSmall
                : size === 19
                  ? appIcons.textMedium
                  : appIcons.textLarge,
            label: t(proseSizeLabel(size)),
          }))}
        />
      </div>

      {/* The app's language: a global with no per-project version, so it
          sits last, apart. It is here because the editor has no other route
          to it: the account face carries no menu, and below the 720 plane
          the titlebar is not drawn.

          The options are endonyms and are not translated: a writer stuck in
          a language they cannot read is looking for their own language's
          name. */}
      <div className="dt-pick dt-pick-apart">
        <span>{t("settings.language")}</span>
        <select
          className="dt-pick-select"
          aria-label={t("settings.language")}
          value={appLanguage}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {APP_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <>
      {/* On the phone: a bottom sheet on the shared scrim, mounted only
        while open, with focus trapped, the panel behind it inert, and four
        ways out that all mean closed: Done, Escape, the backdrop, and the
        platform's back gesture. Done rather than Cancel: every control
        applies when pressed, so there is nothing to take back. */}
      {phone && open && (
        <Scrim
          open
          dismissible
          onClose={onClose}
          label={t("tree.writingPreferences")}
          className="ui-dialog dt-prefs-sheet"
          // The structure sheet already made the shell inert, but the sheet
          // itself stands behind this dialog. `OverlayBackgroundProvider`
          // names only the shell, so a second layer names its own
          // background; otherwise the panel behind stays available to a
          // screen reader.
          inertTargets={() => (panelRef.current ? [panelRef.current] : [])}
        >
          <header className="ui-dialog-head">
            <h2 className="ui-dialog-title">{t("tree.writingPreferences")}</h2>
          </header>
          <div className="ui-dialog-body">{prefsBody}</div>
          <footer className="ui-dialog-foot">
            <Button variant="soft" onClick={onClose}>
              {t("confirm.done")}
            </Button>
          </footer>
        </Scrim>
      )}

      {/* Portalled out of the panel: the panel clips with `overflow:
        hidden` and its `backdrop-filter` makes it a containing block for
        fixed positioning. Mounted while shut, so closing is a morph rather
        than a disappearance. */}
      {!phone &&
        createPortal(
          <div
            className="dt-prefs"
            data-open={open ? "1" : "0"}
            ref={(node) => {
              prefsRef.current = node;
              prefsLayer(node);
            }}
            style={
              prefsPos
                ? {
                    left: `${prefsPos.left}px`,
                    bottom: `${prefsPos.bottom}px`,
                  }
                : undefined
            }
          >
            <div className="dt-prefs-inner">
              <div className="dt-prefs-pad">{prefsBody}</div>
            </div>
          </div>,
          portalHost(),
        )}
    </>
  );
}
