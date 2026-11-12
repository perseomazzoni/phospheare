// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import { useRouteError } from "react-router";
import { Dots } from "../../ui";
import { faults, updateReady } from "../compose";
import FaultScreen from "./FaultScreen";
import { useFaultHome } from "./faultHome";
import { faultT } from "./faultCopy";

/**
 * The route tree's error boundary: what any screen's failure leaves the writer
 * on, in place of the router's own page, which prints the message and the
 * stack.
 *
 * A stale build reloads the tab once by itself. The editor's chunk is the
 * likeliest to go: a tab opened before a deploy asks for a file the new build
 * does not have. The reload runs in an effect, since a render must not
 * navigate; until it lands the page shows the boot dots, not a fault.
 *
 * It does not report. React's root hooks see every caught error, so a report
 * here would log each failure twice.
 */
export default function RouteFault() {
  const error = useRouteError();
  const home = useFaultHome();
  const fault = faults.read(error);
  const [reloading, setReloading] = useState(() => faults.reloadsItself(fault));

  useEffect(() => {
    if (reloading && !faults.reloadOnce(fault)) setReloading(false);
    // Once per failure: the fault is read from the same error on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  if (reloading)
    return (
      <div className="app-boot">
        <Dots label={faultT("app.loading")} />
      </div>
    );

  return (
    <FaultScreen
      fault={fault}
      home={home}
      onReload={faults.reload}
      onShown={updateReady.pageShown}
    />
  );
}
