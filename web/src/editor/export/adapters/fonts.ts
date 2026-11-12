// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The PDF writer's fonts, fetched from the app's own origin
// (`public/fonts/export/`) and never from a font service: an export reaches
// no third party. The name is one of the fixed file names `pdf.ts` asks for,
// so it is checked against that shape before it becomes a path.

const FONT_FILE = /^[A-Za-z]+-(Regular|Bold|Italic|BoldItalic)\.ttf$/;

export async function fetchExportFont(file: string): Promise<Uint8Array> {
  if (!FONT_FILE.test(file)) throw new Error("export-font-name");
  const response = await fetch(
    `${import.meta.env.BASE_URL}fonts/export/${file}`,
  );
  if (!response.ok) throw new Error("export-font-unavailable");
  return new Uint8Array(await response.arrayBuffer());
}
