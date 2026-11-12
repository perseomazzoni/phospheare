// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import product from "../../product.json" with { type: "json" };

// The product's public name, and every form of it the app uses.
//
// "Phospheare" is the working name of the project: the repository, packages,
// modules, code identifiers and CSS classes carry it, and nothing that reaches
// a person's machine does. What a person can see (copy, titles, the files and
// folders the app writes, export metadata) carries the public name, which
// lives in one place: `product.json` at the repository root. What the browser
// only keeps (cookies, storage keys, the database, channel and window names)
// carries no name at all. A release rebrands by editing that file and
// rebuilding.
//
// Only the name is stored. Every other form is derived here, because a stored
// kebab or Pascal form is a second copy that drifts when someone renames the
// product and forgets it. Copy reaches the name through i18next's
// `{{product}}` default variable (`i18nOptions.ts`); code imports `PRODUCT`.

export interface ProductNames {
  /** As written in `product.json`. Copy, titles, metadata. */
  name: string;
  /** Lowercase words joined by "-": hidden folders, URNs. */
  kebab: string;
  /** Capitalised words run together: the folder in a remote's storage. */
  pascal: string;
  /** Lowercase words run together: wherever no separator is allowed. */
  flat: string;
  /** Uppercase words joined by spaces. */
  upper: string;
  /** Lowercase words joined by spaces. */
  lower: string;
}

/**
 * The ASCII words of a name. Diacritics are folded away (`"NFKD"`, then
 * every combining mark dropped) and anything that is not an ASCII letter or
 * digit splits, so every derived form is plain ASCII, safe in a path or a URN.
 */
function words(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== "");
}

export function productNames(raw: unknown): ProductNames {
  const name = typeof raw === "string" ? raw.trim() : "";
  const parts = words(name);
  // A name with no ASCII form is a build error, not something to default
  // quietly: a fallback here would be the second copy this module exists to
  // prevent.
  if (parts.length === 0) {
    throw new Error(
      "product.json must give the product a name with at least one letter or digit that has an ASCII form.",
    );
  }
  const lowerParts = parts.map((w) => w.toLowerCase());
  return {
    name,
    kebab: lowerParts.join("-"),
    pascal: lowerParts.map((w) => w[0].toUpperCase() + w.slice(1)).join(""),
    flat: lowerParts.join(""),
    upper: name.toUpperCase(),
    lower: name.toLowerCase(),
  };
}

export const PRODUCT: ProductNames = productNames(product.name);

/** The placeholder `index.html` writes wherever the product's name goes. */
export const PRODUCT_NAME_PLACEHOLDER = "%PRODUCT_NAME%";

/**
 * Fill the product's name into `index.html` (the `product-name` plugin in
 * `vite.config.ts`). It is escaped because two of the three placeholders sit
 * inside attribute values, and a name is a release's choice of text, not
 * markup.
 */
export function injectProductName(html: string, name = PRODUCT.name): string {
  const escaped = name
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return html.split(PRODUCT_NAME_PLACEHOLDER).join(escaped);
}
