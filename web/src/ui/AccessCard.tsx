// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { Reason } from "./Bits";
import { appIcons } from "./appIcons";

// A place the writer's words can go (a folder, Remote Storage, a model), stated
// as a transparency statement rather than a settings row: its name and state,
// the one action that changes the state, then what it can and cannot do with
// the writer's words. A model and a storage backend answer the same question,
// where the writer's words go, so the settings sheet draws both with this card.
//
// `children` holds what only one kind of place has, such as an AI card's
// address and models. It sits below the statement, because the statement is
// what a writer reads before the controls matter.

export interface AccessCardProps {
  icon: IconName;
  name: string;
  /** In use now — the sigil and the state take the accent. */
  live: boolean;
  /** One short line under the name, in the mono caption voice. */
  state: string;
  can: readonly string[];
  cannot: readonly string[];
  action?: ReactNode;
  /**
   * The place exists but cannot be used here: the card is dimmed, `state`
   * carries the reason and no `action` is passed.
   */
  unavailable?: boolean;
  children?: ReactNode;
}

export default function AccessCard({
  icon,
  name,
  live,
  state,
  can,
  cannot,
  action,
  unavailable = false,
  children,
}: AccessCardProps) {
  return (
    <div className="ui-access" data-unavailable={unavailable ? "1" : undefined}>
      <div className="ui-access-top">
        <span className={`ui-access-sigil${live ? " is-live" : ""}`}>
          <Icon name={icon} size={22} />
        </span>
        <span className="ui-access-text">
          <span className="ui-access-name">{name}</span>
          <span className={`ui-access-state${live ? " is-live" : ""}`}>
            {unavailable ? <Reason>{state}</Reason> : state}
          </span>
        </span>
        {action}
      </div>
      {can.length + cannot.length > 0 ? (
        <ul className="ui-access-perms">
          {can.map((line) => (
            <li key={line} className="ui-access-can">
              <Icon name={appIcons.confirm} size={13} />
              <span>{line}</span>
            </li>
          ))}
          {cannot.map((line) => (
            <li key={line} className="ui-access-cannot">
              <Icon name={appIcons.close} size={13} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {children ? <div className="ui-access-body">{children}</div> : null}
    </div>
  );
}
