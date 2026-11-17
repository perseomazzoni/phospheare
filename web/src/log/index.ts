// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The app's log, kept in this browser for 14 days. Code outside the module
// imports this file, or `page.ts` for the page, and nothing else inside it,
// as `boundaries.test.ts` pins.
//
// A line holds no personal value: the call site writes none, and the
// redaction removes what slips through. The writer account id is the one
// exception, so a log someone sends can be matched to their account.
//
// The page is not exported here. Code that only writes lines, such as the
// sync queue, would otherwise import the page and, through it, the account
// context and the storage index.

export { appLog, installLog } from "./compose";
export { describe as describeError, type Fields } from "./application/logger";
