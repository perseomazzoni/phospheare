// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import Avatar from "./Avatar";

afterEach(cleanup);

// A picture that fails falls back to the initial, and only for that picture:
// a new URL on the same mounted avatar, after a refresh or an account switch,
// is tried again.

describe("Avatar", () => {
  it("falls back to the initial when the picture fails", () => {
    const { container } = render(
      <Avatar name="Ada Lovelace" avatarUrl="https://a.example/1.png" />,
    );
    const img = container.querySelector("img");
    if (!img) throw new Error("no picture");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("A");
  });

  it("tries a new picture after the old one failed", () => {
    const { container, rerender } = render(
      <Avatar name="Ada Lovelace" avatarUrl="https://a.example/1.png" />,
    );
    const img = container.querySelector("img");
    if (!img) throw new Error("no picture");
    fireEvent.error(img);

    rerender(
      <Avatar name="Ada Lovelace" avatarUrl="https://a.example/2.png" />,
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://a.example/2.png",
    );
  });
});
