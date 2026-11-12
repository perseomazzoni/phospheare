// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { useProjectState } from "../ProjectContext";
import { spineName } from "../path";
import type { DocumentStructure } from "../../project/types";
import { CommandBarFind } from "../../ui/CommandBar";
import { useFrameOptions } from "../../theme/editor";
import { Dots, Icon, SpineGlyph } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type { ProjectFind } from "./useProjectFind";

/**
 * The panel spine's Parts drawn apart (`spineGroups`), in the glyph's
 * thousandths of its width: about 12px between Parts and 2px between
 * Sections at the panel's width.
 */
const SPINE_APART = { part: 64, section: 10 };

/** The structure panel's head: the project's spine, the find, the close. */
export default function PanelHead({
  structure,
  currentPart,
  find,
  placing,
  onEndFind,
  sheet,
  narrow,
  rail,
  peek,
  onToggleCollapse,
}: {
  structure: DocumentStructure;
  /** The Part the open node is in, which the spine marks. */
  currentPart: string | null;
  find: ProjectFind;
  /** A Move… holds the panel, and the field refuses edits. */
  placing: boolean;
  onEndFind: () => void;
  sheet: boolean;
  narrow: boolean;
  rail: boolean;
  peek: boolean;
  onToggleCollapse: () => void;
}) {
  const { t } = useTranslation();
  const { props, ref: projectRef } = useProjectState();
  const {
    query,
    setQuery,
    setFindOpen,
    findInput,
    leaveFind,
    finding,
    searching,
    results,
    reading,
    searchPending,
  } = find;
  const spineApart = useFrameOptions().spineGroups === "apart";
  const rootTitle = props?.document.title ?? projectRef?.name ?? "";
  return (
    // The project's shape and the find share one line, so the narrow column
    // spends no row on the find alone.
    //
    // `data-finding` lives here and nowhere else: this element is the
    // scrollers' preceding sibling, so the stylesheet swaps the panel's
    // bodies off it, and the same attribute opens the box inside it.
    // One boolean, one place.
    <div className="dt-head" data-finding={finding ? "1" : "0"}>
      <div className="dt-root">
        <span className="dt-ident">
          {/* No project name here: the titlebar's crumb carries the
            name and the route to the Desk. The shape stays, because it
            says something the crumb cannot. */}
          {props && (
            // The other end of the shelf card's spine. Naming both makes
            // the browser move this shape between the two screens rather
            // than cross-fade two whole pages.
            <span
              className="dt-spine"
              style={
                projectRef
                  ? { viewTransitionName: spineName(projectRef) }
                  : undefined
              }
            >
              {/* No labels at this size: the rows below already number
                the Parts. The goal is passed so this is the same
                goal-anchored drawing the Desk shows. */}
              <SpineGlyph
                structure={structure}
                stats={props.stats}
                height={22}
                title={rootTitle}
                goal={props.document.goal}
                deltas
                currentPart={currentPart}
                gaps={spineApart ? SPINE_APART : undefined}
              />
            </span>
          )}
        </span>

        {/* The shared find, not a copy. `.dt-find` scopes the panel's
          styling and is also the hook for the rail rule and an e2e locator.

          The count is passed and never drawn: at this width the tail is
          absolutely positioned, so a painted number would cover the query,
          and swapping the whole panel body reaches a screen-reader user
          only if something says it.

          It is given `searching`'s value, not the raw query: `data-query`
          knows nothing about a placement, so the raw query would leave a
          field over a panel whose results are gone. During a placement the
          field collapses and refuses edits while it shows none, so typing
          never disappears unseen. */}
        <div className="dt-find-row">
          {/* The way back to the tree, where the writer's eye already
              is, so leaving the find is a visible control. It clears the
              query as well as closing, or the query would return with the
              next click on the sigil.

              Out of the tab order while the find is shut, when it has no
              width: a tab stop on a 0px control is a stop at nothing. */}
          <button
            type="button"
            className="dt-find-back"
            aria-label={t("tree.findBack")}
            tabIndex={finding ? undefined : -1}
            aria-hidden={finding ? undefined : true}
            // The field keeps the caret while this is pressed: a blur
            // arriving first would close the find and move this button
            // from under the pointer before the click. `leaveFind` hands
            // the caret back.
            onMouseDown={(event) => event.preventDefault()}
            onClick={leaveFind}
          >
            <Icon name={appIcons.backToLibrary} size={13} />
          </button>
          <CommandBarFind
            inputRef={findInput}
            className="dt-find"
            // The label says where this find looks; the placeholder says
            // what it matches (names first, then the words inside Parts,
            // references and conversations). `placeholder` is the
            // accessible description when nothing else supplies one, so
            // one string in both slots would be announced twice and the
            // editor's two finds would look alike.
            label={t("tree.findLabel")}
            placeholder={t("tree.findPlaceholder")}
            value={searching ? query : ""}
            onChange={(next) => {
              if (placing) return;
              // An arrival's prose marks belong to the query that made
              // them, so a move between two non-empty queries ends them,
              // or the prose would stay lit for the old query under a
              // count for the new one.
              if (next.trim() !== "" && query.trim() !== "") {
                onEndFind();
              }
              setQuery(next);
              // The clear button is an empty `onChange` too, so one
              // branch covers it and a backspace to nothing.
              if (next.trim() === "") onEndFind();
            }}
            clearLabel={t("search.clear")}
            // The caller owns the open state, because opening the field
            // raises the face, and `data-query` is built from `open`, so
            // the box being a field and the tree being hidden are one
            // boolean.
            open={finding}
            onFocus={() => setFindOpen(true)}
            // Only from an empty field. With a query set the writer is
            // reaching into the results, and the panel must not fold
            // under their hand.
            onBlur={() => {
              if (query.trim() === "") setFindOpen(false);
            }}
            // Escape performs the back control's act (`leaveFind`) in one
            // press, matching the in-document find. The shared field
            // keeps its empty-field blur for the shelf and the bar, which
            // pass no handler.
            onEscape={leaveFind}
            // The sweep, in the slot the clear command would take: every
            // search re-reads the project, so this says the list is still
            // filling.
            busy={reading ? <Dots label={t("tree.findReading")} /> : undefined}
            // Withheld while `searchPending`, as the drawn sentence is:
            // this is its spoken half, from the same key and count, and
            // "Nothing matches" over a book still being read would be
            // false. The live region stays mounted and empty,
            // so the count is announced when it comes.
            count={
              searching && !searchPending ? (
                <span className="ui-visually-hidden">
                  {t("tree.findCount", { count: results.total })}
                </span>
              ) : undefined
            }
          />
        </div>

        {/* In the head on two planes, and on the border on one.

          As a sheet it is a close: the same chevron, but named for what
          happens, because "collapse" promises a rail.

          Narrow (under 1016) it is the collapse, in the head: the panel is
          an overlay on the prose and on the command bar, and a handle
          overhanging its edge would take presses from the bar.

          Only the wide plane has a 24px gutter of empty margin to
          straddle, and the handle lives there. */}
        {(sheet || narrow) && (
          <button
            type="button"
            className="dt-close"
            // The fold, not the face, as `.dt-collapse` reads it: a
            // peek is still folded, and pressing this pins it open.
            aria-expanded={sheet ? undefined : !(rail || peek)}
            aria-label={
              sheet
                ? t("tree.closePanel")
                : rail || peek
                  ? t("tree.expandPanel")
                  : t("tree.collapsePanel")
            }
            onClick={onToggleCollapse}
          >
            <Icon name={appIcons.expand} size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
