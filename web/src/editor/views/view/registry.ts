// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The view registry: the shell picks a writing view by name. An unknown name
// is a programming error, so the lookup throws rather than rendering nothing.

import type { ForwardRefExoticComponent, RefAttributes } from "react";
import type { WritingViewHandle, WritingViewProps } from "./port";
import { ScrollView } from "./adapters/scroll";
import { TypewriterView } from "./adapters/typewriter";

export type ViewName = "scroll" | "typewriter";

export type WritingViewComponent = ForwardRefExoticComponent<
  WritingViewProps & RefAttributes<WritingViewHandle>
>;

const views = new Map<string, WritingViewComponent>();

export function registerView(
  name: string,
  component: WritingViewComponent,
): void {
  views.set(name, component);
}

export function viewFor(name: string): WritingViewComponent {
  const component = views.get(name);
  if (!component) {
    throw new Error(
      `No editor view registered under "${name}" — add it to editor/views/view/registry.ts`,
    );
  }
  return component;
}

registerView("scroll", ScrollView);
registerView("typewriter", TypewriterView);
