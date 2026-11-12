// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import i18next from "i18next";
import en from "../locales/en.json";
// Aliased: `it` is vitest's own.
import itLocale from "../locales/it.json";
import { interpolation } from "../locales/i18nOptions";

// Pins the device notices' strings against real i18next, in both languages.
// `DeviceNotice.test.tsx` mocks `t`, so it can pin only which key is asked for
// with which count; plural selection belongs to i18next and the locale data.
// Every `_one` form interpolates `{{count}}` rather than spelling the digit.

async function t(lng: "en" | "it") {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng,
    resources: { en: { translation: en }, it: { translation: itLocale } },
    interpolation,
  });
  return i18n.t.bind(i18n);
}

// The plural forms, filled in by hand, so an expectation does not come from
// the plural rules under test.
const formsIn = (lng: "en" | "it") => (lng === "en" ? en : itLocale).app;
const filled = (form: string, count: number) =>
  form.replace("{{count}}", String(count));

// A zero count is never shown: `useDeviceWork` answers null for no held
// files, and `DeviceNotice` draws no lost pill at zero. Both are pinned
// there; i18next itself would render "0 files".

describe.each(["en", "it"] as const)("app.onlyOnDevice in %s", (lng) => {
  const forms = formsIn(lng);

  it("selects the singular form at 1, and the plural form differs", async () => {
    const translate = await t(lng);
    const one = translate("app.onlyOnDevice", { count: 1 });
    expect(one).toBe(filled(forms.onlyOnDevice_one, 1));
    expect(one).not.toBe(filled(forms.onlyOnDevice_other, 1));
  });

  it.each([2, 11, 1000])(
    "selects the plural form at %i, with the count in it",
    async (count) => {
      const translate = await t(lng);
      const many = translate("app.onlyOnDevice", { count });
      expect(many).toBe(filled(forms.onlyOnDevice_other, count));
    },
  );

  it("keeps the one-line character budget at four digits", async () => {
    // A character budget, not a measurement: at most 34 characters in
    // English and 40 in Italian were measured once at 13px against the 343px
    // narrow plane. The notice is one line on every plane, and a longer
    // string wraps or clips.
    const translate = await t(lng);
    const rendered = translate("app.onlyOnDevice", { count: 1000 });
    expect(rendered.length).toBeLessThanOrEqual(lng === "en" ? 34 : 40);
  });

  it("resolves the numberless face to real prose", async () => {
    const translate = await t(lng);
    const announced = translate("app.onlyOnDeviceAnnounce");
    expect(announced.length).toBeGreaterThan(0);
    // A missing key resolves to the key itself, which a live region would
    // read aloud.
    expect(announced).not.toBe("app.onlyOnDeviceAnnounce");
    // The announced sentence takes a period; the pill's faces, like the rest
    // of the column, do not.
    expect(announced.endsWith(".")).toBe(true);
    expect(translate("app.offline").endsWith(".")).toBe(false);

    // There is no `app.onlyOnDeviceDone`: the column says only what is wrong,
    // and the save chip's tick says what is right. A key with no caller is a
    // string a translator still maintains.
    expect(translate("app.onlyOnDeviceDone")).toBe("app.onlyOnDeviceDone");
  });

  it("names no backend anywhere — the state is about the kind, not which one", async () => {
    // These strings describe a fact about a kind of destination: written here,
    // not yet sent on. Naming a vendor in them is the copy's form of branching
    // on a provider id, and would need rewriting when a second remote
    // registers. A screen offering a named choice still names it.
    //
    // The local side's word is "device" everywhere, never "computer".
    const translate = await t(lng);
    for (const key of [
      "app.onlyOnDeviceAnnounce",
      "app.offline",
      "app.onlyOnDeviceChanges",
      "toolbar.pushing",
    ] as const) {
      const value = translate(key);
      if (value === key) continue; // not every key survived the redesign
      expect(value).not.toContain("Drive");
      expect(value).not.toContain("Google");
      expect(value).not.toContain("computer");
    }
    const counted = translate("app.onlyOnDevice", { count: 2 });
    expect(counted).not.toContain("Drive");
    expect(counted).not.toContain("Google");
  });
});

// The lost-change notice keeps the held-work face's rules: a real plural in
// both languages, one line at four digits, and a numberless sentence for the
// column's live region.
describe.each(["en", "it"] as const)("app.changesLost in %s", (lng) => {
  const forms = formsIn(lng);

  it("selects the singular form at 1 and the plural form above it", async () => {
    // In Italian the two forms are the same words: "file" does not change.
    const translate = await t(lng);
    expect(translate("app.changesLost", { count: 1 })).toBe(
      filled(forms.changesLost_one, 1),
    );
    for (const count of [2, 11, 1000])
      expect(translate("app.changesLost", { count })).toBe(
        filled(forms.changesLost_other, count),
      );
  });

  it("keeps the one-line character budget at four digits", async () => {
    // The held-work face's budget; an editorial limit, not a rendered fit.
    const translate = await t(lng);
    const rendered = translate("app.changesLost", { count: 1000 });
    expect(rendered.length).toBeLessThanOrEqual(lng === "en" ? 34 : 40);
  });

  it("announces in a sentence, and names its control", async () => {
    const translate = await t(lng);
    const announced = translate("app.changesLostAnnounce");
    expect(announced).not.toBe("app.changesLostAnnounce");
    expect(announced.endsWith(".")).toBe(true);
    const dismiss = translate("app.changesLostDismiss");
    expect(dismiss).not.toBe("app.changesLostDismiss");
    for (const value of [
      announced,
      translate("app.changesLost", { count: 2 }),
    ]) {
      expect(value).not.toContain("Drive");
      expect(value).not.toContain("Google");
    }
  });
});
