// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DPR, SURFACES, areaOf } from "./surfaces";

// After a capture: the size of every surface's picture, its crop alone when it
// has one, which the landing page sets on each image so nothing moves as it
// loads. The pictures themselves are found by name,
// `<family>-<variant>-<surface>.webp`.

const DIR = fileURLToPath(
  new URL("../../src/webapp/entry/landing/", import.meta.url),
);

export default function writeManifest(): void {
  const surfaces = Object.fromEntries(
    SURFACES.map((s) => {
      const { width, height } = areaOf(s);
      return [s.id, { width: width * DPR, height: height * DPR }];
    }),
  );
  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    `${DIR}shots.json`,
    `${JSON.stringify({ surfaces }, null, 2)}\n`,
  );
}
