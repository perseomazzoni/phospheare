// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The log's page, for the router alone. It has its own entry so that code
// which writes lines does not import a page (see `index.ts`).

export { default as LogSheet } from "./presentation/LogSheet";
