// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Icon, type IconName } from "./icons";

// Small parts: pieces too small to each own a file, and too different from
// each other to share one component.

/** A keyboard shortcut, as printed on a key. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ui-kbd">{children}</kbd>;
}

/**
 * Why a choice that exists cannot be taken here ("Requires a Google
 * account").
 */
export function Reason({ children }: { children: React.ReactNode }) {
  return <span className="ui-reason">{children}</span>;
}

/**
 * A placeholder for content that is on its way, used only where nothing is
 * known yet. Where something is known, such as a project seen before, the card
 * shows the remembered content, because a shimmering bar where a real title is
 * about to appear is a worse answer than the title already in hand.
 */
export function Skeleton({
  width,
  height = 12,
  className,
}: {
  width?: number | string;
  height?: number;
  className?: string;
}) {
  return (
    <span
      className={["ui-skeleton", className ?? ""].filter(Boolean).join(" ")}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: `${height}px`,
      }}
      aria-hidden
    />
  );
}

/**
 * `quiet` is a banner whose condition has cleared but whose action still
 * stands, such as a failed answer whose key is ready again and still offers
 * Try again. It keeps the box's geometry and neutral hairline and drops every
 * colour, so an ember strip turns to bare paper in place and the change is
 * seen, not read.
 */
export type BannerTone = "info" | "attention" | "problem" | "quiet";

/**
 * A standing condition the writer should deal with eventually: lapsed Remote
 * Storage connection, a copy still running. A toast announces something that
 * already happened and leaves, and a dialog stops everything; a banner waits.
 */
export function Banner({
  tone = "info",
  icon,
  children,
  action,
}: {
  tone?: BannerTone;
  icon?: IconName;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`ui-banner ui-banner-${tone}`}
      // A problem interrupts a screen reader; every other tone is read when
      // the reader reaches it.
      role={tone === "problem" ? "alert" : "status"}
    >
      {icon && <Icon name={icon} size={16} />}
      <span className="ui-banner-text">{children}</span>
      {action}
    </div>
  );
}
