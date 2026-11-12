// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { setInnerHtml } from "../security/trustedHtml";
import { Icon } from "../ui";
import { appIcons } from "../ui/appIcons";
import type { ViewHost } from "./views/view/port";

// What the writing view needs of the app, which the editor core may not
// import: the plane, the keyboard, the app's Trusted Types sink and the kit's
// chevron for the typewriter's station.

/** The kit's chevron, drawn on each side of the typewriter's station. */
export function guideMark(className: string) {
  return <Icon name={appIcons.expand} size={22} className={className} />;
}

/** The view's host, built again only when the plane or the keyboard moves. */
export function useViewHost(phone: boolean, keyboardInset: number): ViewHost {
  return useMemo(
    () => ({ phone, keyboardInset, setHtml: setInnerHtml, guideMark }),
    [phone, keyboardInset],
  );
}
