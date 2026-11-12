// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Disclosure from "./Disclosure";

afterEach(() => {
  cleanup();
});

const toggle = (open: boolean) => {
  const details = document.querySelector("details");
  if (!details) throw new Error("no details");
  details.open = open;
  fireEvent(details, new Event("toggle"));
};

describe("Disclosure", () => {
  it("holds its contents from the start, folded", () => {
    render(<Disclosure summary="More">inside</Disclosure>);
    expect(screen.getByText("inside")).toBeTruthy();
    expect(document.querySelector("details")?.open).toBe(false);
  });

  it("builds a lazy fold's contents the first time it opens, and keeps them", () => {
    render(
      <Disclosure summary="More" lazy>
        inside
      </Disclosure>,
    );
    expect(screen.queryByText("inside")).toBeNull();
    toggle(true);
    expect(screen.getByText("inside")).toBeTruthy();
    toggle(false);
    expect(screen.getByText("inside")).toBeTruthy();
  });

  it("builds a lazy fold that starts open at once", () => {
    render(
      <Disclosure summary="More" lazy defaultOpen>
        inside
      </Disclosure>,
    );
    expect(screen.getByText("inside")).toBeTruthy();
  });
});
