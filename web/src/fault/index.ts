// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a failure leaves the writer on. Code outside the module imports
// this file and nothing inside it, as `boundaries.test.ts` pins.

import { faults } from "./compose";

export { installFaultListeners, reactRootOptions } from "./compose";
export { setFaultRoute } from "./browser";
export { default as RouteFault } from "./presentation/RouteFault";
export { default as RootFault } from "./presentation/RootFault";
export { default as NotFoundPage } from "./presentation/NotFoundPage";
export { default as FaultScreen } from "./presentation/FaultScreen";
export { showBootFailure } from "./presentation/bootFailure";
export { useUpdateReady } from "./useUpdateReady";
/** Reloads the tab, for a control the writer pressed. */
export const { reload: reloadPage } = faults;
export { FaultHomeProvider, type FaultHome } from "./presentation/faultHome";
