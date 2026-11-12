// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { demoRoutes } from "./App";

// Pins the demo site's route table: a path added here is a page the public
// site serves, so the list is exact.

describe("the demo site's routes", () => {
  it("serve the landing, two legal pages, the demo editor and not-found only", () => {
    const paths = (demoRoutes[0]?.children ?? []).map((route) => route.path);
    expect(paths).toEqual(["/", "/legal", "/privacy", "/app/editor/demo", "*"]);
  });
});
