// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AiJournalEntry, AiReadingSoFar } from "./AiReading";
import type {
  JournalEntry,
  Prediction,
  ReadingRecord,
} from "../../ai/domain/types";

// Pins a beta reader's reading as drawn: the entry under a `/read-on` answer,
// and the curve and ledger over the transcript.

vi.mock("react-i18next", () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

afterEach(() => {
  cleanup();
});

const ENTRY: JournalEntry = {
  nodeId: "one",
  readAt: "2026-09-28T10:00:00.000Z",
  reaction: "It moved me.",
  understanding: "Someone is stealing letters.",
  questions: ["Who?"],
  confusion: ["The jump to the harbour."],
  attention: 3,
  cares: ["Mara", "Tom"],
  keepReading: false,
  why: "Too slow.",
};
const LEDGER: Prediction[] = [
  {
    id: "p1",
    text: "Tom lies.",
    madeAt: "zero",
    state: "confirmed",
    resolvedAt: "one",
    note: "Obvious.",
  },
  { id: "p2", text: "A storm.", madeAt: "one", state: "open" },
  {
    id: "p3",
    text: "Before anything.",
    state: "overturned",
    resolvedAt: "one",
  },
];

describe("a journal entry", () => {
  it("draws what the reader believes, asks and cares about, and its verdict", () => {
    const { container } = render(
      <AiJournalEntry entry={ENTRY} predictions={LEDGER} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Someone is stealing letters.");
    expect(text).toContain("Who?");
    expect(text).toContain("The jump to the harbour.");
    expect(text).toContain("Mara, Tom");
    expect(text).toContain("dock.reading.putsDown");
    // The attention, in words, for whoever cannot see the dots.
    expect(
      screen.getByRole("img", {
        name: 'dock.reading.attention:{"score":3}',
      }),
    ).toBeTruthy();
    expect(container.querySelectorAll(".ai-attention .is-on")).toHaveLength(3);
    // What was settled here, and what was written down here.
    expect(text).toContain(
      "dock.reading.state.confirmed: Tom lies. — Obvious.",
    );
    expect(text).toContain("dock.reading.state.overturned: Before anything.");
    expect(text).toContain("A storm.");
  });

  it("leaves out what the reader did not say", () => {
    const { container } = render(
      <AiJournalEntry
        entry={{
          ...ENTRY,
          questions: [],
          confusion: [],
          cares: [],
          understanding: "",
          keepReading: true,
        }}
        predictions={[]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("dock.reading.questions");
    expect(text).not.toContain("dock.reading.confusion");
    expect(text).not.toContain("dock.reading.cares");
    expect(text).not.toContain("dock.reading.understanding");
    expect(text).toContain("dock.reading.keepsReading");
  });
});

describe("the reading so far", () => {
  const reading: ReadingRecord = {
    entries: [
      ENTRY,
      { ...ENTRY, nodeId: "two", attention: 5, keepReading: true },
    ],
    predictions: LEDGER,
  };
  const titleOf = (id: string) => `Title ${id}`;

  it("draws the curve with its put-down point, and the ledger", () => {
    const { container } = render(
      <AiReadingSoFar reading={reading} titleOf={titleOf} />,
    );
    expect(container.querySelector("summary")?.textContent).toBe(
      'dock.reading.soFar:{"count":2}',
    );
    const points = container.querySelectorAll("circle");
    expect(points).toHaveLength(2);
    expect(points[0].classList.contains("is-put-down")).toBe(true);
    expect(points[1].classList.contains("is-put-down")).toBe(false);
    // The curve in words.
    expect(container.querySelector("figcaption")?.textContent).toContain(
      "Title one: dock.reading.attention",
    );
    const rows = [...container.querySelectorAll("tbody tr")].map(
      (row) => row.textContent,
    );
    expect(rows[0]).toContain("Title zero");
    expect(rows[0]).toContain("Obvious.");
    expect(rows[2]).toContain("dock.reading.beforeReading");
  });

  it("draws nothing for a reading with nothing in it", () => {
    const { container } = render(
      <AiReadingSoFar
        reading={{ entries: [], predictions: [] }}
        titleOf={titleOf}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("places a single point in the middle", () => {
    const { container } = render(
      <AiReadingSoFar
        reading={{ entries: [ENTRY], predictions: [] }}
        titleOf={titleOf}
      />,
    );
    expect(container.querySelector("circle")?.getAttribute("cx")).toBe("150");
    expect(container.querySelector("table")).toBeNull();
  });
});
