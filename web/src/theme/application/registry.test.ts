// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it } from "vitest";
import {
  allFamilies,
  allThemes,
  clearThemes,
  getTheme,
  register,
  registerFamily,
  variantOf,
} from "./registry";
import type { Theme } from "../domain/types";
import { matte } from "../themes/matte";

const stub = (id: string, label = id): Theme => ({ ...matte.light, id, label });

afterEach(() => clearThemes());

describe("theme registry", () => {
  it("gets back what was registered", () => {
    const one = stub("one");
    register(one);
    expect(getTheme("one")).toBe(one);
  });

  it("returns null for a theme that was never registered", () => {
    expect(getTheme("nope")).toBeNull();
  });

  it("lists every registered theme, in registration order", () => {
    register(stub("a"));
    register(stub("b"));
    register(stub("c"));
    expect(allThemes().map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("refuses a theme registered twice under one id, keeping the first", () => {
    register(stub("a", "First"));
    expect(() => register(stub("a", "Second"))).toThrow("registered twice");
    expect(allThemes()).toHaveLength(1);
    expect(getTheme("a")?.label).toBe("First");
  });

  it("starts empty", () => {
    expect(allThemes()).toEqual([]);
  });

  describe("families", () => {
    const variant = (family: string, scheme: "light" | "dark"): Theme => ({
      ...matte.light,
      id: `${family}-${scheme}`,
      family,
      scheme,
    });

    it("groups the variants into the themes a writer chooses, in registration order", () => {
      registerFamily({
        id: "matte",
        name: "Matte",
        light: variant("matte", "light"),
        dark: variant("matte", "dark"),
      });
      registerFamily({
        id: "shine",
        name: "Shine",
        light: variant("shine", "light"),
        dark: variant("shine", "dark"),
      });
      expect(
        allFamilies().map((f) => [f.id, f.label, f.light?.id, f.dark?.id]),
      ).toEqual([
        ["matte", "Matte", "matte-light", "matte-dark"],
        ["shine", "Shine", "shine-light", "shine-dark"],
      ]);
    });

    it("names an unnamed family by its id", () => {
      register(variant("plain", "light"));
      expect(allFamilies()[0].label).toBe("plain");
    });

    it("finds a family's variant, and falls back to the one it has", () => {
      register(variant("matte", "light"));
      register(variant("matte", "dark"));
      register(variant("solo", "light"));
      expect(variantOf("matte", "dark")?.id).toBe("matte-dark");
      expect(variantOf("solo", "dark")?.id).toBe("solo-light");
      expect(variantOf("nope", "dark")).toBeNull();
    });
  });
});
