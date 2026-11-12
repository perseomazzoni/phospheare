// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AiCommandGuide, AiTransitLine } from "./AiCommandGuide";
import { whereSkill } from "../../ai/domain/skills";
import { __resetOverlays } from "../../ui/overlay/useOverlay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: object) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

afterEach(() => {
  cleanup();
  __resetOverlays();
});

describe("AiCommandGuide", () => {
  // A shipped command, so the row also proves the file's guide reaches the
  // surface untouched — the file is the one place the copy lives.
  const where = whereSkill;

  it("says what the command does, when it is for and how to type it, from its file", () => {
    render(<AiCommandGuide skill={where} language="en" />);
    const guide = document.querySelector(".ai-guide") as HTMLElement;
    expect(guide.textContent).toContain("/where");
    for (const line of Object.values(where.guide.en))
      expect(guide.textContent).toContain(line);
    expect(guide.textContent).toContain("dock.guide.when");
    expect(guide.textContent).toContain("dock.guide.how");
  });

  it("speaks the interface's language", () => {
    render(<AiCommandGuide skill={where} language="it" />);
    const text = document.querySelector(".ai-guide")?.textContent ?? "";
    expect(text).toContain(where.guide.it.how);
    expect(text).not.toContain(where.guide.en.how);
  });
});

describe("AiTransitLine", () => {
  it("names the destination in one line, and opens the whole notice on a press", () => {
    render(
      <AiTransitLine host="openrouter.ai" detail="Everything that goes." />,
    );
    const line = screen.getByRole("button", {
      name: 'dock.transitLine:{"provider":"openrouter.ai"}',
    });
    // The full notice is the line's description, so it is on the page (and
    // read on focus) for as long as it applies, even with the dialog shut.
    expect(line.getAttribute("aria-haspopup")).toBe("dialog");
    const described = document.getElementById(
      line.getAttribute("aria-describedby") ?? "",
    );
    expect(described?.textContent).toBe("Everything that goes.");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(line);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(
      'dock.transitTitle:{"provider":"openrouter.ai"}',
    );
    expect(dialog.textContent).toContain("Everything that goes.");
    fireEvent.click(screen.getByRole("button", { name: "dock.transitAgree" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
