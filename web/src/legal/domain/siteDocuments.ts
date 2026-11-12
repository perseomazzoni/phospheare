// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The demo site's two legal texts, served at the full program's places for
// the notice and the privacy notice (`paths.ts`). The site has no accounts
// and no terms to accept, so it has no third text.

import { text, type LegalDocument } from "./documents";

/** What the site is, that the demo keeps nothing, and the warranty's limits. */
export const SITE_NOTICE: LegalDocument = {
  id: "notice",
  text: "siteNotice",
  sections: [
    { id: "site", blocks: [text("body")] },
    { id: "nothingSaved", blocks: [text("body")] },
    { id: "assistant", blocks: [text("body")] },
    { id: "asIs", blocks: [text("body")] },
    { id: "law", blocks: [text("body")] },
    { id: "license", blocks: [text("body")] },
    { id: "links", blocks: [text("body")] },
    { id: "language", blocks: [text("body")] },
  ],
};

/** The host's access logs, and the little the browser keeps for one tab. */
export const SITE_PRIVACY: LegalDocument = {
  id: "privacy",
  text: "sitePrivacy",
  sections: [
    { id: "controller", blocks: [text("body")] },
    { id: "logs", blocks: [text("body"), text("basis")] },
    {
      id: "contact",
      blocks: [
        text("body"),
        text("optional"),
        text("provider"),
        text("retention"),
      ],
    },
    // Its own section: the right to object is stated apart from the others.
    { id: "objection", blocks: [text("body")] },
    { id: "browser", blocks: [text("body")] },
    { id: "notCollected", blocks: [text("body")] },
    { id: "transfers", blocks: [text("body")] },
    { id: "rights", blocks: [text("body"), text("complaint")] },
    { id: "changes", blocks: [text("body")] },
  ],
};
