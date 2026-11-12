// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import SetupCard from "./SetupCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// The welcome's setup: Local Storage, Remote Storage, or both. Each row ticks
// from its connection and names where the projects are.

function draw(more: Partial<Parameters<typeof SetupCard>[0]> = {}) {
  const props = {
    localReady: false,
    remoteReady: false,
    where: { local: null, remote: null },
    localAvailable: true,
    onChooseLocalFolder: vi.fn(async () => {}),
    onConnectRemote: vi.fn(async () => false),
    ...more,
  };
  render(<SetupCard {...props} />);
  return props;
}

const button = (name: string) => screen.getByRole("button", { name });
const local = () =>
  screen.queryByRole("button", { name: "library.chooseLocalFolder" });
const remote = () =>
  screen.queryByRole("button", { name: "library.connectDrive" });
const addLocal = () =>
  screen.queryByRole("button", { name: "library.setup.addLocal" });
const addRemote = () =>
  screen.queryByRole("button", { name: "library.setup.addRemote" });

describe("SetupCard", () => {
  // The e2e helpers find the places by these two names.
  it("offers a folder on this device and Remote Storage", async () => {
    const onChooseLocalFolder = vi.fn(async () => {});
    const onConnectRemote = vi.fn(async () => false);
    draw({ onChooseLocalFolder, onConnectRemote });
    // One at a time: the other waits while the folder picker is open.
    await act(async () => fireEvent.click(button("library.chooseLocalFolder")));
    expect(onChooseLocalFolder).toHaveBeenCalled();
    fireEvent.click(button("library.connectDrive"));
    expect(onConnectRemote).toHaveBeenCalled();
  });

  it("drops Local Storage where folders cannot be read", () => {
    draw({ localAvailable: false });
    expect(screen.queryByText("library.setup.localName")).toBeNull();
    expect(remote()).toBeTruthy();
  });

  // Connecting leaves the page for the provider's consent screen; the button
  // stays busy until it goes, and comes back only on a cancel.
  it("keeps Remote Storage busy while the page leaves, and frees it on a cancel", async () => {
    let answer: (leaving: boolean) => void = () => {};
    draw({
      onConnectRemote: vi.fn(
        () => new Promise<boolean>((done) => (answer = done)),
      ),
    });
    fireEvent.click(button("library.connectDrive"));
    expect(button("library.connectDrive").getAttribute("aria-busy")).toBe(
      "true",
    );
    await act(async () => answer(false));
    expect(button("library.connectDrive").getAttribute("aria-busy")).toBeNull();
  });

  // Either place, or both: a ready row names where, and the other waits
  // behind a quiet way in.
  it("names the folder once Local Storage is ready, and still offers Remote Storage", async () => {
    const onConnectRemote = vi.fn(async () => false);
    draw({
      localReady: true,
      where: { local: "Novels", remote: null },
      onConnectRemote,
    });
    expect(screen.getByText("Novels")).toBeTruthy();
    expect(screen.queryByText("library.setup.remoteName")).toBeNull();
    expect(local()).toBeNull();
    expect(remote()).toBeNull();
    await act(async () => fireEvent.click(button("library.setup.addRemote")));
    expect(onConnectRemote).toHaveBeenCalled();
  });

  it("names the account once Remote Storage is ready, and still offers Local Storage", async () => {
    const onChooseLocalFolder = vi.fn(async () => {});
    draw({
      remoteReady: true,
      where: { local: null, remote: "maren@example.com" },
      onChooseLocalFolder,
    });
    expect(screen.getByText("maren@example.com")).toBeTruthy();
    expect(screen.queryByText("library.setup.localName")).toBeNull();
    expect(remote()).toBeNull();
    expect(local()).toBeNull();
    await act(async () => fireEvent.click(button("library.setup.addLocal")));
    expect(onChooseLocalFolder).toHaveBeenCalled();
  });

  it("offers nothing more once both places are ready", () => {
    draw({
      localReady: true,
      remoteReady: true,
      where: { local: "Novels", remote: "maren@example.com" },
    });
    expect(addLocal()).toBeNull();
    expect(addRemote()).toBeNull();
  });

  it("offers no folder later where folders cannot be read", () => {
    draw({
      localAvailable: false,
      remoteReady: true,
      where: { local: null, remote: "maren@example.com" },
    });
    expect(addLocal()).toBeNull();
  });

  it("shows Remote Storage with the reason and no button to a writer without Google", () => {
    draw({ onConnectRemote: undefined });
    expect(remote()).toBeNull();
    expect(screen.getByText("library.driveNeedsAccount")).toBeTruthy();
    expect(local()).toBeTruthy();
  });

  it("keeps no way into Remote Storage below a complete list for a writer without Google", () => {
    draw({
      onConnectRemote: undefined,
      localReady: true,
      where: { local: "Novels", remote: null },
    });
    expect(addRemote()).toBeNull();
    expect(screen.getByText(/library.driveNeedsAccount/)).toBeTruthy();
  });

  // Firefox or Safari without Google: neither place can be used, so both are
  // drawn with their reasons instead of an empty card.
  it("says why neither place can be used when no folder and no account are possible", () => {
    draw({ onConnectRemote: undefined, localAvailable: false });
    expect(local()).toBeNull();
    expect(remote()).toBeNull();
    expect(screen.getByText("library.diskUnsupported")).toBeTruthy();
    expect(screen.getByText("library.driveNeedsAccount")).toBeTruthy();
  });
});
