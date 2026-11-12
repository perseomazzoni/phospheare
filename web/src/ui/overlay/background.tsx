// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { createContext, useContext, useMemo, type RefObject } from "react";

// What goes out of reach behind a modal. A scrim dims the page; it does not
// make it unreachable. Without `inert` the background stays tabbable,
// clickable through gaps, and fully available to a screen reader, which reads
// out a shelf of projects behind a dialog meant to block everything.
//
// The shell names the background element once, and every overlay under it
// inherits the answer. The alternative, an overlay walking up from its portal
// to guess which siblings are the app, breaks the first time anything else is
// portalled to `<body>`.
//
// The toast host stays outside whatever is registered here. An Undo must stay
// clickable while a sheet is open, because the toast is often the reason the
// sheet was opened.

type Background = () => HTMLElement[];

const NONE: Background = () => [];

const BackgroundContext = createContext<Background>(NONE);

export function OverlayBackgroundProvider({
  value,
  children,
}: {
  /** The element to put out of reach. Read at open time, not at render time. */
  value: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const get = useMemo<Background>(
    () => () => (value.current ? [value.current] : []),
    [value],
  );
  return (
    <BackgroundContext.Provider value={get}>
      {children}
    </BackgroundContext.Provider>
  );
}

/** Empty outside a provider, so an overlay there only traps focus. */
export function useOverlayBackground(): Background {
  return useContext(BackgroundContext);
}
