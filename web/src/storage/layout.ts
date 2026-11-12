// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { PRODUCT } from "../product";

// The one folder name every remote storage uses: a folder at the storage
// root, with projects as its direct children. No adapter spells its own.
//
// The writer sees this folder, so it carries the product's public name from
// `product.json`, never the internal one, in Pascal form with no spaces: a
// remote addressed by path or URL would have to encode a space. A release
// that changes the name stops finding the folder made under the earlier one,
// and leaves that folder where it is.
//
// Local disk has no such folder: the folder the writer picks is the root.

export const APP_DIR = PRODUCT.pascal;
