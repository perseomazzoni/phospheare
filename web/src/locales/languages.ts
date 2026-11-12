// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

export interface AppLanguage {
  value: string;
  label: string;
}
export const APP_LANGUAGES: readonly AppLanguage[] = [
  { value: "en", label: "English" },
  { value: "it", label: "Italiano" },
];
export const DOCUMENT_LANGUAGES: readonly AppLanguage[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
];
export function languageLabel(code: string): string {
  return (
    DOCUMENT_LANGUAGES.find((l) => l.value === code)?.label ??
    APP_LANGUAGES.find((l) => l.value === code)?.label ??
    code
  );
}
