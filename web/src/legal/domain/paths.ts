// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { LegalDocumentId } from "./documents";

/**
 * Where each legal text has a public page. Public because the sign-in
 * provider's consent screen links the privacy notice and the terms, and a
 * visitor reads them before any account exists.
 */
export const LEGAL_PATHS: Record<LegalDocumentId, string> = {
  notice: "/legal",
  privacy: "/privacy",
  terms: "/terms",
};
