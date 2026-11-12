// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { brokenMarkElement } from "../../brand/brokenMarkElement";
import { faults } from "../compose";
import { faultT } from "./faultCopy";

// The page for a start-up that failed before React mounted, such as a
// rejected `initI18n` or a missing `#root`. React is not running, so it is
// built from DOM calls: `textContent` and `createElement`, because Trusted
// Types refuse a string handed to `innerHTML`.
//
// It carries the page shell's classes, which a loaded theme paints, under the
// brand's figure with its spark going out, as every broken page does. When no
// theme sheet has loaded, the system colours stand in, so the words are never
// default black on a page that the browser draws dark.

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Reports `error` and replaces the mount point's content with the page. */
export function showBootFailure(error: unknown): void {
  faults.report(error, "boot");

  const page = element("div", "page fault-page");
  page.dataset.fault = "boot";
  if (!document.documentElement.dataset.theme) {
    document.documentElement.style.colorScheme ||= "light dark";
    page.style.background = "Canvas";
    page.style.color = "CanvasText";
  }

  const inner = element("div", "page-inner narrow");
  const title = element("h1", "page-title", faultT("fault.boot.title"));
  title.tabIndex = -1;
  const hint = element("p", "page-hint", faultT("fault.boot.hint"));
  const actions = element("div", "page-actions");
  const reload = element(
    "button",
    "ui-btn ui-btn-primary",
    faultT("fault.reload"),
  );
  reload.type = "button";
  reload.addEventListener("click", () => faults.reload());

  actions.append(reload);
  inner.append(brokenMarkElement(56), title, hint, actions);
  page.append(inner);
  (document.getElementById("root") ?? document.body).replaceChildren(page);
  title.focus();
}
