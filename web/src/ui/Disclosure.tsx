// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useState, type ReactNode } from "react";
import { Icon } from "./icons";

// Something kept folded until it is asked for. A native `<details>`, because
// the platform gets the hard parts right: Enter and Space toggle it, a screen
// reader announces it as expanded or collapsed, find-in-page opens it on a
// match, and it works with no script. Only its look is replaced: the platform
// triangle is hidden in the stylesheet and the app's chevron is drawn in the
// markup, pointing at the line at rest and down at what it opened.
//
// Uncontrolled: the writer owns whether it is open. `defaultOpen` is where it
// starts, never where it is held.
//
// `label` names the control when what it shows is not a name a screen reader
// can hear, such as a summary drawn wholly `aria-hidden`, as a live run line
// is so the panel's one live region is not spoken twice. It is a noun,
// never a verb: the platform says "collapsed" or "expanded" after it, and
// "Show the steps, expanded" is wrong half the time.
//
// `lazy` builds the contents the first time the fold opens and keeps them: an
// import's chapter list has a fold per chapter, each holding every paragraph,
// and a hundred unopened folds should cost nothing. Find-in-page cannot open
// a fold whose text is not there yet, so it is opt-in, for folds that hold
// controls rather than reading.

export default function Disclosure({
  summary,
  children,
  className,
  label,
  defaultOpen = false,
  lazy = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  label?: string;
  defaultOpen?: boolean;
  lazy?: boolean;
}) {
  const [opened, setOpened] = useState(defaultOpen);
  // React writes `open` on mount and again only if the prop itself changes;
  // a writer's toggle in between is the element's own state.
  return (
    <details
      className={["ui-disclosure", className ?? ""].filter(Boolean).join(" ")}
      open={defaultOpen || undefined}
      onToggle={
        lazy
          ? (event) => {
              if (event.currentTarget.open) setOpened(true);
            }
          : undefined
      }
    >
      <summary aria-label={label}>
        <Icon
          className="ui-disclosure-caret"
          name="chevron"
          size={11}
          aria-hidden="true"
        />
        <span>{summary}</span>
      </summary>
      <div className="ui-disclosure-body">
        {!lazy || opened ? children : null}
      </div>
    </details>
  );
}
