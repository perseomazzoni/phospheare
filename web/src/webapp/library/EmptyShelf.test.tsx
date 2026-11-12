// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EmptyShelf from "./EmptyShelf";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${Object.values(vars).join(",")})` : key,
  }),
}));

afterEach(() => cleanup());

// An empty shelf says why it is empty and offers the one thing that would
// fill it. A generic "nothing matches" with a clear-search button, shown when
// no search was typed, reads as though the writer's projects had gone.

const props = {
  state: "noMatch" as const,
  query: "",
  total: 3,
  onClear: vi.fn(),
  onChooseLocalFolder: vi.fn(),
  onConnectDrive: vi.fn(),
  onFindInDrive: vi.fn(),
};

const heading = () => screen.getByRole("heading").textContent;
const button = () => screen.getByRole("button");

describe("EmptyShelf", () => {
  // The central case: Drive is the place and nothing can be seen in it.
  it("offers to connect when Drive is the place and there is no connection", () => {
    const onConnectDrive = vi.fn();
    render(
      <EmptyShelf
        {...props}
        state="driveDisconnected"
        onConnectDrive={onConnectDrive}
      />,
    );
    expect(heading()).toBe("library.driveOffTitle");
    fireEvent.click(button());
    expect(onConnectDrive).toHaveBeenCalled();
  });

  it("says why, and offers nothing, when a writer without Google selects Remote Storage", () => {
    render(
      <EmptyShelf
        {...props}
        state="driveDisconnected"
        onConnectDrive={undefined}
      />,
    );
    expect(heading()).toBe("library.driveOffTitle");
    expect(screen.getByText(/^library.driveNeedsAccount/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // A Drive the app can see into and one it cannot are different sentences
  // with different buttons; conflating them sends a writer to reconnect an
  // account that was never disconnected.
  it("offers to go looking when Drive is connected but holds nothing", () => {
    const onFindInDrive = vi.fn();
    render(
      <EmptyShelf
        {...props}
        state="driveEmpty"
        onFindInDrive={onFindInDrive}
      />,
    );
    expect(heading()).toBe("library.driveEmptyTitle");
    fireEvent.click(button());
    expect(onFindInDrive).toHaveBeenCalled();
  });

  it("offers to import when this device is the place", () => {
    const onChooseLocalFolder = vi.fn();
    render(
      <EmptyShelf
        {...props}
        state="localEmpty"
        onChooseLocalFolder={onChooseLocalFolder}
      />,
    );
    expect(heading()).toBe("library.localEmptyTitle");
    fireEvent.click(button());
    expect(onChooseLocalFolder).toHaveBeenCalled();
  });

  // Firefox and Safari have no File System Access API, and a button that can
  // only fail is worse than the sentence alone.
  it("drops the import button where folders cannot be read at all", () => {
    render(
      <EmptyShelf
        {...props}
        state="localEmpty"
        onChooseLocalFolder={undefined}
      />,
    );
    expect(heading()).toBe("library.localEmptyTitle");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names what was searched for, and offers the way back", () => {
    const onClear = vi.fn();
    render(
      <EmptyShelf
        {...props}
        state="noMatch"
        query="  salt  "
        onClear={onClear}
      />,
    );
    // Trimmed before it reaches the heading, or the quotes sit off the word.
    expect(heading()).toBe("library.noMatchQueryTitle(salt)");
    expect(screen.getByText("library.noMatchSearched(3)")).toBeTruthy();
    fireEvent.click(button());
    expect(onClear).toHaveBeenCalled();
  });

  it("has a different sentence for a filter with no query behind it", () => {
    render(<EmptyShelf {...props} state="noMatch" query="   " />);
    expect(screen.getByText("library.noMatchHere")).toBeTruthy();
  });

  it("offers importing a manuscript where a place is ready and empty", () => {
    const onImport = vi.fn();
    const { unmount } = render(
      <EmptyShelf {...props} state="driveEmpty" onImport={onImport} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "import.heading" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    unmount();
    render(
      <EmptyShelf
        {...props}
        state="localScannedEmpty"
        onFindLocalProjects={vi.fn()}
        onImport={onImport}
      />,
    );
    expect(screen.getByRole("button", { name: "import.heading" })).toBeTruthy();
  });

  it("never offers it beside a search that found nothing, or a lost connection", () => {
    const { unmount } = render(<EmptyShelf {...props} onImport={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "import.heading" })).toBeNull();
    unmount();
    render(
      <EmptyShelf {...props} state="driveDisconnected" onImport={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "import.heading" })).toBeNull();
  });
});
