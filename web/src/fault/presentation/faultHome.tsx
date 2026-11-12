// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { createContext, useContext } from "react";

/** Where a fault page's way back leads. */
export type FaultHome = "library" | "landing";

// The hook the app root supplies to answer it: the full program reads the
// session, so a signed-in writer goes back to the Library. With no provider
// the way back is the home page, which every build has. A context holds a
// hook rather than a value so the answer is read where the page renders; the
// root passes one function for the app's lifetime, which keeps the hook
// order stable.
const FaultHomeContext = createContext<() => FaultHome>(() => "landing");

export const FaultHomeProvider = FaultHomeContext.Provider;

/** Where this page's way back leads, by the root's answer. */
export function useFaultHome(): FaultHome {
  return useContext(FaultHomeContext)();
}
