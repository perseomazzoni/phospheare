// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import type { SelectOption } from "../ui";
import { SHAPE_IDS, type ShapeId } from "../project/startingShape";

// The structures a project can name, shared by the create wizard and the
// Properties window, so the list cannot differ between creation and later.

/** Every starting structure, "No structure" first. */
export function shapeOptions(t: TFunction): SelectOption<ShapeId>[] {
  return SHAPE_IDS.map((id) => ({ value: id, label: t(`create.shape.${id}`) }));
}
