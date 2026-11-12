// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { i18n as I18n } from "i18next";
import { PRODUCT } from "../product";

// What every i18next instance in the app shares. It is separate from
// `i18n.ts` so the locale tests can render strings as the app does without
// importing the language detection and account-change wiring that sit beside
// the real instance.

/**
 * `product` is a default variable rather than a word in the locale files,
 * because the product's public name is set per release in `product.json`.
 * No string in either language spells it out, and `locales.test.ts` holds
 * both files to that.
 *
 * `storage` is the display name of the connected remote storage provider.
 * The copy never spells a vendor: it says Remote Storage, and reaches for
 * `{{storage}}` only where the writer acts inside the provider's own screens
 * (its bin, its permission page). With one provider registered, the default
 * is its label; a second provider requires this to follow the connected one,
 * as `driveProvider.label()` names it.
 *
 * `searchProvider` is the same rule for the web-search provider: the copy
 * says "a model provider" where any would do, and names the provider only
 * where it says where the writer's words went (`dock.web.note.web_*`,
 * `dock.web.reask.*`). With one search provider, the default is its name; a
 * second requires this to follow the connected one. The model provider itself
 * is never a default: the transit notes take the live host as `{{provider}}`.
 *
 * `localProvider` is the on-device model runtime, under the same rule: its
 * name appears only where the writer acts on it (install it, start it, its
 * address). With one runtime, the default is its name; a second requires
 * the configured one here.
 */
export const interpolation = {
  escapeValue: false,
  defaultVariables: {
    product: PRODUCT.name,
    storage: "Google Drive",
    searchProvider: "OpenRouter",
    localProvider: "Ollama",
  },
};

/**
 * Formatters a locale string can name, e.g. `{{product, uppercase}}` for a
 * label set in capitals. Each one is registered on whichever
 * instance the caller has initialised.
 */
export function addFormatters(instance: I18n): void {
  instance.services.formatter?.add("uppercase", (value: unknown) =>
    String(value).toUpperCase(),
  );
}
