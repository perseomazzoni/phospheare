// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CommandBar,
  CommandBarAction,
  CommandBarFind,
  CommandBarSegment,
  CommandBarTrack,
  Icon,
  useOverlay,
} from "../../ui";
import type { Connections } from "../../storage";
import { useDismissOnPointerAway } from "../../ui/overlay/useDismissOnPointerAway";
import { appIcons } from "../../ui/appIcons";
import StoragePanel from "./StoragePanel";
import type { SourceFilter } from "./libraryFilter";
import type { Density } from "./useLibraryView";

// The shelf's controls, composed into the shared `CommandBar`. The bar knows
// shape and motion; projects, storage and density are here.
//
//   ( + ) │ ▢ 3  △ 4 │ ▦ ▤ │                                   ( ⌕ )
//    make    what you have   how you see it                     find
//
// Create at the leading end and find at the trailing one: two adjacent
// circles of one size invite a mis-click, and the two are different classes
// of action, one making something, the other narrowing what exists.
//
// No segment labels: icons and counts say what they are, and the names live
// on `aria-label`.

interface Props {
  query: string;
  onQuery: (value: string) => void;
  filter: SourceFilter;
  onFilter: (value: SourceFilter) => void;
  counts: Record<string, number>;
  density: Density;
  onDensity: (value: Density) => void;
  /**
   * How many projects the shelf shows. Whether to draw it is decided here,
   * not by the caller: it means something only once a query is typed, a fact
   * about this control, not the shelf.
   */
  shown: number;
  connections: Connections;
  /** Absent when the writer has no Google account. */
  onConnect?: () => void;
  onChooseLocalFolder: () => void;
  onFindInDrive?: () => void;
  /** The local sweep, the storage panel's mapped-row action. */
  onFindLocalProjects?: () => void;
  onCreate: () => void;
  createDisabled?: boolean;
}

export default function ShelfBar({
  query,
  onQuery,
  filter,
  onFilter,
  counts,
  density,
  onDensity,
  shown,
  connections,
  onConnect,
  onChooseLocalFolder,
  onFindInDrive,
  onFindLocalProjects,
  onCreate,
  createDisabled,
}: Props) {
  const { t } = useTranslation();
  const panelId = useId();

  const bar = useRef<HTMLDivElement>(null);
  const storageButton = useRef<HTMLButtonElement>(null);
  const [storageOpen, setStorageOpen] = useState(false);

  // Escape and the layer stack, so this closes before a sheet underneath.
  // Not portalled, because the panel grows out of its own trigger;
  // `useOverlay` needs only a ref.
  const { ref: overlayRef } = useOverlay(storageOpen, {
    role: "menu",
    onClose: () => setStorageOpen(false),
    moveFocusIn: false,
  });

  useDismissOnPointerAway(
    storageOpen,
    [bar.current, storageButton.current],
    () => setStorageOpen(false),
  );

  // The two store faces, from the connections record: the tallies' icon,
  // name and barred state are the providers' own facts.
  const local = {
    id: connections.local.id,
    icon: connections.local.icon,
    label: connections.local.label(),
    off: false,
  };
  // Barred and dimmed with no connection: the wrong-state version of the
  // sigil itself, not a status dot beside it, so no second element is needed.
  // The segment carries no live dot, which would claim all is well.
  const drive = {
    id: connections.drive.id,
    icon:
      connections.drive.state === "connected"
        ? connections.drive.icon
        : appIcons.driveOff,
    label: connections.drive.label(),
    off: connections.drive.state !== "connected",
  };

  // With a store selected, only its count: the other number is not what the
  // shelf shows, and a reader would add the two and find the grid disagree.
  const tallies =
    filter === local.id
      ? [{ ...local, n: counts[local.id] ?? 0 }]
      : filter === drive.id
        ? [{ ...drive, n: counts[drive.id] ?? 0 }]
        : [
            { ...local, n: counts[local.id] ?? 0 },
            { ...drive, n: counts[drive.id] ?? 0 },
          ];

  // The word shows only under All, where the two sigils beside it break down
  // something that needs naming. A chosen store's own sigil names the place.
  const showingAll = filter !== local.id && filter !== drive.id;

  // Choosing a place is the panel's one decision, so it closes the panel.
  const chooseAndClose = (value: SourceFilter) => {
    onFilter(value);
    setStorageOpen(false);
  };

  return (
    <div className="shelf-bar-slot">
      <CommandBar ref={bar} open={storageOpen}>
        <CommandBarAction
          label={t("library.newProject")}
          icon={appIcons.add}
          tone="solid"
          labelled
          disabled={createDisabled}
          onClick={onCreate}
        />

        {/* Storage: icons and counts, no words and no live dot. The dot
            belongs on the row where the connection can be acted on. */}
        <CommandBarSegment className="shelf-storage">
          <button
            ref={storageButton}
            type="button"
            className="shelf-storage-face"
            aria-label={t("library.storageLabel")}
            aria-expanded={storageOpen}
            aria-haspopup="menu"
            aria-controls={panelId}
            onClick={() => setStorageOpen((open) => !open)}
          >
            {/* "All", not "All projects": the tallies beside it already say
                "projects".

                The chevron sits with the word it discloses; at the end of the
                row, two tallies away, it reads as punctuation. With a store
                chosen there is no word, and it sits at the trailing edge. */}
            {showingAll && (
              <span className="shelf-storage-scope">
                <Icon name={appIcons.expand} size={13} />
                <span className="shelf-scope">{t("library.filterAll")}</span>
              </span>
            )}
            {!showingAll && <Icon name={appIcons.expand} size={13} />}
            {tallies.map((tally) => (
              <span
                key={tally.id}
                className="shelf-tally"
                data-off={tally.off ? "1" : "0"}
              >
                <Icon name={tally.icon} size={15} />
                {/* Numeral and noun apart, so a narrow screen drops the noun
                    and keeps the count: the bar wants about 408px against the
                    333px a 375px screen leaves, and the sigil already says
                    "projects". `library.countWord` gives each language its own
                    plural. The word is only visually hidden, never
                    `display: none`, so a screen reader hears the same at every
                    width. */}
                <span className="shelf-tally-n">{tally.n}</span>
                <span className="shelf-tally-word">
                  {t("library.countWord", { count: tally.n })}
                </span>
                <span className="ui-visually-hidden">{tally.label}</span>
              </span>
            ))}
          </button>

          {/* Mounted while shut: conditional rendering can animate open but
              never closed, because React removes the node on the frame the
              class changes. */}
          <div
            id={panelId}
            ref={overlayRef}
            className="shelf-panel"
            data-open={storageOpen ? "1" : "0"}
            role="menu"
            aria-label={t("library.storageLabel")}
          >
            <div className="shelf-panel-inner">
              <StoragePanel
                filter={filter}
                onFilter={chooseAndClose}
                counts={counts}
                connections={connections}
                onConnect={onConnect}
                onChooseLocalFolder={onChooseLocalFolder}
                onFindInDrive={onFindInDrive}
                onFindLocalProjects={onFindLocalProjects}
              />
            </div>
          </div>
        </CommandBarSegment>

        {/* View: a thumb that travels between the two icons, rather than a
            word replaced. A changing word is a cut; a pill sliding under the
            chosen icon is the choice, animated. The editor's alignment row is
            the same track with four cells. */}
        <CommandBarSegment className="shelf-view">
          <CommandBarTrack
            label={t("library.densityLabel")}
            value={density}
            onChange={onDensity}
            options={[
              { value: "grid", icon: appIcons.grid, label: t("library.grid") },
              { value: "list", icon: appIcons.list, label: t("library.list") },
            ]}
          />
        </CommandBarSegment>

        {/* Unconditional: the whole bar is absent until the shelf has
            projects, so there is always something to find. */}
        <CommandBarFind
          label={t("library.findLabel")}
          placeholder={t("library.findPlaceholder")}
          value={query}
          onChange={onQuery}
          clearLabel={t("search.clear")}
          // `CommandBarFind` draws it only once something is typed. A source
          // filter narrows the shelf too, but it is not a search, and a count
          // beside a button with no field in sight makes no sense.
          count={t("library.count", { count: shown })}
        />
      </CommandBar>
    </div>
  );
}
