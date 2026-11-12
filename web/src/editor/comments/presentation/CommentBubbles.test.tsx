// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CommentBubbles from "./CommentBubbles";
import type { PersonaFace } from "./faces";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      `${key}(${Object.entries(options ?? {})
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ")})`,
  }),
}));

afterEach(cleanup);

// Invented voices, in the order the assistant would list them.
const PERSONAS: PersonaFace[] = [
  { id: "wren", name: "Wren", color: "#155393" },
  { id: "ash", name: "Ash", color: "#D2A025" },
];

describe("CommentBubbles", () => {
  it("draws nothing when nothing is counted", () => {
    const { container } = render(
      <CommentBubbles
        counts={{ personas: {}, others: 0 }}
        personas={PERSONAS}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("draws one circle per persona in its colour and order, then one for everyone else", () => {
    render(
      <CommentBubbles
        counts={{ personas: { ash: 2, wren: 5 }, others: 1 }}
        personas={PERSONAS}
      />,
    );
    const image = screen.getByRole("img");
    const circles = Array.from(image.querySelectorAll(".cm-bubble"));
    expect(circles.map((c) => c.textContent)).toEqual(["5", "2", "1"]);
    // The colour is the name; the ink is whichever reads on it.
    expect((circles[0] as HTMLElement).style.background).toBe(
      "rgb(21, 83, 147)",
    );
    expect((circles[0] as HTMLElement).style.color).toBe("rgb(255, 255, 255)");
    expect((circles[1] as HTMLElement).style.color).toBe("rgb(17, 22, 20)");
    expect(circles[2].classList.contains("cm-bubble-others")).toBe(true);
  });

  it("says in words what the colours say", () => {
    render(
      <CommentBubbles
        counts={{ personas: { wren: 3 }, others: 2 }}
        personas={PERSONAS}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "comments.countLabel(list=comments.countBy(count=3 name=Wren), comments.countOthers(count=2))",
    );
  });

  it("counts a persona no longer installed with everyone else, never in a colour that names nobody", () => {
    render(
      <CommentBubbles
        counts={{ personas: { gone: 2 }, others: 1 }}
        personas={PERSONAS}
      />,
    );
    const circles = Array.from(document.querySelectorAll(".cm-bubble"));
    expect(circles.map((c) => c.textContent)).toEqual(["3"]);
  });
});
