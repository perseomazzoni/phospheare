// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Icon, type IconName } from "./icons";

// The segmented control: a small set of mutually exclusive choices, all
// visible at once, such as which storage a shelf is filtered to, grid against
// list, English against Italiano.
//
// Buttons with `aria-pressed`, not radios. A radio group answers "what will be
// submitted"; this answers "what am I looking at", and the change is
// immediate, with nothing to submit. There is no arrow-key roving for the
// same reason: with three visible options, Tab reaching each one is the
// plainer behaviour, and a roving tabindex would hide two of them from the tab
// order to save a keystroke.

export interface Segment<T extends string> {
  value: T;
  label?: string;
  /** For a control where the shape is the label, such as grid against list. */
  icon?: IconName;
  /** Required when there is only an icon. */
  title?: string;
  /** Shown but not offered: a choice that cannot be made here. */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /**
   * Names the whole group for a screen reader, such as "Filter by where
   * projects live".
   */
  label: string;
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export default function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={["ui-seg", className ?? ""].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.label ? undefined : option.title}
          title={option.title}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size={15} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
