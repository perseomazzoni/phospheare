// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { appIcons } from "./appIcons";

// Pick: one of a few real choices, drawn as a card, such as where a project
// will live (local disk or Remote Storage) or what a book is exported as. It is
// in the kit because two dialogs drawing their own radio cards would be the
// per-panel look the kit exists to prevent.
//
// A real radio, visually hidden inside the label, rather than a div with
// `role="radio"`: arrow-key navigation, grouping and the "one of these"
// reading come from the browser, and none survive reimplementation. `group`
// is the radios' shared `name`, so two pick groups on one page never steal
// each other's arrow keys.
//
// The sigil is optional: a choice that is a word (a file format) has no
// honest icon, and a made-up one per format is decoration.
//
// A choice whose consequences need sentences, such as what signing out
// deletes, carries them as `children` under the name. The radio is then
// named by the name alone and described by the rest, so a screen reader
// reads the choice first and the consequences after.

export interface PickProps {
  /** The radio group this card belongs to. */
  group: string;
  on: boolean;
  disabled?: boolean;
  icon?: IconName;
  name: string;
  sub?: string;
  onChoose: () => void;
  children?: ReactNode;
}

export default function Pick({
  group,
  on,
  disabled = false,
  icon,
  name,
  sub,
  onChoose,
  children,
}: PickProps) {
  const nameId = useId();
  const moreId = useId();
  return (
    <label
      className={icon ? "pick" : "pick pick-plain"}
      data-on={on && !disabled ? "1" : "0"}
      aria-disabled={disabled}
    >
      <input
        className="ui-visually-hidden"
        type="radio"
        name={group}
        checked={on && !disabled}
        disabled={disabled}
        onChange={onChoose}
        aria-labelledby={children ? nameId : undefined}
        aria-describedby={children ? moreId : undefined}
      />
      {icon && (
        <span className="pick-sigil">
          <Icon name={icon} size={22} />
        </span>
      )}
      <span className="pick-text">
        <span id={nameId} className="pick-name">
          {name}
        </span>
        {sub && <span className="pick-sub">{sub}</span>}
        {children && (
          <span id={moreId} className="pick-more">
            {children}
          </span>
        )}
      </span>
      <span className="pick-tick">
        <Icon name={appIcons.confirm} size={17} />
      </span>
    </label>
  );
}
