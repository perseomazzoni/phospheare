// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, Kbd, Scrim, type IconName } from "./index";
import { appIcons } from "./appIcons";
import {
  filterCommands,
  nextIndex,
  resetIndex,
  type Command,
} from "./commandFilter";

// The command palette, Ctrl/⌘K: the keyboard route to every project on the
// shelf and every action around it.
//
// Projects and commands are one list. Looking for a book and changing the
// theme are both naming what the writer wants, and splitting them into
// "search" and "commands" would make the writer choose a mechanism before
// asking.
//
// It is a listbox rather than a menu: focus stays in the field and the
// highlight is announced through `aria-activedescendant`. Moving real focus to
// the rows would stop the writer typing.

export interface PaletteCommand extends Command {
  icon: IconName;
  run: () => void;
}

interface Props {
  open: boolean;
  commands: readonly PaletteCommand[];
  onClose: () => void;
}

export default function CommandPalette({ open, commands, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const rowId = (i: number) => `${listId}-${i}`;

  const shown = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );

  // The list changed under the highlight. It is corrected during render rather
  // than in an effect, so no frame paints a selection past the end of the
  // list.
  const at =
    selected >= shown.length || selected < 0
      ? resetIndex(shown.length)
      : selected;

  useEffect(() => {
    if (!open || at < 0) return;
    document.getElementById(`${listId}-${at}`)?.scrollIntoView({
      block: "nearest",
    });
    // Inlined rather than through `rowId`: the id is a stable `useId`, so the
    // effect changes only with the open flag and the index.
  }, [open, at, listId]);

  const run = (command: PaletteCommand) => {
    // Closed first, so a command that opens another layer does not stack on a
    // palette about to unmount under it.
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // While an IME is composing, Enter commits the candidate and the arrows
    // walk its list: the keys belong to the IME, not to the rows.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(nextIndex(shown.length, at, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(nextIndex(shown.length, at, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelected(resetIndex(shown.length));
    } else if (event.key === "End") {
      event.preventDefault();
      setSelected(nextIndex(shown.length, shown.length - 1, 0));
    } else if (event.key === "Enter" && at >= 0) {
      event.preventDefault();
      run(shown[at]);
    }
  };

  return (
    <Scrim
      open={open}
      place="top"
      onClose={onClose}
      initialFocus={() => field.current}
      label={t("palette.label")}
      className="palette"
    >
      <div className="palette-query">
        <Icon name={appIcons.search} size={17} />
        <input
          ref={field}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.label")}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={at >= 0 ? rowId(at) : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <Kbd>Esc</Kbd>
      </div>

      <ul
        className="palette-list"
        id={listId}
        role="listbox"
        aria-label={t("palette.label")}
      >
        {shown.length === 0 ? (
          <li className="palette-none">
            {t("palette.noMatch", { query: query.trim() })}
          </li>
        ) : (
          shown.map((command, i) => (
            <li key={command.id} role="none">
              <button
                id={rowId(i)}
                type="button"
                role="option"
                aria-selected={i === at}
                className={`palette-row${i === at ? " palette-row-on" : ""}`}
                // The highlight follows the pointer too, so clicking never runs
                // a different command from the one under the cursor.
                onMouseMove={() => i !== at && setSelected(i)}
                onClick={() => run(command)}
                // Keeps focus in the field: a blur would close the palette
                // between mousedown and click.
                onMouseDown={(event) => event.preventDefault()}
              >
                <Icon name={command.icon} size={16} />
                <span className="palette-label">{command.label}</span>
                <span className="palette-group">{command.group}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </Scrim>
  );
}
