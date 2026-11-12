// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import i18n, { type TFunction } from "i18next";
import en from "../../locales/en.json";
import it from "../../locales/it.json";
import { interpolation } from "../../locales/i18nOptions";

// The fault pages' words, readable whether or not the app's i18n started. A
// failure can arrive before `initI18n` resolves, or be its rejection, and
// `useTranslation` suspends on an instance that has not finished starting, so
// a page that used it would hang instead of saying anything.
//
// Without the app's instance, the words come from a private instance over the
// same bundled files, in the language `initI18n` already wrote onto `<html>`,
// else the browser's.

const resources = { en: { translation: en }, it: { translation: it } };

let own: TFunction | null = null;

function language(): string {
  const candidates = [
    document.documentElement.lang,
    navigator.language?.split("-")[0],
  ];
  return candidates.find((lng) => !!lng && lng in resources) ?? "en";
}

function privateT(): TFunction {
  if (own) return own;
  const instance = i18n.createInstance();
  // `initAsync: false` loads the inline resources before `init` returns, so
  // `t` answers on the next line.
  void instance.init({
    resources,
    lng: language(),
    fallbackLng: "en",
    interpolation,
    initAsync: false,
  });
  own = instance.t.bind(instance) as TFunction;
  return own;
}

/** Translates a fault page string with the app's i18n, or without it. */
export function faultT(key: string, options?: Record<string, unknown>): string {
  const t = i18n.isInitialized ? i18n.t.bind(i18n) : privateT();
  return String(t(key, options));
}
