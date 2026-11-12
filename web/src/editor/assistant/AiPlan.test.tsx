// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AiPlan from "./AiPlan";
import type { RevisionPlan } from "../../ai/domain/types";

// Pins the editorial revision plan as drawn: ranked, tickable, and a button to
// a drafting chat for an item still open.

vi.mock("react-i18next", () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

afterEach(() => {
  cleanup();
});

const PLAN: RevisionPlan = {
  items: [
    { id: "i1", priority: "must", text: "A", state: "open", turnId: "t" },
    { id: "i2", priority: "could", text: "B", state: "done", turnId: "t" },
  ],
};

describe("the revision plan", () => {
  it("groups by priority, counts what is open, and ticks an item either way", () => {
    const onMark = vi.fn();
    const onDraft = vi.fn();
    const { container } = render(
      <AiPlan plan={PLAN} onMark={onMark} onDraft={onDraft} />,
    );
    expect(container.querySelector("summary")?.textContent).toBe(
      'dock.plan.title:{"count":1}',
    );
    expect(
      [...container.querySelectorAll("h3")].map((one) => one.textContent),
    ).toEqual(["dock.plan.priority.must", "dock.plan.priority.could"]);
    const a = screen.getByRole("checkbox", {
      name: 'dock.plan.done:{"item":"A"}',
    });
    expect(a.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(a);
    expect(onMark).toHaveBeenCalledWith("i1", "done");
    fireEvent.click(
      screen.getByRole("checkbox", { name: 'dock.plan.done:{"item":"B"}' }),
    );
    expect(onMark).toHaveBeenCalledWith("i2", "open");
    // Only an open item goes to drafting.
    const drafts = screen.getAllByText("dock.plan.draft");
    expect(drafts).toHaveLength(1);
    fireEvent.click(drafts[0]);
    expect(onDraft).toHaveBeenCalledWith(PLAN.items[0]);
  });

  it("draws nothing for an empty plan, and no button where none can open", () => {
    const empty = render(<AiPlan plan={{ items: [] }} onMark={vi.fn()} />);
    expect(empty.container.innerHTML).toBe("");
    empty.unmount();
    render(<AiPlan plan={PLAN} onMark={vi.fn()} />);
    expect(screen.queryByText("dock.plan.draft")).toBeNull();
  });

  it("says the next letter's verdict under the item it judged", () => {
    const { container } = render(
      <AiPlan
        plan={{
          items: [
            {
              ...PLAN.items[0],
              check: {
                verdict: "worse",
                note: "The cut left a gap.",
                turnId: "t2",
              },
            },
            PLAN.items[1],
          ],
        }}
        onMark={vi.fn()}
      />,
    );
    const verdicts = container.querySelectorAll(".ai-plan-verdict");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].getAttribute("data-verdict")).toBe("worse");
    expect(verdicts[0].textContent).toBe(
      "dock.plan.verdict.worse — The cut left a gap.",
    );
  });
});
