// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, Kbd, Scrim, type IconName } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { filterCommands, type Command } from "../../ui/commandFilter";
import { wellsOf } from "./boardWells";

// The board: the editor's palette, a different object from the Library's
// search (`CommandPalette`). It shares the filter, the `Command`
// shape and the `Scrim`, and nothing else.
//
// A board, not a search box: laid out, grouped and complete at rest. On the
// phone this surface is the only route to five places, and typing is the
// affordance a phone cannot supply. No recency, frequency or score
// reordering: spatial constancy is what makes a palette learnable. Filtering
// removes cells and reflows wells; survivors keep their order and their well.
//
// No per-cell shortcut letters: a shortcut nobody can infer from looking at
// the board is one nobody uses.
//
// The arrangement is the shortcut sheet's six groups, from the same
// `shortcuts.group.*` keys, made pressable.

export interface BoardCommand extends Command {
  icon: IconName;
  run: () => void;
}

interface Props {
  open: boolean;
  commands: readonly BoardCommand[];
  /**
   * Which end takes focus. Mod+K always lands on the field. The titlebar
   * button decides by `(pointer: coarse)`, not by "was it a click": only a
   * coarse pointer needs the board live, because there the field would put
   * the on-screen keyboard over the board. The phone bar's slot opens
   * straight to `"board"`.
   */
  live: "field" | "board";
  onClose: () => void;
}

export default function CommandBoard({ open, commands, live, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const boardEl = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Grouped from all the commands, so the arrangement is a property of the
  // board rather than of what is currently shown.
  const wells = useMemo(() => wellsOf(commands), [commands]);
  const shown = useMemo(
    () => new Set(filterCommands(commands, query).map((c) => c.id)),
    [commands, query],
  );

  const visibleWells = useMemo(
    () =>
      wells
        .map((well) => ({
          ...well,
          commands: well.commands.filter((c) => shown.has(c.id)),
        }))
        .filter((well) => well.commands.length > 0),
    [wells, shown],
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const run = (command: BoardCommand) => {
    // Closed first, so a command that opens another layer does not stack on
    // a board about to unmount underneath it.
    onClose();
    command.run();
  };

  const cells = () =>
    Array.from(
      boardEl.current?.querySelectorAll<HTMLButtonElement>(".board-cell") ?? [],
    );

  const walk = (delta: number) => {
    const all = cells();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = Math.max(0, Math.min(all.length - 1, at + delta));
    all[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const typing = event.target === field.current;

    // A plain letter always types: the board carries no per-cell shortcut
    // letters, so there is nothing for a letter to collide with.
    if (typing && event.key !== "ArrowDown") return;

    if (event.key === "/") {
      // The way down into the field from the board, so a writer who opened by
      // thumb can still narrow 24 cells by typing.
      event.preventDefault();
      field.current?.focus();
      return;
    }
    // Arrows walk the cells. A plain walk is enough: the cells are real
    // buttons in document order, so Tab reaches them too.
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      if (typing) cells()[0]?.focus();
      else walk(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      walk(-1);
    }
  };

  return (
    <Scrim
      open={open}
      place="top"
      onClose={onClose}
      initialFocus={() => (live === "field" ? field.current : cells()[0])}
      labelledBy={headingId}
      className="board"
    >
      <div className="board-inner" onKeyDown={onKeyDown}>
        <div className="board-head">
          <Icon name={appIcons.palette} size={15} />
          <h2 id={headingId}>{t("palette.label")}</h2>
          {/* The cap is a note for a desk keyboard, never the only exit: a
              soft keyboard has no Esc, so the close button beside it is not a
              duplicate. */}
          <Kbd>Esc</Kbd>
          <button
            type="button"
            className="board-close"
            aria-label={t("palette.close")}
            onClick={onClose}
          >
            <Icon name={appIcons.close} size={15} />
          </button>
        </div>

        {/* Subordinate to the board: it filters a board that is already
            legible, and is not the way in. */}
        <input
          ref={field}
          className="board-filter"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={t("palette.filter")}
          aria-label={t("palette.filter")}
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="board-wells" ref={boardEl}>
          {visibleWells.length === 0 ? (
            <p className="board-none">
              {t("palette.noMatch", { query: query.trim() })}
            </p>
          ) : (
            visibleWells.map((well) => (
              <section className="board-well" key={well.name}>
                <h3>{well.name}</h3>
                <div className="board-cells">
                  {well.commands.map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      className="board-cell"
                      onClick={() => run(command)}
                    >
                      <Icon name={command.icon} size={15} />
                      <span className="board-label">{command.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </Scrim>
  );
}
