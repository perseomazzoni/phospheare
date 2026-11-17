// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { LogEntry, LogLevel } from "../domain/line";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

const auth = vi.hoisted(() => ({
  user: { id: "acc-1" } as { id: string } | null,
}));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => auth }));

const kept = vi.hoisted(() => ({ entries: [] as LogEntry[] }));
vi.mock("../compose", () => ({
  appLog: { read: async () => kept.entries },
}));

import LogSheet, { SHOWN } from "./LogSheet";

const entry = (
  at: number,
  level: LogLevel,
  area: string,
  message: string,
): LogEntry => ({ at, level, area, message, account: "acc-1", fields: {} });

function show(state: unknown = { fromSettings: true }) {
  const router = createMemoryRouter(
    [
      { path: "/app", element: <p>shelf</p> },
      { path: "/app/settings", element: <p>settings</p> },
      { path: "/app/log", element: <LogSheet /> },
    ],
    {
      initialEntries: ["/app/settings", { pathname: "/app/log", state }],
      initialIndex: 1,
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const lines = () => document.querySelector(".log-lines")?.textContent ?? "";

beforeEach(() => {
  auth.user = { id: "acc-1" };
  kept.entries = [
    entry(1, "info", "app", "The app started."),
    entry(2, "warn", "sync", "A change did not reach its destination."),
    entry(3, "error", "fault", "A failure: crash."),
  ];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the log page", () => {
  it("shows the lines newest first, with their count", async () => {
    show();
    await screen.findByText(/log\.count/);
    expect(
      lines()
        .split("\n")
        .map((l) => l.slice(-18)),
    ).toEqual([
      "A failure: crash.".padStart(18),
      "ach its destination.".slice(-18),
      "The app started.".padStart(18),
    ]);
    expect(screen.getByText(/log\.count/).textContent).toBe(
      'log.count {"count":3,"total":3}',
    );
  });

  it("narrows by words, level and area", async () => {
    show();
    await screen.findByText(/log\.count/);
    fireEvent.change(screen.getByLabelText("log.search"), {
      target: { value: "APP started" },
    });
    expect(lines()).toContain("The app started.");
    expect(lines()).not.toContain("crash");
    fireEvent.change(screen.getByLabelText("log.search"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("log.level"), {
      target: { value: "warn" },
    });
    expect(lines()).not.toContain("The app started.");
    expect(lines()).toContain("crash");
    fireEvent.change(screen.getByLabelText("log.area"), {
      target: { value: "sync" },
    });
    expect(lines()).not.toContain("crash");
    expect(lines()).toContain("destination");
    fireEvent.change(screen.getByLabelText("log.level"), {
      target: { value: "error" },
    });
    expect(document.querySelector(".log-lines")).toBeNull();
  });

  it("draws the newest lines only, and says so", async () => {
    kept.entries = Array.from({ length: SHOWN + 20 }, (_, i) =>
      entry(i, "info", "app", `Line ${i}.`),
    );
    show();
    await screen.findByText(/log\.countShown/);
    expect(lines().split("\n")).toHaveLength(SHOWN);
    expect(lines()).toContain(`Line ${SHOWN + 19}.`);
    expect(screen.getByText(/log\.countShown/).textContent).toContain(
      `"found":${SHOWN + 20}`,
    );
  });

  it("says when the log is empty, and offers no download", async () => {
    kept.entries = [];
    show();
    await screen.findByText("log.empty");
    expect(screen.getByRole("button", { name: "log.download" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("downloads the whole log as a text file with its header", async () => {
    let saved: Blob | null = null;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        saved = blob;
        return "blob:log";
      },
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    show();
    await screen.findByText(/log\.count/);
    fireEvent.change(screen.getByLabelText("log.level"), {
      target: { value: "error" },
    });
    fireEvent.click(screen.getByRole("button", { name: "log.download" }));
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/-log-\d{4}-\d{2}-\d{2}\.txt$/);
    const text = await (saved as unknown as Blob).text();
    const rows = text.trimEnd().split("\n");
    expect(rows[0]).toMatch(/^━━ .* · browser · spa · log saved /);
    // The download holds every line, whatever the page narrows to.
    expect(rows).toHaveLength(4);
    vi.unstubAllGlobals();
  });

  it("copies the account id", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    show();
    await screen.findByText(/log\.count/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "log.copyId" }));
    });
    expect(writeText).toHaveBeenCalledWith("acc-1");
    expect(screen.getByRole("button", { name: "log.copied" })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("offers no id to copy without an account", async () => {
    auth.user = null;
    show();
    await screen.findByText(/log\.count/);
    expect(screen.queryByRole("button", { name: "log.copyId" })).toBeNull();
  });

  it("closes back to the settings it came from, or to the shelf", async () => {
    const fromSettings = show();
    await screen.findByText(/log\.count/);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() =>
      expect(fromSettings.state.location.pathname).toBe("/app/settings"),
    );
    cleanup();
    const fromLink = show(null);
    await screen.findByText(/log\.count/);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(fromLink.state.location.pathname).toBe("/app"));
  });
});
