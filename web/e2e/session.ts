// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Page } from "@playwright/test";

// Opens the app signed in. The account is a record in this origin's
// localStorage (`writers/registry.ts`) beside the mark that says it
// is signed in, so `signIn` seeds both before the first script of every
// document runs, and the landing never shows.
//
// Each test runs in a fresh browser context with empty storage, so no test
// sees another's account, library or preferences, and nothing is reset
// between tests.

/** Every test's account: one fixed id, inside the registry's id rule. */
export const WRITER_ID = "e2e-writer-0000000000000001";

/**
 * Seeds the account, signed in. The records are written only when absent, so
 * a reload keeps whatever the test changed since.
 *
 * The identity service's session binding is answered here, so the run
 * needs no identity service behind the dev server's proxy.
 *
 * Call it before the first `goto`.
 */
export async function signIn(page: Page, name = "E2E Writer"): Promise<void> {
  await page.route("**/identity/session", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { proof: "e2e-session-proof" } })
      : route.fulfill({ json: { writerId: null } }),
  );
  await page.addInitScript(
    ({ id, name }) => {
      if (localStorage.getItem("accounts") === null)
        localStorage.setItem(
          "accounts",
          JSON.stringify([
            {
              id,
              createdAt: new Date().toISOString(),
              google: {
                iss: "https://accounts.google.com",
                sub: "e2e-google-writer",
                email: "writer@example.test",
                emailVerified: true,
                name,
                picture: null,
              },
              drive: null,
            },
          ]),
        );
      if (localStorage.getItem("signedIn") === null)
        localStorage.setItem("signedIn", id);
    },
    { id: WRITER_ID, name },
  );
}
