// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExportFont } from "./fonts";

// Pins the PDF writer's font loading. The name becomes a path on the app's
// own origin, so the shape check is the whole guard: only
// `Family-Regular|Bold|Italic|BoldItalic.ttf` passes, and anything else is
// refused before a request exists, since a refusal after the fetch would
// already have asked the origin for the path. A font the origin cannot serve
// is a named failure the export window can state, never a PDF set in a
// missing face.

afterEach(() => vi.unstubAllGlobals());

function serving(response: Response) {
  const fetch = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("fetchExportFont", () => {
  it.each([
    "Literata-Regular.ttf",
    "Literata-Bold.ttf",
    "Literata-Italic.ttf",
    "Literata-BoldItalic.ttf",
  ])("fetches %s from the app's own fonts/export/", async (file) => {
    const fetch = serving(new Response(new Uint8Array([0x00, 0x01, 0xff])));
    expect(await fetchExportFont(file)).toEqual(
      new Uint8Array([0x00, 0x01, 0xff]),
    );
    expect(fetch).toHaveBeenCalledWith(`/fonts/export/${file}`);
  });

  it.each([
    "../secrets.ttf",
    "Literata-Regular.otf",
    "Literata-Light.ttf",
    "fonts/Literata-Regular.ttf",
    "https://fonts.example.com/Literata-Regular.ttf",
    "Literata-Regular.ttf?x=1",
    "Lite rata-Regular.ttf",
    "-Regular.ttf",
    "",
  ])("refuses %j without a request", async (file) => {
    const fetch = serving(new Response(""));
    await expect(fetchExportFont(file)).rejects.toThrow("export-font-name");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names a font the origin cannot serve", async () => {
    serving(new Response("not found", { status: 404 }));
    await expect(fetchExportFont("Literata-Regular.ttf")).rejects.toThrow(
      "export-font-unavailable",
    );
  });
});
