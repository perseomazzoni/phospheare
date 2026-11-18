// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import it from "./it.json";
import { preferences } from "../preferences/compose";
import { addFormatters, interpolation } from "./i18nOptions";

const resources = {
  en: { translation: en },
  it: { translation: it },
};

/**
 * The `lang` attribute on `<html>` sets the language a screen reader
 * speaks. `index.html` ships it as `en`, so the page re-declares it every
 * time i18n resolves a language; otherwise an Italian writer's controls are
 * voiced in English while every string is Italian.
 *
 * A sync, not a set: it is idempotent and runs on every path that resolves a
 * language (init, `setLanguage`, the re-derive on sign-in and sign-out), and
 * any one of them may be the last word.
 */
function syncDocumentLang(lng: string): void {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
}

/**
 * Stored choice first, then the browser's preference, then English. The
 * stored choice is one of the app's preferences, beside the theme and the
 * editor settings; in the full program it follows the writer to their other
 * devices while Remote Storage is connected.
 */
function detectLanguage(): string {
  const saved = preferences.getPref<string | null>("language", null);
  if (saved && saved in resources) return saved;
  const preferred = navigator.language?.split("-")[0];
  return preferred && preferred in resources ? preferred : "en";
}

export function setLanguage(lng: string): void {
  preferences.setPref("language", lng);
  syncDocumentLang(lng);
  void i18n.changeLanguage(lng);
}

/**
 * `lng` fixes the language instead of detecting it: the demo site's
 * prerender renders its pages in English in Node, where there is no
 * browser preference to read.
 */
export async function initI18n(lng = detectLanguage()): Promise<void> {
  syncDocumentLang(lng);

  await i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: "en",
    interpolation,
  });
  addFormatters(i18n);
}

// Re-derived on every account change, as the theme is. On sign-in,
// `detectLanguage` read the snapshot from before auth answered, which may be
// another account's last language. On sign-out, `getPref` returns its
// fallback with no user, so the language falls back to the browser's own
// preference, as for a visitor who never signed in. Both are the same call;
// only the answer differs.
preferences.onUserChange(() => {
  const lng = detectLanguage();
  syncDocumentLang(lng);
  if (lng !== i18n.language) void i18n.changeLanguage(lng);
});
