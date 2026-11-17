// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { setInnerHtml } from "../security/trustedHtml";
import { Icon } from "../ui";
import { appIcons } from "../ui/appIcons";
import { appLog } from "../log";
import type { ViewHost } from "./views/view/port";

// What the writing view needs of the app, which the editor core may not
// import: the plane, the keyboard, the app's Trusted Types sink and the kit's
// chevron for the typewriter's station.

/** The kit's chevron, drawn on each side of the typewriter's station. */
export function guideMark(className: string) {
  return <Icon name={appIcons.expand} size={22} className={className} />;
}

/** The unhandled inputs already logged this page, as "type:cancelable". */
const unhandled = new Set<string>();

/**
 * An input the writing view does not handle, as one log line for each kind:
 * the browser repeats it, and a type is a fixed name, never the text.
 */
export function unhandledInput(inputType: string, cancelable: boolean): void {
  const kind = `${inputType}:${String(cancelable)}`;
  if (unhandled.has(kind)) return;
  unhandled.add(kind);
  appLog.warn(
    "editor",
    "An input the editor does not handle was left to the browser.",
    { inputType, cancelable },
  );
}

/** The view's host, built again only when the plane or the keyboard moves. */
export function useViewHost(phone: boolean, keyboardInset: number): ViewHost {
  return useMemo(
    () => ({
      phone,
      keyboardInset,
      setHtml: setInnerHtml,
      guideMark,
      unhandledInput,
    }),
    [phone, keyboardInset],
  );
}
