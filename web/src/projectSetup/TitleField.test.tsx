// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TitleField, { readTitle } from "./TitleField";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

afterEach(() => {
  cleanup();
});

// One title field serves the wizard, the duplicate dialog and the Properties
// window, so the rule a title is held to cannot drift between them.
// The caller says what the title is about to do, and the field holds it to
// that.

describe("readTitle", () => {
  const taken = new Set(["salt-and-iron"]);

  it("holds a title a folder will take to folder rules", () => {
    expect(readTitle("Salt and Iron", "folder", taken)).toEqual({
      problem: { code: "folderTaken", values: { folder: "salt-and-iron" } },
      ready: false,
    });
    expect(readTitle("???", "folder", taken).problem?.code).toBe(
      "noFolderName",
    );
    expect(readTitle("Once Dark", "folder", taken)).toEqual({
      problem: null,
      ready: true,
    });
  });

  it("holds a title no folder will take to title rules only", () => {
    expect(readTitle("Salt and Iron", "title", taken).ready).toBe(true);
    expect(readTitle("???", "title", taken).ready).toBe(true);
    expect(readTitle("Salt\u0007", "title", taken).problem?.code).toBe(
      "controlChars",
    );
  });

  it("asks an unchanged title nothing", () => {
    expect(readTitle("Salt and Iron", "none", taken)).toEqual({
      problem: null,
      ready: true,
    });
  });

  it("never calls an empty field a problem, and never ready", () => {
    for (const check of ["folder", "title", "none"] as const) {
      expect(readTitle("  ", check, taken)).toEqual({
        problem: null,
        ready: false,
      });
    }
  });
});

describe("TitleField", () => {
  const mount = (value: string, folder: string) =>
    render(
      <TitleField
        label="Title"
        value={value}
        onChange={() => {}}
        reading={readTitle(value, "folder", new Set())}
        folderLine={{ lead: "Creates", folder }}
      />,
    );

  it("says which folder the title makes", () => {
    mount("Salt and Iron", "salt-and-iron");
    expect(screen.getByText("salt-and-iron/")).toBeTruthy();
    expect(screen.getByText(/Creates/)).toBeTruthy();
  });

  it("names no folder while there is none to name", () => {
    mount("", "");
    expect(screen.getByText("create.folderStub")).toBeTruthy();
  });

  it("says nothing about a folder when told nothing true to say", () => {
    render(
      <TitleField
        label="Title"
        value="Salt"
        onChange={() => {}}
        reading={readTitle("Salt", "none", new Set())}
      />,
    );
    expect(screen.queryByText(/salt\//)).toBeNull();
  });
});
