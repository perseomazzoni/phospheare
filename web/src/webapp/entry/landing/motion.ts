// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { createContext, useContext } from "react";

/** One pause choice for every automatic demonstration on the page. */
export const LandingMotionContext = createContext(false);

export function useLandingMotion() {
  return useContext(LandingMotionContext);
}
