// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { mergeConfig } from "vitest/config";
import webConfig from "./vite.config";

// The export matrix (`scripts/export-matrix.dump.ts`) writes every format in
// every layout of the demo book to disk for EPUBCheck and an office suite. It
// is a tool, so it never joins the normal suite; this config is its only way
// in.
export default mergeConfig(webConfig, {
  test: { include: ["scripts/export-matrix.dump.ts"] },
});
