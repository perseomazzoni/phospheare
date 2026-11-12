// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Assistant } from "../../ai";
import { presetFor, presetsFor } from "../../ai/domain/personas";
import type { PersonaDefinition } from "../../ai/domain/personaDefinition";
import type { ChatRecord, PersonaPreset } from "../../ai/domain/types";

/** The voice of the active chat, and its focus. */
export interface PersonaChoice {
  /** The selected voice; `undefined` is the persona-missing state. */
  selectedPersona: PersonaDefinition | undefined;
  /** What the selected voice offers in this room, and the one in force. */
  focus: { offered: PersonaPreset[]; current: PersonaPreset | undefined };
  /** Every voice, for the picker. */
  pickerPersonas: readonly PersonaDefinition[];
  /** Why each voice this chat cannot use is unavailable, by id. */
  unavailablePersonas: Map<string, string>;
  selectPersona: (personaId: string) => void;
  selectPreset: (presetId: string) => void;
}

/**
 * The voice the active chat speaks in: what is selected, what the picker
 * offers and why some voices are not offered here, and the focus the voice
 * has in this room.
 */
export function usePersonaChoice({
  assistant,
  active,
}: {
  assistant: Assistant | null | undefined;
  active: ChatRecord | null;
}): PersonaChoice {
  const { t } = useTranslation();
  const personas =
    active && assistant ? assistant.personasForKind(active.kind) : [];
  // The chip names what is selected. `undefined` is the persona-missing
  // state, which the refusal strip speaks to; the chip then says "No
  // persona" rather than going blank, so the button stays legible.
  const selectedPersona = personas.find(
    (one) => one.id === active?.preferences.personaId,
  );
  // What the picker shows: every voice, with the ones this chat cannot use
  // marked and explained rather than missing, because a missing voice reads
  // as broken. The reason names the chats the voice is for, in the new-chat
  // menu's chat-kind labels, so the writer learns where to find it.
  const pickerPersonas = assistant ? assistant.allPersonas() : [];
  // The selected voice's focus in this room: what it offers, and which one
  // is in force. `presetFor` answers, so a stored id the voice does not
  // offer shows the focus that answers.
  const focus = useMemo(() => {
    if (!active || !selectedPersona)
      return { offered: [] as PersonaPreset[], current: undefined };
    return {
      offered: presetsFor(selectedPersona, active.kind),
      current: presetFor(
        selectedPersona,
        active.kind,
        active.preferences.preset,
      ),
    };
  }, [active, selectedPersona]);
  const unavailablePersonas = new Map(
    pickerPersonas
      .filter((one) => !personas.some((offered) => offered.id === one.id))
      .map((one) => [
        one.id,
        t("dock.personaNotHere", {
          name: one.name,
          // A plain comma list after the colon: a label's list, not a
          // choice, and it reads the same in both locales.
          kinds: one.compatibleWith
            .map((kind) => t(`dock.chatKind.${kind}`))
            .join(", "),
        }),
      ]),
  );
  // A new voice starts on its own first focus: a preset id belongs to one
  // voice, and carrying it across would name nothing.
  const selectPersona = (personaId: string) =>
    void assistant?.chats.updatePreferences({ personaId, preset: undefined });
  const selectPreset = (preset: string) =>
    void assistant?.chats.updatePreferences({ preset });
  return {
    selectedPersona,
    focus,
    pickerPersonas,
    unavailablePersonas,
    selectPersona,
    selectPreset,
  };
}
