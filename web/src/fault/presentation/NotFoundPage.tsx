// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { faults, updateReady } from "../compose";
import FaultScreen from "./FaultScreen";
import { useFaultHome } from "./faultHome";

const NOT_FOUND = { kind: "not-found" } as const;

/**
 * An address that leads nowhere. It says so instead of moving the writer to
 * the home page, which would hide a mistyped or outdated link behind a page
 * they did not ask for.
 */
export default function NotFoundPage() {
  const home = useFaultHome();
  return (
    <FaultScreen
      fault={NOT_FOUND}
      home={home}
      onReload={faults.reload}
      onShown={updateReady.pageShown}
    />
  );
}
