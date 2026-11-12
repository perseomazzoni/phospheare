// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";

// The kit's settings rows, as the Settings sheet's panes draw them: a section
// under its head, and its pairs, each a name at the leading edge and its
// control flush to the trailing one (`webapp.css`, `.setting-*`). A pair
// that only stands while another is on is a sub-pair, set in under it.

/** A section of a pane: its head, then whatever the section holds. */
export function SettingSection({
  title,
  className,
  children,
}: {
  title: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function SettingPairs({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["setting-pairs", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

/**
 * One pair: its name, with a quieter line under it when the name alone does
 * not say what the control does, then the control.
 */
export function SettingPair({
  label,
  note,
  sub,
  className,
  children,
}: {
  label: ReactNode;
  note?: ReactNode;
  sub?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={["setting-pair", sub ? "setting-sub" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <span>
        {label}
        {note ? <small>{note}</small> : null}
      </span>
      {children}
    </div>
  );
}
