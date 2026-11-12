// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "../locales/i18n";
import type { Release, ReleaseCheck } from "./application/checkForRelease";
import ReleaseNotice, { RELEASE_NOTICE_REGION_ID } from "./ReleaseNotice";

const V2: Release = {
  tag: "v2.0.0",
  url: "https://github.test/releases/tag/v2.0.0",
};

function check(found: Release | null): ReleaseCheck {
  return { newer: vi.fn(async () => found), dismiss: vi.fn() };
}

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("ReleaseNotice", () => {
  it("says it in Italian too, with the version as the link", async () => {
    await i18n.changeLanguage("it");
    render(<ReleaseNotice check={check(V2)} />);
    const link = await screen.findByRole("link", { name: "2.0.0" });
    expect(link.closest(".status-notice")?.textContent).toBe(
      "È uscita una nuova versione. 2.0.0 Se vuoi usarla, compila il nuovo sorgente.",
    );
    expect(screen.getByRole("button", { name: "Chiudi" })).toBeTruthy();
  });

  it("names the version, and links it to the release's page", async () => {
    render(<ReleaseNotice check={check(V2)} />);
    const link = await screen.findByRole("link", { name: "2.0.0" });
    expect(link.getAttribute("href")).toBe(V2.url);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.closest(".status-notice")?.textContent).toBe(
      "A new version is out. 2.0.0 If you want it, build it from the new source.",
    );
  });

  it("closes for that release and tells the check", async () => {
    const asked = check(V2);
    render(<ReleaseNotice check={asked} />);
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(asked.dismiss).toHaveBeenCalledWith(V2);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows nothing with no release to offer, or no check", async () => {
    const { container } = render(<ReleaseNotice check={check(null)} />);
    await act(async () => {});
    expect(container.textContent).toBe("");
    const none = render(<ReleaseNotice check={null} />);
    expect(none.container.textContent).toBe("");
  });

  it("says it in the permanent region", async () => {
    const region = document.createElement("span");
    region.id = RELEASE_NOTICE_REGION_ID;
    document.body.append(region);
    render(<ReleaseNotice check={check(V2)} />);
    await screen.findByRole("link");
    expect(region.textContent).toBe("Version 2.0.0 is available.");
    region.remove();
  });

  it("drops an answer that arrives after it leaves the page", async () => {
    let answer: (release: Release) => void = () => {};
    const late: ReleaseCheck = {
      newer: () => new Promise((resolve) => (answer = resolve)),
      dismiss: vi.fn(),
    };
    const errors = vi.spyOn(console, "error");
    const { unmount } = render(<ReleaseNotice check={late} />);
    unmount();
    await act(async () => answer(V2));
    expect(errors).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
