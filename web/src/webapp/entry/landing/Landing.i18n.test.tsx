// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
//
// Renders the landing page against the real i18next instance, in each
// language. The suite's `t` mock echoes keys and the parity test sees no
// asymmetry, so only a real render shows a key missing from both locales,
// or a `{{variable}}` left unfilled, to a visitor.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import i18n from "i18next";
import { initI18n } from "../../../locales/i18n";
import { PRODUCT } from "../../../product";
import en from "../../../locales/en.json";
import itLocale from "../../../locales/it.json";
import Landing from "./Landing";
import { useAccountEntry } from "./accountEntry";

let signInReachable: boolean | null = true;
vi.mock("../../../auth/AuthContext", () => ({
  useAuth: () => ({
    status: "anonymous",
    signInReachable,
    logIn: vi.fn(),
    enterWithoutAccount: vi.fn(),
  }),
}));

const variant = (scheme: "light" | "dark") => ({
  id: `matte-${scheme}`,
  family: "matte",
  scheme,
  label: scheme === "light" ? "once dark" : "still dark",
  own: {},
  tokens: {},
});

vi.mock("../../../theme", () => ({
  useTheme: () => ({
    theme: variant("dark"),
    families: [
      {
        id: "matte",
        label: "Matte",
        light: variant("light"),
        dark: variant("dark"),
      },
    ],
    setFamily: vi.fn(),
    setScheme: vi.fn(),
  }),
  prefetchSheets: vi.fn(),
}));

afterEach(() => {
  cleanup();
  signInReachable = true;
});

/** A key as `t` returns it when neither locale has it. */
const RAW_KEY =
  /\b(landing|snapshots|dock|toolbar|settings|auth|reference|tree|comments)\.[a-zA-Z-]+\.?/;

describe("the landing page against the real i18next instance", () => {
  it.each(["en", "it"])(
    "shows no raw key or open variable in %s",
    async (lng) => {
      await initI18n();
      await i18n.changeLanguage(lng);
      const { container } = render(
        <MemoryRouter>
          <Landing useEntry={useAccountEntry} />
        </MemoryRouter>,
      );
      const text = container.textContent ?? "";
      expect(text).toContain((lng === "it" ? itLocale : en).landing.hero.title);
      expect(text).not.toMatch(RAW_KEY);
      expect(text).not.toContain("{{");
      // The cost answer names the product through `{{product}}`.
      expect(container.querySelector("#faq-cost p")?.textContent).toContain(
        PRODUCT.name,
      );
    },
  );

  it.each([
    ["en", true],
    ["en", false],
    ["it", true],
    ["it", false],
  ])(
    "in %s, keeps the note's Google term only with Google sign-in (%s)",
    async (lng, reachable) => {
      signInReachable = reachable;
      await initI18n();
      await i18n.changeLanguage(lng);
      const { container } = render(
        <MemoryRouter>
          <Landing useEntry={useAccountEntry} />
        </MemoryRouter>,
      );
      const terms = (lng === "it" ? itLocale : en).landing.hero.note.split(
        " · ",
      );
      const google = terms[terms.length - 1];
      const notes = [...container.querySelectorAll(".landing-cta-note")];
      expect(notes).toHaveLength(2);
      for (const note of notes) {
        expect(note.textContent).toContain(terms[0]);
        expect(note.textContent?.includes(google)).toBe(reachable);
      }
    },
  );
});
