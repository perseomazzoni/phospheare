// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AiNeedQuestion } from "./AiDrafting";
import { DRAFTING_NEEDS } from "../../ai/domain/types";

// Pins the drafting room's first question. The notes it keeps for later are
// ghost comments in the margin, with no list component; that list's two tests
// stay skip-marked, because a test is not deleted without
// approval.

vi.mock("react-i18next", () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

afterEach(() => {
  cleanup();
});

describe("the need question", () => {
  it("offers every need, as a group named by its question", () => {
    const onPick = vi.fn();
    render(<AiNeedQuestion onPick={onPick} />);
    const group = screen.getByRole("group", { name: "dock.drafting.question" });
    expect(group.querySelectorAll("button")).toHaveLength(
      DRAFTING_NEEDS.length,
    );
    fireEvent.click(screen.getByText("dock.drafting.need.what-if"));
    expect(onPick).toHaveBeenCalledWith("what-if");
  });

  it("says where the writer stopped, when coming back, above the question", () => {
    // The writer's own last line, quoted.
    const { container, rerender } = render(
      <AiNeedQuestion onPick={vi.fn()} stoppedAt="She shut the door." />,
    );
    expect(container.querySelector(".ai-stopped")?.textContent).toBe(
      "dock.drafting.stoppedAt She shut the door.",
    );
    expect(container.querySelector(".ai-stopped q")?.textContent).toBe(
      "She shut the door.",
    );
    rerender(<AiNeedQuestion onPick={vi.fn()} stoppedAt={null} />);
    expect(container.querySelector(".ai-stopped")).toBeNull();
  });
});
