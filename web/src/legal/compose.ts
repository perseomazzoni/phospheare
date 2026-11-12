// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The legal texts this build serves, in the order the links list them. The
// pages, the links and the notice's popup read only this file; `build:demo`
// replaces it with `compose.demo.ts`.

import { NOTICE, PRIVACY, TERMS, type LegalDocument } from "./domain/documents";

export const LEGAL_SET: readonly LegalDocument[] = [NOTICE, PRIVACY, TERMS];

/** The disclaimer, which the landing and the Library open as a popup. */
export const LEGAL_NOTICE: LegalDocument = NOTICE;
