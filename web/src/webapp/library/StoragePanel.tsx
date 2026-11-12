// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Icon, Reason } from "../../ui";
import type { Connections } from "../../storage";
import { appIcons } from "../../ui/appIcons";
import { VENDORS } from "../../legal/domain/facts";
import type { SourceFilter } from "./libraryFilter";

// Where projects live, and what can be done there: one list, not two zones.
// Each row is both a place to narrow the shelf to and a place to act on, so it
// does not read as a settings page bolted onto a filter.
//
//   ▦  All projects                    5
//   ▢  This device      ●          2   Find projects on this device
//   △  Remote Storage   ●          3   Find projects in Remote Storage
//
// All projects has no place behind it, so it has no action, and the absence
// keeps the shape legible.
//
// The provider rows share one anatomy driven by the connections record: icon,
// name, live state, count and actions come off the uniform shape, and only the
// per-provider copy and action wiring are named here. A third storage gets its
// row by registering its connection.
//
// The row cannot be one `<label>`: a `<button>` inside a label also fires the
// label's radio, so pressing an action would silently switch the filter. The
// label covers the sigil and the name; the count and the action are its
// siblings in the grid.

interface Props {
  filter: SourceFilter;
  onFilter: (value: SourceFilter) => void;
  counts: Record<string, number>;
  connections: Connections;
  /**
   * Connects Remote Storage. Absent when the writer has no Google account:
   * the row says so and offers nothing.
   */
  onConnect?: () => void;
  onChooseLocalFolder: () => void;
  /** The explicit local sweep. Absent until a root is mapped. */
  onFindLocalProjects?: () => void;
  /** Scans Remote Storage for projects. Absent when it is not connected. */
  onFindInDrive?: () => void;
}

export default function StoragePanel({
  filter,
  onFilter,
  counts,
  connections,
  onConnect,
  onChooseLocalFolder,
  onFindLocalProjects,
  onFindInDrive,
}: Props) {
  const { t } = useTranslation();

  const local = connections.local;
  const drive = connections.drive;
  const localUnavailable = local.state === "unavailable";
  const localChosen =
    local.state === "connected" || local.state === "needs-gesture";
  const driveConnected = drive.state === "connected";

  const here = counts[local.id] ?? 0;
  const there = counts[drive.id] ?? 0;

  const rows: Parameters<typeof Row>[0][] = [
    {
      value: local.id,
      filter,
      onFilter,
      // Barred while there is no root, matching the bar's tally: a
      // struck-through sigil says "not chosen" to a first-time reader.
      icon: localChosen ? local.icon : appIcons.localOff,
      name: local.label(),
      // Firefox and Safari have no File System Access API; saying so beats
      // an action that fails on click.
      note: localUnavailable ? t("library.diskUnsupported") : undefined,
      // The dot, as on Remote Storage's row: present only when a root is
      // chosen; otherwise the row dims and the sigil bars, with no caption. The
      // dot, not words, tells the selection state; its screen-reader label is
      // the "folder chosen" copy.
      live: localChosen,
      liveLabel: t("library.localFolderChosen"),
      count: here,
      actions: localUnavailable
        ? undefined
        : localChosen
          ? onFindLocalProjects
            ? [
                // Chosen: the sweep alone, as Remote Storage's connected row
                // shows only its own. A remap is Forget in Settings, then
                // Choose.
                {
                  label: t("library.findLocal"),
                  onSelect: onFindLocalProjects,
                },
              ]
            : undefined
          : [
              {
                label: t("library.chooseLocalFolder"),
                onSelect: onChooseLocalFolder,
              },
            ],
    },
    {
      value: drive.id,
      filter,
      onFilter,
      // Barred while there is no connection, as the local row's icon is: a
      // missing dot says "not connected" only to a reader who knows the dot.
      icon: driveConnected ? drive.icon : appIcons.driveOff,
      name: drive.label(),
      // The dot only means connected. Disconnected, the row offers the one
      // remedy, or, for a writer without Google, says why there is none.
      note: onConnect
        ? undefined
        : t("library.driveNeedsAccount", { identity: VENDORS.identity }),
      live: driveConnected,
      count: driveConnected ? there : null,
      actions: driveConnected
        ? onFindInDrive
          ? [
              {
                label: t("library.findDrive"),
                onSelect: onFindInDrive,
              },
            ]
          : undefined
        : onConnect
          ? [{ label: t("library.connect"), onSelect: onConnect }]
          : undefined,
    },
  ];

  return (
    <div className="store">
      {/* Always all three, always pickable, even when projects live in one
          place: every row is styled as a target, and a place with no
          projects is an answer. Selecting it shows an empty shelf that names
          the place and offers the way to fill it (`emptyState.ts`). */}
      <Row
        value="all"
        filter={filter}
        onFilter={onFilter}
        icon={appIcons.grid}
        name={t("library.allProjects")}
        count={here + there}
      />

      {rows.map((row) => (
        <Row key={row.value} {...row} />
      ))}
    </div>
  );
}

function Row({
  value,
  filter,
  onFilter,
  icon,
  name,
  note,
  live,
  liveLabel,
  count,
  actions,
}: {
  value: SourceFilter;
  filter: SourceFilter;
  onFilter: (value: SourceFilter) => void;
  icon: Parameters<typeof Icon>[0]["name"];
  name: string;
  note?: string;
  live?: boolean;
  /**
   * What the dot means to a screen reader: "connected" for Remote Storage, "a
   * folder is chosen" for the local row.
   */
  liveLabel?: string;
  count: number | null;
  actions?: { label: string; onSelect: () => void }[] | undefined;
}) {
  const on = filter === value;

  // `live === false`, not `!live`: All passes no live state, because the
  // question does not apply to it. Only a row that has a live state and
  // lacks it dims: Remote Storage disconnected, or no local root chosen.
  return (
    <div
      className="store-row"
      data-on={on ? "1" : "0"}
      data-off={live === false ? "1" : "0"}
    >
      {/* Always a label around a real radio: the cursor and the hover
          highlight live on `.store-pick`, so every row looks like a target
          and must answer as one. The radio, hidden inside the label, gives
          grouping, arrow keys and the "one of these" reading from the
          browser. */}
      <label className="store-pick">
        <input
          className="ui-visually-hidden"
          type="radio"
          name="shelf-source"
          checked={on}
          onChange={() => onFilter(value)}
        />
        <span className="store-sigil">
          <Icon name={icon} size={18} />
        </span>
        <span className="store-name">
          <span className="store-name-text">{name}</span>
          {live && (
            <i className="store-live" aria-label={liveLabel ?? "connected"} />
          )}
          {note && (
            <span className="store-note">
              <Reason>{note}</Reason>
            </span>
          )}
        </span>
      </label>

      <span className="store-count">{count ?? ""}</span>

      {actions && actions.length > 0 ? (
        // No glyph: the row already carries one for the place, and an "opens
        // elsewhere" arrow would be false for picking a folder here.
        <span className="store-acts">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="store-act"
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          ))}
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}
