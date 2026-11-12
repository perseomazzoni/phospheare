// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Icon, Scrim } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type { PersonaDefinition, PersonaPreset } from "../../ai/domain/types";

// Choosing the voice: a list of personas and one description under it, since
// a persona's name alone says nothing to a writer who has not learned it. One
// description, not one per row: the writer is picking a voice, not reading
// about every voice. The box follows the pointer and the keyboard alike, so
// it is a separate `aria-live` region rather than an `aria-describedby` on
// each button, which would make a screen reader say the same words twice as
// the paragraph changes to match focus.
//
// At rest it shows the selected persona's description, because "which voice
// am I using" is the question most writers open this to answer, and an empty
// box that fills only on hover teaches nothing on arrival.
//
// It has one button, OK. Nothing is committed by it, since a choice lands the
// moment it is made, but a writer who changed only the voice or only the
// focus needs a visible way to say they are done. Escape and the scrim close
// it too.
//
// The focus is the selected voice's: a voice works with a few named presets
// (Nova reads line by line, or the dialogue, or the continuity), and the
// writer picks one, never a trait. They are listed for the voice already
// chosen, not the one under the pointer, because a list that changed as the
// pointer travelled down to it would change under the pointer, and a keyboard
// reaches it only after leaving every row. One focus is no choice, so none is
// drawn.
//
// Voice and focus are chosen in one visit. A voice picked here arrives on its
// first focus, and the dialog stays open while that voice has a focus to
// choose, moving the keyboard to the focus in force. It closes by itself only
// when nothing is left to choose: a voice with no focus to offer, or a focus
// picked after a voice in the same visit. A focus picked alone stays open,
// ticked, for OK, since the writer may be comparing the hints. It waits for
// the chat to reflect the voice (`selectedId` catching up) before deciding,
// because the list of focuses arrives with the chosen voice; a save that
// never lands leaves the dialog open on the voice still in force.
//
// It takes no `Assistant`: a pure picker over a list is the cheapest surface
// to test, and has no way to reach the model, the disk or the account.

export interface AiPersonaDialogProps {
  open: boolean;
  onClose: () => void;
  personas: readonly PersonaDefinition[];
  /** The chat's current `preferences.personaId`. */
  selectedId: string;
  onSelect: (personaId: string) => void;
  /**
   * Personas that exist but this chat cannot use, each with the reason in
   * the writer's words. They are listed, dimmed and inert, rather than left
   * out: a voice that vanishes when the chat changes kind reads as a voice
   * that broke.
   */
  unavailable?: ReadonlyMap<string, string>;
  /** The selected voice's presets in this room, in file order. */
  presets?: readonly PersonaPreset[];
  /** The chat's `preferences.preset`, resolved: the one in force. */
  selectedPresetId?: string;
  onSelectPreset?: (presetId: string) => void;
}

export default function AiPersonaDialog({
  open,
  onClose,
  personas,
  selectedId,
  onSelect,
  unavailable,
  presets = [],
  selectedPresetId,
  onSelectPreset,
}: AiPersonaDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const focusId = useId();
  // The row focus lands on when the dialog opens: the selected one. The
  // overlay moves focus inside on open and `onFocus` drives the card, so the
  // first focusable would open the card on whichever voice sorts first while
  // the tick sits elsewhere.
  const selectedRow = useRef<HTMLButtonElement | null>(null);
  // The id under the pointer or under focus. `null` means neither, and the
  // description falls back to the selection.
  const [shown, setShown] = useState<string | null>(null);
  // The voice just picked, until the chat reflects it and the dialog can
  // tell whether a focus is left to choose.
  const [picked, setPicked] = useState<string | null>(null);
  // A voice was chosen in this visit, so a focus picked now completes it.
  const [voiceChosen, setVoiceChosen] = useState(false);
  const focusRow = useRef<HTMLButtonElement | null>(null);
  const offersFocus = presets.length > 1 && onSelectPreset !== undefined;
  useEffect(() => {
    if (picked === null || picked !== selectedId) return;
    setPicked(null);
    if (offersFocus) {
      setVoiceChosen(true);
      focusRow.current?.focus();
    } else onClose();
  }, [picked, selectedId, offersFocus, onClose]);
  // The component outlives a close (the panel keeps it mounted), so a visit's
  // memory is dropped with the visit.
  useEffect(() => {
    if (!open) {
      setVoiceChosen(false);
      setPicked(null);
    }
  }, [open]);
  if (!open) return null;

  const described =
    personas.find((one) => one.id === (shown ?? selectedId)) ?? null;
  const whyNot = described ? (unavailable?.get(described.id) ?? null) : null;

  return (
    <Scrim
      open
      dismissible
      onClose={onClose}
      labelledBy={titleId}
      initialFocus={() => selectedRow.current}
      className="ui-dialog ai-persona-dialog"
    >
      <header className="ui-dialog-head">
        <h2 id={titleId} className="ui-dialog-title">
          {t("dock.persona")}
        </h2>
      </header>

      {/* An ID card: the face at the left, at a legible size, and the
          identity beside it. The portrait follows the same state as the
          description (the row under the pointer or under focus, falling back
          to the selection), so the writer never reads one voice's paragraph
          beside another's face. One face at 128px, not one per row: a face
          repeated down a list at 18px is a column of coloured dots. */}
      <div
        className="ui-dialog-body ai-persona-card"
        data-faced={described ? "1" : "0"}
        // Room for a reason is held in the stylesheet whenever any voice here
        // can carry one, so the card does not grow under the pointer.
        data-reasons={unavailable?.size ? "1" : undefined}
      >
        {/* Gated on there being a voice to show. An `<img>` with no `src` is
            a broken-image glyph, and the one state that reaches this is a
            folder with no persona at all, which the list says in words. */}
        {described ? (
          <img
            className="ai-face ai-persona-portrait"
            // In black and white while it shows a voice this chat cannot
            // use, so the card says "not here" before the words do.
            data-unavailable={whyNot ? "1" : undefined}
            src={described.avatar}
            alt=""
            width={128}
            height={128}
            draggable={false}
          />
        ) : null}
        {/* The pointer hands the card back on leaving the list, not a row:
            the gap between two rows has nothing hovered, and a per-row
            handback would flash the selected face on every step down the
            list. In the gap the last row pointed at stays. */}
        <ul className="ai-persona-list" onMouseLeave={() => setShown(null)}>
          {personas.map((persona) => {
            const blocked = unavailable?.has(persona.id) ?? false;
            return (
              <li key={persona.id}>
                <button
                  type="button"
                  className="ui-row ai-persona-option"
                  ref={persona.id === selectedId ? selectedRow : undefined}
                  aria-pressed={persona.id === selectedId}
                  // `aria-disabled`, not `disabled`: a disabled button takes no
                  // focus and fires no hover, and the reason is read by
                  // focusing or pointing at the row. The click handler
                  // refuses instead.
                  aria-disabled={blocked || undefined}
                  onMouseEnter={() => setShown(persona.id)}
                  onFocus={() => setShown(persona.id)}
                  onBlur={() => setShown(null)}
                  onClick={() => {
                    if (blocked) return;
                    setPicked(persona.id);
                    onSelect(persona.id);
                  }}
                >
                  <span className="ui-row-text ai-persona-name">
                    {persona.name}
                  </span>
                  {blocked ? (
                    <span className="ui-row-note ai-persona-state">
                      {t("dock.personaUnavailable")}
                    </span>
                  ) : null}
                  {/* The tick is the state, the kit row's mark that the chats
                    list and the model menu use, and the name stays in ink so
                    colour never carries the state alone. At the end of the
                    row, so the names make one hard left edge rather than
                    following a column of glyphs empty in all but one line. */}
                  <span
                    className="ui-row-tick ai-persona-mark"
                    aria-hidden="true"
                  >
                    {persona.id === selectedId ? (
                      <Icon name={appIcons.confirm} size={11} />
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
          {personas.length === 0 ? (
            <li className="dock-hint">{t("dock.noPersona")}</li>
          ) : null}
        </ul>
        <p className="ai-persona-description" aria-live="polite">
          {/* In the writer's language, because the file's description is
              English and would stand under Italian presets. A persona the
              locale does not know keeps its file's words. */}
          {described
            ? t(`dock.personaAbout.${described.id}`, {
                defaultValue: described.description,
              })
            : ""}
          {whyNot ? <span className="ai-persona-why">{whyNot}</span> : null}
        </p>
        {offersFocus ? (
          <div
            className="ai-persona-focus"
            role="group"
            aria-labelledby={focusId}
          >
            <h3 id={focusId} className="ai-persona-focus-label">
              {t("dock.focus")}
            </h3>
            <ul className="ai-persona-list">
              {presets.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    className="ui-row ai-persona-option"
                    ref={preset.id === selectedPresetId ? focusRow : undefined}
                    aria-pressed={preset.id === selectedPresetId}
                    onClick={() => {
                      onSelectPreset?.(preset.id);
                      if (voiceChosen) onClose();
                    }}
                  >
                    <span className="ui-row-text ai-persona-name">
                      {t(`dock.preset.${preset.id}.name`)}
                      <span className="ai-preset-hint">
                        {t(`dock.preset.${preset.id}.hint`)}
                      </span>
                    </span>
                    <span
                      className="ui-row-tick ai-persona-mark"
                      aria-hidden="true"
                    >
                      {preset.id === selectedPresetId ? (
                        <Icon name={appIcons.confirm} size={11} />
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <footer className="ui-dialog-foot">
        <Button variant="soft" onClick={onClose}>
          {t("dock.personaOk")}
        </Button>
      </footer>
    </Scrim>
  );
}
