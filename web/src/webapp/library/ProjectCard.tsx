// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { memo, useMemo, useRef } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dots,
  Icon,
  Menu,
  useMenuAnchor,
  type MenuItem,
} from "../../ui";
import {
  getProvider,
  driveProvider,
  localProvider,
  type ProjectRef,
} from "../../storage";
import { appIcons } from "../../ui/appIcons";
import type { DocumentStats } from "../../project/types";
import { projectPath, spineName } from "../../editor/path";
import { warmEditor } from "../../editorChunk";
import SpineGlyph from "../../ui/SpineGlyph";
import { spineFill } from "../../ui/spineLayout";
import { elapsed } from "../../ui/relativeTime";
import { pairingForSync } from "../../project/sync/pairing";
import { cardActions, storageStateFor, type CardActionId } from "./cardActions";
import { whenLine } from "./whenLine";
import { useSyncPending } from "../../project/sync/useSyncState";
import { openableId, type ProjectCard as Card } from "./useProjects";

// A project as an object: its title in the prose serif, its spine, where it
// lives, how long it is and when it last changed, enough to pick it out of
// thirty without opening any.
//
// A card never shows a stale number as current: a dated word count presented
// as live is worse than none. It never shows zeros for a folder it could not
// read, which would look like a lost project.
//
// The whole card is a link, through a stretched pseudo-element over the title,
// not a div with `role="button"`. A project is a destination: middle-click
// opens it in a tab, the status bar shows where it goes, and the keyboard
// reaches it once. The other controls sit above that layer.

interface Props {
  card: Card;
  /** Position in the shelf, for the entrance stagger. */
  index: number;
  /**
   * Words in the longest project on the shelf, the scale every spine is drawn
   * against so lengths compare between cards. 0 when nothing is counted yet,
   * which `spineFill` reads as full width.
   */
  shelfMaxWords: number;
  onForget: (ref: ProjectRef) => void;
  /**
   * Absent when Remote Storage is not connected: there is nowhere to sync to.
   */
  onSyncToDrive?: (ref: ProjectRef) => void;
  /**
   * A paired project's manual re-check; absent when Remote Storage is not
   * connected.
   */
  onSyncNow?: (ref: ProjectRef) => void;
  /** Always available for a paired project; a local-only operation. */
  onUnpair?: (ref: ProjectRef) => void;
  // The whole card, not the ref: the dialogs these open are prefilled from
  // the project's title, which only the card knows. It also lets every card
  // share one stable handler reference.
  /** Absent when Remote Storage is not connected. */
  onMoveToDrive?: (card: Card) => void;
  /** Absent when Remote Storage is not connected. */
  onMoveToLocal?: (card: Card) => void;
  // The whole card, not the ref: the Properties window opens the book by its
  // id, and the duplicate dialog is prefilled from its title.
  onProperties: (card: Card) => void;
  onDuplicate: (card: Card) => void;
  onExport: (card: Card) => void;
  onDelete: (card: Card) => void;
  /**
   * True for a local project paired with a Remote Storage folder: Local+Synced.
   */
  synced?: boolean;
  /**
   * Whether a local root is mapped. Gates "Reveal on this device", which
   * walks the root handle.
   */
  localRootReady: boolean;
}

/** 45ms apart, and only for the first screenful; beyond that it is a wait. */
const STAGGER_MS = 45;
const MAX_STAGGERED = 12;

/**
 * The shelf follows the bar: the greeting sets at once, the bar settles, and
 * the shelf comes in behind it, so the three read as one arrival. The last
 * staggered card is on screen within about 600ms.
 */
const AFTER_BAR_MS = 90;

/**
 * Memoised, so a card whose props have not changed skips re-rendering when a
 * sibling's read lands. It relies on stable props: `card` from
 * `useLibraryView.ts`'s `visible`, which returns the original reference for
 * an unchanged card, the handlers from `Library.tsx`, and primitives that
 * compare by value.
 */
export default memo(function ProjectCard({
  card,
  index,
  shelfMaxWords,
  onForget,
  onSyncToDrive,
  onSyncNow,
  onUnpair,
  onMoveToDrive,
  onMoveToLocal,
  onProperties,
  onDuplicate,
  onExport,
  onDelete,
  synced,
  localRootReady,
}: Props) {
  const { t, i18n } = useTranslation();
  const menu = useMenuAnchor();
  const more = useRef<HTMLButtonElement>(null);

  const { id, ref, state, content } = card;
  const provider = getProvider(ref.providerId);
  const isLocal = provider?.kind !== "remote";
  // Called unconditionally, per the rules of hooks. Harmless for a card with
  // no destination: a project never decorated never enqueues anything, a
  // gate held at the decoration seam.
  const pending = useSyncPending(ref);
  // A synchronous, best-effort read of the pairing cache: `null` on a cold
  // first call, otherwise the remote this local project is paired with.
  const pairedRemote = synced && id ? pairingForSync(id) : null;
  // The card's remote side: its own ref when it is remote, the pairing's
  // target when it is synced local, nothing for a plain-local card.
  const remote = isLocal ? pairedRemote : ref;
  const remoteUrl =
    (remote &&
      getProvider(remote.providerId)?.folderUrl?.({ ...ref, ...remote })) ??
    null;

  // The spine wants one stats block and the cache keeps its halves apart.
  // Memoised, because a fresh object every render would defeat the layout
  // memo inside `SpineGlyph`.
  const spineStats: DocumentStats | null = useMemo(
    () =>
      content
        ? {
            words: content.words,
            parts: content.parts,
            sections: content.sections,
            countedAt: content.cachedAt,
            perNode: content.perNode,
          }
        : null,
    [content],
  );

  const number = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  );
  const ago = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }),
    [i18n.language],
  );

  const relative = (iso: string): string | null => {
    const parts = elapsed(iso, Date.now());
    return parts ? ago.format(parts.value, parts.unit) : null;
  };

  const title = content?.title ?? ref.name;
  // Blocked with content: the numbers are dated by the one date line.
  // Blocked without content shows only the note.
  const stale = state === "blocked" && content !== null;
  const busy = state === "loading";
  // The state classes key on the state itself, never on a negation of
  // "openable", or a disconnected card would look like a vanished folder.
  // `blocked` is lapsed access, local grant or Remote Storage
  // connection, recovered by the shelf banners; `unreadable` is a real read
  // failure with its problem on the card. Both take the ember mark;
  // `gone` takes slate.
  const attention = state === "blocked" || state === "unreadable";
  // The title's link and its address, from `openableId`. `null` covers a
  // card in trouble and a card not yet read, whose book has no id for a URL.
  const openAt = openableId({ state, content });

  // `cardActions.ts` decides which actions a card gets. Reveal's URL comes
  // from the provider's `folderUrl`, never built here: only the adapter knows
  // whether its backend has a web address for a folder.
  const act: Record<CardActionId, Omit<MenuItem, "id">> = {
    reveal: {
      label: t("library.revealInDrive"),
      icon: appIcons.back,
      onSelect: () => {
        if (remoteUrl) window.open(remoteUrl, "_blank", "noopener,noreferrer");
      },
    },
    // The local reveal. The web platform has no path to open a file manager
    // at, so the provider opens the native picker inside the project
    // (`startIn`). The mechanics are the provider's; the card only asks.
    locate: {
      label: t("library.locateFolder"),
      icon: localProvider.icon,
      onSelect: () => void getProvider(ref.providerId)?.revealProject?.(ref),
    },
    properties: {
      label: t("library.properties"),
      icon: appIcons.edit,
      onSelect: () => onProperties(card),
    },
    duplicate: {
      label: t("library.duplicate"),
      icon: appIcons.copy,
      onSelect: () => onDuplicate(card),
    },
    export: {
      label: t("library.exportToFile"),
      icon: appIcons.export,
      onSelect: () => onExport(card),
    },
    sync: {
      label: t("library.syncToDrive"),
      icon: driveProvider.icon,
      onSelect: () => onSyncToDrive?.(ref),
    },
    syncNow: {
      label: t("sync.syncNow"),
      icon: driveProvider.icon,
      onSelect: () => onSyncNow?.(ref),
    },
    unpair: {
      label: t("library.unpair"),
      icon: driveProvider.icon,
      onSelect: () => onUnpair?.(ref),
    },
    moveToRemote: {
      label: t("library.moveToDrive"),
      icon: driveProvider.icon,
      onSelect: () => onMoveToDrive?.(card),
    },
    moveToLocal: {
      label: t("library.moveToLocal"),
      icon: localProvider.icon,
      danger: true,
      onSelect: () => onMoveToLocal?.(card),
    },
    delete: {
      label: t("library.deleteFolder"),
      icon: appIcons.delete,
      danger: true,
      onSelect: () => onDelete(card),
    },
    forget: {
      label: t("library.remove"),
      icon: appIcons.unlist,
      danger: true,
      onSelect: () => onForget(ref),
    },
  };

  const storage = storageStateFor(provider?.kind ?? "device", !!synced);

  const items: MenuItem[] = cardActions({
    storage,
    state,
    remoteConnected: !!onSyncToDrive,
    remoteKey: pairedRemote?.key,
    canRevealRemote: !!remoteUrl,
    localRootReady,
  }).map((id) => ({ id, ...act[id] }));

  const stats = () => {
    if (!content) return null;
    const pct =
      content.goal && content.goal > 0
        ? Math.min(100, Math.round((content.words / content.goal) * 100))
        : null;
    const line = whenLine(
      relative(content.updatedAt),
      relative(content.cachedAt),
    );

    // No Parts and Sections here: the spine above draws them, and
    // `describeSpine` puts the shape into its aria-label and hover title, so
    // the row keeps to one line. The counts appear in the delete
    // confirmation's evidence block (`cardEvidence`).
    //
    // The separators are `::before` on each span but the first, not elements
    // of their own: a flex item cannot be kept off the front of a wrapped
    // line, so a separator element strands a lone dot at every break.
    return (
      <div className="project-stats">
        <span>
          <b>{number.format(content.words)}</b> {t("library.words")}
        </span>
        {pct !== null && <span>{t("library.ofGoal", { pct })}</span>}
        {/* Always on its own line (`.project-when`). One date, never two:
            both stamps answer "when did this project last change", so a
            blocked card prints the same single line as a healthy one, and
            the dimmed numbers, the ember edge and the shelf banner carry the
            staleness. */}
        {line ? (
          <span className="project-when">
            {t("library.edited", { when: line.when })}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <article
      className={`project${stale ? " project-stale" : ""}${state === "gone" ? " project-gone" : ""}${attention ? " project-attention" : ""}${busy ? " project-pending" : ""}`}
      style={
        index < MAX_STAGGERED
          ? { animationDelay: `${AFTER_BAR_MS + index * STAGGER_MS}ms` }
          : undefined
      }
    >
      <div className="project-head">
        <h3 className="project-title">
          {openAt ? (
            <Link
              className="project-open"
              to={projectPath(openAt)}
              viewTransition
              // The editor is a separate chunk, fetched on intent rather than
              // on click to hide most of the wait. The import is cached, so a
              // hover that goes nowhere costs one request a later visit makes
              // anyway.
              onPointerEnter={warmEditor}
              onFocus={warmEditor}
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        <span className="project-where">
          <Icon
            name={
              isLocal
                ? localProvider.icon
                : (provider?.icon ?? localProvider.icon)
            }
            size={12}
          />
          {provider?.label() ?? ref.providerId}
          {synced && (
            <span
              className={`project-sync${pending ? " project-sync-pending" : ""}`}
            >
              {pending ? t("library.syncPending") : t("library.synced")}
            </span>
          )}
          {busy && <Dots label={t("library.reading")} />}
        </span>
      </div>

      {/* No guard on an empty structure: the glyph draws an empty track, so
          every card keeps its spine and its neighbours' height. */}
      {content && spineStats && (
        // Named for the view transition, so the project's shape travels to
        // the editor's panel head rather than the shelf cross-fading. A name
        // is unique per document, which holds because the shelf lists each
        // project once.
        <div
          className="project-spine"
          style={{ viewTransitionName: spineName(ref) }}
        >
          {/* The goal-anchored drawing the panel and the Desk show. The
              card's width is `spineFill`, sized against the shelf's longest
              project; inside it the Parts, their Sections and the hatched
              unused capacity draw as one shape. No deltas at 8px, where
              there is no room to read them. */}
          <SpineGlyph
            structure={content.structure}
            stats={spineStats}
            title={title}
            fill={spineFill(content.words, shelfMaxWords)}
            goal={content.goal}
          />
        </div>
      )}

      {state === "gone" ? (
        <>
          <p className="project-note">
            {t(isLocal ? "library.goneLocal" : "library.goneDrive")}
          </p>
          {isLocal && (
            <p className="project-hint">{t("library.goneLocalHint")}</p>
          )}
        </>
      ) : state === "unreadable" ? (
        <p className="project-note">
          {card.problem ?? t("library.unreadable")}
        </p>
      ) : state === "blocked" ? (
        content ? (
          stats()
        ) : (
          // A blocked card's note says only which side the book lives on;
          // the shelf banner names the cause.
          <p className="project-note">
            {t(isLocal ? "library.locked" : "library.driveDisconnectedNote")}
          </p>
        )
      ) : (
        stats()
      )}

      {/* No per-card reconnect button: one lapsed connection would print the
          same button on every card. The banner above the shelf names the
          cause and carries the action.

          Remove renders for every gone card, whatever the provider: it is the
          one action a vanished project's card still owns. */}
      {state === "gone" && (
        <div className="project-actions">
          <Button
            variant="outline"
            className="ui-btn-sm"
            onClick={() => onForget(ref)}
          >
            {t("library.remove")}
          </Button>
        </div>
      )}

      {/* A kebab whose every item is already a visible control is noise: on
          a gone card a menu of exactly `forget` duplicates Remove and does
          not appear. A menu holding more stays. One rule per state,
          never per provider. */}
      {items.length > 0 &&
        !(
          state === "gone" &&
          items.length === 1 &&
          items[0].id === "forget"
        ) && (
          <>
            <button
              ref={more}
              type="button"
              className="project-more"
              aria-haspopup="menu"
              aria-expanded={menu.open}
              aria-label={t("library.actionsFor", { title })}
              onClick={(event) => menu.toggle(event.currentTarget)}
            >
              <Icon name={appIcons.menu} size={15} />
            </button>
            <Menu
              open={menu.open}
              onClose={menu.close}
              anchor={menu.anchor}
              label={t("library.actionsFor", { title })}
              items={items}
            />
          </>
        )}
    </article>
  );
});
