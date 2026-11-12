// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showBootFailure } from "./bootFailure";

// Pins the page for a start-up that failed before React mounted: built from
// DOM calls, which Trusted Types allow, in the system colours when no theme
// has loaded, and silent about the error itself.

const { report, reload } = vi.hoisted(() => ({
  report: vi.fn(),
  reload: vi.fn(),
}));
vi.mock("../compose", () => ({ faults: { report, reload } }));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});
afterEach(() => vi.clearAllMocks());

function must<T>(value: T | null): T {
  if (value === null) throw new Error("expected the page to hold this node");
  return value;
}

describe("the boot failure page", () => {
  it("reports the error and says the app could not start, without its message", () => {
    const error = new Error("i18n: resources missing");
    showBootFailure(error);

    expect(report).toHaveBeenCalledWith(error, "boot");
    const root = must(document.getElementById("root"));
    expect(root.querySelector("h1")?.textContent).toMatch(/couldn't start/);
    expect(root.textContent).not.toMatch(/resources missing/);
    expect(document.activeElement).toBe(root.querySelector("h1"));
  });

  it("reloads from its button", () => {
    showBootFailure(new Error("x"));
    must(
      document.querySelector<HTMLButtonElement>(".page-actions button"),
    ).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("paints itself in the system colours when no theme has loaded", () => {
    showBootFailure(new Error("x"));
    const page = must(document.querySelector<HTMLElement>(".fault-page"));
    expect(page.style.background).toBe("canvas");
    expect(document.documentElement.style.colorScheme).toBe("light dark");
  });

  it("leaves the paint to a theme that has loaded", () => {
    document.documentElement.dataset.theme = "matte-dark";
    showBootFailure(new Error("x"));
    expect(
      must(document.querySelector<HTMLElement>(".fault-page")).style.background,
    ).toBe("");
  });

  it("heads the page with the broken figure", () => {
    showBootFailure(new Error("x"));
    const mark = document.querySelector(".page-inner > svg.brand-mark");
    expect(mark?.classList.contains("brand-mark-out")).toBe(true);
  });

  it("writes into the body when the mount point is missing", () => {
    document.body.innerHTML = "";
    showBootFailure(new Error("missing #root mount node"));
    expect(document.body.querySelector(".fault-page")).toBeTruthy();
  });
});
