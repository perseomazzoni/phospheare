// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's `compose.ts`: `build:demo` resolves every import of
// `compose.ts` to this file (`build/demoBuild.ts`, `DEMO_TWINS`). The site
// serves its own notice and privacy notice, and no terms.

import type { LegalDocument } from "./domain/documents";
import { SITE_NOTICE, SITE_PRIVACY } from "./domain/siteDocuments";

export const LEGAL_SET: readonly LegalDocument[] = [SITE_NOTICE, SITE_PRIVACY];

export const LEGAL_NOTICE: LegalDocument = SITE_NOTICE;
