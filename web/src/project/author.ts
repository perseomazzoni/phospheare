// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef, StorageProvider } from "../storage";
import { readCheckedProperties } from "./editFacts";
import { factsOf, withFacts } from "./facts";
import { PROPERTIES_FILE } from "./naming";
import { serializeProperties } from "./properties";

// Saves a book's author from the export window: the title page about to be
// sent is where a writer notices a wrong byline.
//
// The file is read through `readCheckedProperties`, so a folder that is not a
// book is refused rather than written over. `withFacts` folds a typed name
// onto one bounded line, because the name travels into running heads and
// metadata, where a line break would break the page.

export async function setProjectAuthor(
  provider: StorageProvider,
  ref: ProjectRef,
  author: string,
): Promise<void> {
  const props = await readCheckedProperties(provider, ref);
  await provider.writeFile(
    ref,
    PROPERTIES_FILE,
    serializeProperties(withFacts(props, { ...factsOf(props), author })),
  );
}
