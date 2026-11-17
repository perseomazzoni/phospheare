// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The full program's three legal texts as structure: their sections in
// order, and each section's paragraphs, lists and tables. The words are the
// locale files' (`legal.<text>.<section>.*`); this file holds only ids, so a
// clause is moved or reworded in one place each. The demo site's two texts
// are in `siteDocuments.ts`; `legal/compose.ts` names the set a build serves.

export type LegalBlock =
  /** One paragraph, at `<section>.<key>`. */
  | { kind: "text"; key: string }
  /** A bulleted list, each item at `<section>.<key>.<item>`. */
  | { kind: "list"; key: string; items: readonly string[] }
  /**
   * A table: headers at `<section>.<key>.columns.<column>`, cells at
   * `<section>.<key>.rows.<row>.<column>`.
   */
  | {
      kind: "table";
      key: string;
      columns: readonly string[];
      rows: readonly string[];
    };

export interface LegalSection {
  /** Its title at `<section>.title`, and its anchor. */
  id: string;
  blocks: readonly LegalBlock[];
}

export type LegalDocumentId = "notice" | "privacy" | "terms";

export interface LegalDocument {
  /** The place it is served at (`paths.ts`). */
  id: LegalDocumentId;
  /** Its words, at `legal.<text>`. */
  text: string;
  sections: readonly LegalSection[];
  /** A closing paragraph under the last section, at `legal.<text>.closing`. */
  closing?: boolean;
}

export const text = (key: string): LegalBlock => ({ kind: "text", key });

/** The disclaimer: the license's sections 15 and 16, and what they extend to. */
export const NOTICE: LegalDocument = {
  id: "notice",
  text: "notice",
  sections: [
    { id: "asIs", blocks: [text("body")] },
    { id: "liability", blocks: [text("body")] },
    { id: "writing", blocks: [text("body")] },
    { id: "ai", blocks: [text("body")] },
    { id: "thirdParty", blocks: [text("body")] },
    { id: "law", blocks: [text("body")] },
    { id: "license", blocks: [text("copyright"), text("body")] },
  ],
  closing: true,
};

/** The local application's data flows and optional recipients. */
export const PRIVACY: LegalDocument = {
  id: "privacy",
  text: "privacy",
  sections: [
    { id: "controller", blocks: [text("body"), text("roles")] },
    { id: "notCollected", blocks: [text("body")] },
    {
      id: "data",
      blocks: [
        text("intro"),
        {
          kind: "table",
          key: "table",
          columns: ["what", "why", "where"],
          rows: [
            "account",
            "sessions",
            "preferences",
            "library",
            "documents",
            "storage",
            "ai",
            "transit",
            "desktop",
            "log",
          ],
        },
        text("required"),
      ],
    },
    {
      id: "retention",
      blocks: [
        {
          kind: "list",
          key: "list",
          items: ["account", "sessions", "removed", "aiKey", "sync", "log"],
        },
        text("cleanup"),
        text("deletion"),
        text("deleteAccount"),
        text("revoke"),
      ],
    },
    {
      id: "recipients",
      blocks: [
        {
          kind: "list",
          key: "list",
          items: ["identity", "ai", "search", "home", "updates"],
        },
        text("independent"),
      ],
    },
    { id: "transfers", blocks: [text("body")] },
    {
      id: "cookies",
      blocks: [
        text("intro"),
        {
          kind: "table",
          key: "table",
          columns: ["name", "purpose", "lifetime"],
          rows: ["session", "signIn", "storageConnect", "aiKey"],
        },
        text("device"),
      ],
    },
    { id: "rights", blocks: [text("body"), text("delete"), text("complaint")] },
    { id: "automated", blocks: [text("body")] },
    { id: "changes", blocks: [text("body")] },
  ],
};

/** The "Use and licence" page: what the licence allows, and what use costs. */
export const TERMS: LegalDocument = {
  id: "terms",
  text: "terms",
  sections: [
    { id: "scope", blocks: [text("body")] },
    {
      id: "account",
      blocks: [text("body"), text("storage"), text("providers")],
    },
    { id: "free", blocks: [text("body")] },
    { id: "writing", blocks: [text("body")] },
    { id: "use", blocks: [text("body")] },
    { id: "warranty", blocks: [text("body")] },
    {
      id: "aiKey",
      blocks: [text("body"), text("spending"), text("revocation")],
    },
    { id: "suspension", blocks: [text("body")] },
    { id: "changes", blocks: [text("body")] },
    { id: "language", blocks: [text("body")] },
  ],
};
