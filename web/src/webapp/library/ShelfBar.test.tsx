// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ShelfBar from "./ShelfBar";
import type { Connections } from "../../storage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(",")})` : key,
  }),
}));

afterEach(() => cleanup());

// Pins what the bar owes beyond its CSS. `:focus-within` expands the find
// field, so nothing here asserts a width. React owes `data-query`, the flag
// that holds the field open while a query narrows the shelf, so a filtered
// shelf never loses the control that filtered it.
//
// The panel stays mounted while shut, because conditional rendering can
// animate open but never closed. Shut means `data-open="0"`, not absent.

const props = {
  query: "",
  onQuery: vi.fn(),
  filter: "all" as const,
  onFilter: vi.fn(),
  counts: { local: 2, drive: 3 },
  density: "grid" as const,
  onDensity: vi.fn(),
  shown: 5,
  // The connection record drives the tallies and the panel rows; the states
  // are the only members these rows read.
  connections: {
    local: {
      id: "local",
      label: () => "local",
      icon: "mark",
      state: "connected",
      resolved: true,
    },
    drive: {
      id: "drive",
      label: () => "Google Drive",
      icon: "mark",
      state: "unset",
      resolved: true,
    },
  } as unknown as Connections,
  onConnect: vi.fn(),
  onChooseLocalFolder: vi.fn(),
  onCreate: vi.fn(),
};

const find = () => document.querySelector(".ui-bar-find");
const panel = () => document.querySelector(".shelf-panel");
const storageFace = () =>
  document.querySelector(".shelf-storage-face") as HTMLElement;
const tallies = () =>
  [...document.querySelectorAll(".shelf-tally")].map((t) => t.textContent);

describe("ShelfBar", () => {
  it("mounts the find input at all times, so the box can morph rather than swap", () => {
    render(<ShelfBar {...props} />);
    expect(find()?.querySelector("input")).toBeTruthy();
  });

  it("holds find open while a query is narrowing the shelf", () => {
    render(<ShelfBar {...props} query="salt" />);
    expect(find()?.getAttribute("data-query")).toBe("1");
  });

  it("lets find close again once the query is only whitespace", () => {
    render(<ShelfBar {...props} query="   " />);
    expect(find()?.getAttribute("data-query")).toBe("0");
  });

  // Library renders no bar until there are projects to control, so a bar
  // always has something to find.

  // Icons and counts, not a sentence, and no live dot: a summary is not where
  // a connection is acted on.
  it("shows both stores as tallies while nothing is filtered", () => {
    render(<ShelfBar {...props} />);
    expect(tallies()).toHaveLength(2);
    // Numeral and noun in separate spans, so the 640px rule can drop the noun
    // and keep the count. The noun goes through a plural key rather than an
    // English s; the mocked `t` echoes both.
    expect(storageFace().textContent).toContain("2library.countWord(2)");
    expect(storageFace().textContent).toContain("3library.countWord(3)");
  });

  // The bar carries no live dot, so a healthy store says nothing and a
  // problem says itself: a barred sigil, the wrong-state version of the
  // glyph rather than a light reporting good health.
  it("bars and dims the Drive tally while Drive is disconnected", () => {
    const { rerender } = render(<ShelfBar {...props} />);
    const driveTally = () => document.querySelectorAll(".shelf-tally")[1];
    expect(driveTally().getAttribute("data-off")).toBe("1");
    // Never the local one: a disk cannot be disconnected.
    expect(
      document.querySelectorAll(".shelf-tally")[0].getAttribute("data-off"),
    ).toBe("0");

    rerender(
      <ShelfBar
        {...props}
        connections={
          {
            local: {
              id: "local",
              label: () => "local",
              icon: "mark",
              state: "connected",
              resolved: true,
            },
            drive: {
              id: "drive",
              label: () => "Google Drive",
              icon: "mark",
              state: "connected",
              resolved: true,
            },
          } as unknown as Connections
        }
      />,
    );
    expect(driveTally().getAttribute("data-off")).toBe("0");
  });

  it("names the scope only while showing everything", () => {
    const { rerender } = render(<ShelfBar {...props} />);
    // Scoped to the bar: the panel has an "All projects" row of its own.
    // "All", not "All projects": the tallies beside it already end in the word.
    expect(document.querySelector(".shelf-scope")?.textContent).toBe(
      "library.filterAll",
    );

    // With a store chosen its own sigil says which place this is, so the word
    // would repeat it.
    rerender(<ShelfBar {...props} filter="drive" />);
    expect(document.querySelector(".shelf-scope")).toBeNull();
  });

  it("shows only the selected store when one is chosen", () => {
    render(<ShelfBar {...props} filter="drive" />);
    expect(tallies()).toHaveLength(1);
    // The other store's number is not what the shelf is showing.
    expect(storageFace().textContent).toContain("3library.countWord(3)");
    expect(storageFace().textContent).not.toContain("2library.countWord(2)");
  });

  // The chevron sits beside the word it discloses; at the end of the row it
  // reads as punctuation. With a store chosen there is no word to pair with,
  // so it sits at the trailing edge.
  it("keeps the chevron with the scope word, and only while there is one", () => {
    const { rerender } = render(<ShelfBar {...props} />);
    const scope = document.querySelector(".shelf-storage-scope");
    expect(scope?.querySelector(".shelf-scope")).toBeTruthy();
    expect(scope?.querySelector("svg")).toBeTruthy();

    rerender(<ShelfBar {...props} filter="drive" />);
    expect(document.querySelector(".shelf-storage-scope")).toBeNull();
    // Still reachable, at the trailing edge.
    expect(storageFace().querySelectorAll("svg").length).toBeGreaterThan(1);
  });

  // Choosing a place is the one decision the panel exists for, so making it
  // closes the panel.
  it("closes the panel once a place is chosen", () => {
    const onFilter = vi.fn();
    render(<ShelfBar {...props} onFilter={onFilter} />);
    fireEvent.click(storageFace());
    expect(panel()?.getAttribute("data-open")).toBe("1");

    // By the radio it drives, not by a provider label the mocked translator
    // does not own.
    // The click above opened the panel, so it is mounted; a null here means
    // the bar failed to mount it, not that this row is missing.
    const thePanel = panel();
    if (thePanel === null) throw new Error("storage panel not mounted");
    const local = thePanel.querySelector(
      'input[type="radio"]:not(:checked)',
    ) as HTMLInputElement;
    fireEvent.click(local);
    expect(onFilter).toHaveBeenCalledWith("local");
    expect(panel()?.getAttribute("data-open")).toBe("0");
  });

  it("keeps the live dot out of the collapsed bar", () => {
    render(
      <ShelfBar
        {...props}
        connections={
          {
            local: {
              id: "local",
              label: () => "local",
              icon: "mark",
              state: "connected",
              resolved: true,
            },
            drive: {
              id: "drive",
              label: () => "Google Drive",
              icon: "mark",
              state: "connected",
              resolved: true,
            },
          } as unknown as Connections
        }
        onFindInDrive={vi.fn()}
      />,
    );
    expect(storageFace().querySelector(".store-live")).toBeNull();
  });

  it("keeps the storage panel mounted while shut, so it can animate closed", () => {
    render(<ShelfBar {...props} />);
    expect(panel()).toBeTruthy();
    expect(panel()?.getAttribute("data-open")).toBe("0");
    expect(storageFace().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens storage onto the places and their actions", () => {
    render(<ShelfBar {...props} />);
    fireEvent.click(storageFace());
    expect(panel()?.getAttribute("data-open")).toBe("1");
    expect(panel()?.querySelectorAll(".store-row")).toHaveLength(3);
  });

  it("gives Remote Storage's row the reason and no action for a writer without Google", () => {
    render(<ShelfBar {...props} onConnect={undefined} />);
    fireEvent.click(storageFace());
    expect(panel()?.textContent).toContain("library.driveNeedsAccount");
    expect(
      screen.queryByRole("button", { name: /library.connect$/ }),
    ).toBeNull();
  });

  // Every row keeps its radio even when projects live in only one place: the
  // cursor and the hover highlight live on `.store-pick`, so a row without a
  // radio looks pickable and answers to nothing.
  it("keeps every place pickable, even one with no projects in it", () => {
    render(<ShelfBar {...props} counts={{ local: 2, drive: 0 }} />);
    fireEvent.click(storageFace());
    expect(panel()?.querySelectorAll(".store-row")).toHaveLength(3);
    expect(panel()?.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    // Never a bare span, which would carry the pointer cursor and do nothing.
    expect(panel()?.querySelectorAll("span.store-pick")).toHaveLength(0);
  });

  it("reports the chosen place even when nothing lives there", () => {
    const onFilter = vi.fn();
    render(
      <ShelfBar
        {...props}
        counts={{ local: 2, drive: 0 }}
        onFilter={onFilter}
      />,
    );
    fireEvent.click(storageFace());
    const drive = [...(panel()?.querySelectorAll(".store-row") ?? [])].find(
      (row) => row.textContent?.includes("Google Drive"),
    );
    // The seed's counts include the Drive store, so a row with a radio exists;
    // a missing row is a markup regression, and clicking nothing would not
    // test the filter.
    if (drive === undefined)
      throw new Error("no Drive row in the storage panel");
    const radio = drive.querySelector('input[type="radio"]');
    if (radio === null) throw new Error("Drive row has no radio");
    fireEvent.click(radio);
    expect(onFilter).toHaveBeenCalledWith("drive");
  });

  it("shows a live dot per store, inside the panel, where the connection can be acted on", () => {
    const { rerender } = render(<ShelfBar {...props} />);
    fireEvent.click(storageFace());
    const rows = () => document.querySelectorAll(".store-row");
    // All / This device / Google Drive. Local has a mapped root (the props
    // default), so its dot is present; Drive is off, so it has none. Local
    // carries the same live dot as Drive.
    expect(rows()[1].querySelector(".store-live")).toBeTruthy();
    expect(rows()[2].querySelector(".store-live")).toBeNull();

    rerender(
      <ShelfBar
        {...props}
        connections={
          {
            local: {
              id: "local",
              label: () => "local",
              icon: "mark",
              state: "connected",
              resolved: true,
            },
            drive: {
              id: "drive",
              label: () => "Google Drive",
              icon: "mark",
              state: "connected",
              resolved: true,
            },
          } as unknown as Connections
        }
        onFindInDrive={vi.fn()}
      />,
    );
    expect(rows()[2].querySelector(".store-live")).toBeTruthy();
  });

  it("offers Connect instead of an import while Drive is off", () => {
    render(<ShelfBar {...props} />);
    fireEvent.click(storageFace());
    expect(screen.getByText("library.connect")).toBeTruthy();
    expect(screen.queryByText("library.findDrive")).toBeNull();
  });

  // The thumb travels on `--track-at`, an index rather than a value name, so
  // the shared track need not know that "list" is second.
  it("marks the current density pressed, for the thumb to follow", () => {
    render(<ShelfBar {...props} density="list" />);
    const track = document.querySelector(".ui-bar-track") as HTMLElement | null;
    expect(track?.style.getPropertyValue("--track-at")).toBe("1");
    expect(
      screen.getByLabelText("library.list").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("changes density from the button that was pressed", () => {
    const onDensity = vi.fn();
    render(<ShelfBar {...props} onDensity={onDensity} />);
    fireEvent.click(screen.getByLabelText("library.list"));
    expect(onDensity).toHaveBeenCalledWith("list");
  });

  // The create action lives in the sticky bar, not the header, which scrolls
  // away.
  it("carries the create action, with its name drawn rather than hidden", () => {
    const onCreate = vi.fn();
    render(<ShelfBar {...props} onCreate={onCreate} />);
    const create = screen.getByLabelText("library.newProject");
    // The word is on screen, not only in the accessible name.
    expect(create.textContent).toContain("library.newProject");
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses to create when there is nowhere to create into", () => {
    render(<ShelfBar {...props} createDisabled />);
    expect(
      (screen.getByLabelText("library.newProject") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // The count belongs to the search, so it appears only with a query; beside
  // a button with no field in sight it would mean nothing.
  it("counts the results only once something has been typed", () => {
    const { rerender } = render(<ShelfBar {...props} />);
    expect(document.querySelector(".ui-bar-find-count")).toBeNull();

    // A source filter narrows the shelf too, but it is not a search.
    rerender(<ShelfBar {...props} filter="drive" />);
    expect(document.querySelector(".ui-bar-find-count")).toBeNull();

    rerender(<ShelfBar {...props} query="salt" shown={4} />);
    expect(document.querySelector(".ui-bar-find-count")?.textContent).toBe(
      "library.count(4)",
    );
  });

  it("draws the count inside the field, so the bar cannot jitter as you type", () => {
    render(<ShelfBar {...props} query="salt" shown={4} />);
    expect(find()?.contains(document.querySelector(".ui-bar-find-count"))).toBe(
      true,
    );
  });
});
