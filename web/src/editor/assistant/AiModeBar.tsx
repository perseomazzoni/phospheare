// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, Slider, useMenuAnchor } from "../../ui";
import {
  DEFAULT_MODE,
  MODE_STEP,
  chatMode,
  effortFor,
  modePosition,
  samplingFor,
} from "../../ai/domain/mode";
import type { ChatPreferences, ModelDescriptor } from "../../ai/domain/types";

// The Mode bar: one slider under the composer, with creative writing and
// brainstorming at the left end and standard, routine tasks at the right.
// Every position asks for a temperature and a reasoning effort
// (`ai/domain/mode.ts`).
//
// It sits on its own row, small and leading-aligned, because at the 340px
// dock floor the chat bar already holds the readings and the model button.
// "Mode" is the slider's accessible name and is not drawn; the numbers show
// over the thumb only while it is held or keyboard-focused. The rail is
// always full, a violet-to-blue fade that turns solid at the end the thumb
// sits on, because the two ends are two ways of working, not less and more.
//
// Each caption opens a small panel with that end's full name and goal. A
// caption never moves the thumb; the track is where the choice is made.
//
// The effort shown is the one the chat's model is sent: a place on that
// model's own scale, so one position can read "high" on one model and
// "medium" on another. With no model described yet, or one that
// names no efforts, the readout is the temperature alone.

type End = "creative" | "standard";

/** One end's caption, and the panel it opens. */
function ModeEnd({ end, near }: { end: End; near: boolean }) {
  const { t } = useTranslation();
  const menu = useMenuAnchor();
  return (
    <>
      <button
        type="button"
        className={`ai-mode-end${near ? " is-near" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={menu.open}
        onClick={(event) => menu.toggle(event.currentTarget)}
      >
        {t(`dock.mode.${end}`)}
      </button>
      <Popover
        open={menu.open}
        onClose={menu.close}
        anchor={menu.anchor}
        placement={end === "creative" ? "above-start" : "above-end"}
        label={t(`dock.mode.${end}Title`)}
        className="ai-reading-panel ai-mode-panel"
      >
        <strong>{t(`dock.mode.${end}Title`)}</strong>
        <p>{t(`dock.mode.${end}Goal`)}</p>
      </Popover>
    </>
  );
}

export default function AiModeBar({
  preferences,
  model,
  onCommit,
}: {
  preferences: Pick<ChatPreferences, "mode">;
  /** The chat's model as described, or null while it is not known. */
  model: Pick<ModelDescriptor, "capabilities"> | null;
  /** Once per gesture, with the position as it should be stored. */
  onCommit: (mode: number) => void;
}) {
  const { t, i18n } = useTranslation();
  // The thumb while it is held; `null` at rest, when the chat's stored
  // position is the truth, so a chat switched mid-drag never shows another
  // chat's value.
  const [held, setHeld] = useState<number | null>(null);
  const mode = held ?? chatMode(preferences);
  const { temperature, thinking } = samplingFor(mode);
  const effort =
    model?.capabilities.reasoning === true
      ? effortFor(thinking, model)
      : undefined;
  const hundredths = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const values = {
    temperature: hundredths.format(temperature),
    // A level the copy does not name is shown in the model's own word.
    effort:
      effort === undefined
        ? ""
        : t(`dock.mode.effort.${effort}`, { defaultValue: effort }),
  };
  const plain = effort === undefined ? "Plain" : "";
  // Which end the thumb leans to; at the middle, neither.
  const leans = mode < 0.5 ? "creative" : mode > 0.5 ? "standard" : null;

  const commit = (value: number) => {
    setHeld(null);
    const next = modePosition(value);
    if (next !== chatMode(preferences)) onCommit(next);
  };

  return (
    <div className="ai-mode">
      <ModeEnd end="creative" near={leans === "creative"} />
      <Slider
        className="ai-mode-track"
        fill="whole"
        value={mode}
        min={0}
        max={1}
        step={MODE_STEP}
        resetTo={DEFAULT_MODE}
        label={t("dock.mode.label")}
        valueText={t(`dock.mode.valueText${plain}`, values)}
        readout={t(`dock.mode.readout${plain}`, values)}
        onChange={setHeld}
        onCommit={commit}
      />
      <ModeEnd end="standard" near={leans === "standard"} />
    </div>
  );
}
