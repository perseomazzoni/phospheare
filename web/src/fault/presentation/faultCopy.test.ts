// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// Pins that the fault pages have words before the app's i18n starts, in the
// language already on `<html>`, with the product name filled in.

afterEach(() => {
  vi.resetModules();
  document.documentElement.lang = "";
});

describe("fault copy", () => {
  it("answers in English without the app's i18n", async () => {
    const { faultT } = await import("./faultCopy");
    expect(faultT("fault.reload")).toBe("Reload");
  });

  it("answers in the language on the page", async () => {
    document.documentElement.lang = "it";
    const { faultT } = await import("./faultCopy");
    expect(faultT("fault.reload")).toBe("Ricarica");
  });

  it("fills in the product name", async () => {
    const { faultT } = await import("./faultCopy");
    expect(faultT("fault.boot.title")).not.toMatch(/\{\{/);
  });

  it("uses the app's i18n once it has started", async () => {
    const i18n = (await import("i18next")).default;
    await i18n.init({
      lng: "en",
      resources: { en: { translation: { fault: { reload: "Again" } } } },
    });
    const { faultT } = await import("./faultCopy");
    expect(faultT("fault.reload")).toBe("Again");
  });
});
