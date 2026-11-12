// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { forwardRef, useId, type ForwardedRef } from "react";
import type { ReactElement } from "react";
import { Icon } from "./icons";
import { appIcons } from "./appIcons";

// A real `<select>`, with the label-and-evidence frame `Input` uses. The line
// underneath answers the same question, what will this do: for the create
// dialog, the Parts a starting structure is about to write.
//
// Native rather than a listbox built from divs. Five or six options is the
// size where a custom popup looks tempting and starts costing real behaviour:
// type-ahead, the platform's wheel on a phone, arrow keys that commit rather
// than preview, and a control a screen reader already knows.
// `SegmentedControl` fits two or three choices that must be visible at once;
// this is for more than fit that way.

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /**
   * The heading this option sits under, drawn as the platform's own
   * `<optgroup>`. Options carrying the same group must be contiguous: a
   * heading is drawn where the group changes, so a split group draws twice,
   * as `Menu`'s groups do.
   */
  group?: string;
}

/** Runs of options under one heading; `group` undefined for ungrouped runs. */
function runsOf<T extends string>(
  options: readonly SelectOption<T>[],
): Array<{ group: string | undefined; options: SelectOption<T>[] }> {
  const runs: Array<{ group: string | undefined; options: SelectOption<T>[] }> =
    [];
  for (const option of options) {
    const last = runs[runs.length - 1];
    if (last && last.group === option.group) last.options.push(option);
    else runs.push({ group: option.group, options: [option] });
  }
  return runs;
}

export interface SelectProps<T extends string> {
  label: string;
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What this choice will produce. Mono, because it is a result, not prose. */
  note?: React.ReactNode;
  /** Drawn beside the label, as the segmented control's own fields do. */
  icon?: React.ReactNode;
  /**
   * Keep the label for a reader, and take its box off the screen: for a
   * settings row, where the name is already drawn beside the control.
   */
  labelHidden?: boolean;
  /**
   * The label on the control's own line, before it ("Split by: [Headings]"),
   * for a choice that sits above a list and should cost it no height.
   */
  inline?: boolean;
}

function SelectInner<T extends string>(
  {
    label,
    options,
    value,
    onChange,
    note,
    icon,
    labelHidden,
    inline,
  }: SelectProps<T>,
  ref: ForwardedRef<HTMLSelectElement>,
) {
  const id = useId();
  const noteId = `${id}-note`;

  return (
    <div
      className={
        inline ? "ui-input-field ui-input-field--inline" : "ui-input-field"
      }
    >
      <label
        className={
          labelHidden ? "ui-input-label ui-visually-hidden" : "ui-input-label"
        }
        htmlFor={id}
      >
        {icon}
        {label}
      </label>
      <span className="ui-select-wrap">
        <select
          ref={ref}
          id={id}
          className="ui-select"
          value={value}
          aria-describedby={note ? noteId : undefined}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {runsOf(options).map((run, index) => {
            const drawn = run.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ));
            return run.group === undefined ? (
              drawn
            ) : (
              <optgroup key={`${index}:${run.group}`} label={run.group}>
                {drawn}
              </optgroup>
            );
          })}
        </select>
        {/* Decoration over a control that draws its own arrow on some
            platforms and none on others, so `appearance: none` removes the
            native one and this replaces it. Never a click target: the select
            underneath is the whole hit area. */}
        <span className="ui-select-chevron" aria-hidden>
          <Icon name={appIcons.expand} size={14} />
        </span>
      </span>
      {note && (
        <p id={noteId} className="ui-input-note">
          {note}
        </p>
      )}
    </div>
  );
}

export default forwardRef(SelectInner) as <T extends string>(
  props: SelectProps<T> & { ref?: ForwardedRef<HTMLSelectElement> },
) => ReactElement;
