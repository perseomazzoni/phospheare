// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ReferenceNameInput from "./ReferenceNameInput";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

function renderInput(onCommit: (title: string) => boolean | Promise<boolean>) {
  return render(
    <ReferenceNameInput
      prefix="character--"
      group="Characters"
      taken={new Set()}
      onCommit={onCommit}
      onCancel={vi.fn()}
      rowClassName="ref-name-row"
    />,
  );
}

// The shared add field's own contract: one commit per gesture, and the field
// re-arms when the commit answers false or rejects. The panels' rows drive the
// false leg through `writeReference`; these rows drive the component directly,
// so the rejection arm cannot be deleted silently.

describe("ReferenceNameInput", () => {
  it("does not commit twice while a commit is in flight", () => {
    const onCommit = vi.fn(() => new Promise<boolean>(() => undefined));
    renderInput(onCommit);
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "Maren" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a rejected commit and lands the retry", async () => {
    const onCommit = vi
      .fn<(title: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);
    renderInput(onCommit);
    const input = screen.getByLabelText("reference.namePlaceholder");
    fireEvent.change(input, { target: { value: "Maren" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    // The rejection re-armed the field: the same Enter commits again.
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(onCommit).toHaveBeenLastCalledWith("Maren");
  });
});
