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
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { PlatformError } from "../../../platform";
import Landing from "./Landing";
import { useAccountEntry } from "./accountEntry";
import { useDownloadEntry } from "./downloadEntry";
import { FAQ, QUICKSTART_URL } from "./content";
import shots from "./shots.json";

// The page's plumbing: who it sends where, and the editor at work in the
// closing preview. The copy is checked by key; its words are the locale files'.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const auth = {
  status: "anonymous",
  signInReachable: true as boolean | null,
  logIn: vi.fn(async () => {}),
  enterWithoutAccount: vi.fn(),
};

vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => auth }));

const variant = (family: string, scheme: "light" | "dark") => ({
  id: `${family}-${scheme}`,
  family,
  scheme,
  label: scheme === "light" ? "once dark" : "still dark",
  own: {},
  tokens: {},
});
const looks = {
  theme: variant("matte", "dark"),
  families: ["matte", "shine"].map((id) => ({
    id,
    label: id === "matte" ? "Matte" : "Shine",
    light: variant(id, "light"),
    dark: variant(id, "dark"),
  })),
  setFamily: vi.fn(),
  setScheme: vi.fn(),
};
const prefetchSheets = vi.fn();

vi.mock("../../../theme", () => ({
  useTheme: () => looks,
  prefetchSheets: () => prefetchSheets(),
}));

let still = false;
vi.mock("../../../ui/motion", () => ({ motionIsStill: () => still }));

// jsdom has no File System Access API; a test turns it off as Firefox does.
let folders = true;
vi.mock("../../../storage/localRoot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../storage/localRoot")>()),
  localFoldersSupported: () => folders,
}));

beforeEach(() => {
  auth.status = "anonymous";
  auth.signInReachable = true;
  auth.logIn.mockReset().mockResolvedValue(undefined);
  auth.enterWithoutAccount.mockReset();
  still = false;
  folders = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** Time passing in small steps, so each beat's render sets the next timer. */
function tick(ms: number) {
  for (let t = 0; t < ms; t += 50) act(() => void vi.advanceTimersByTime(50));
}

const open = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Landing useEntry={useAccountEntry} />} />
        <Route path="/app" element={<p>library</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("Landing", () => {
  it("signs in with Google from the header and the close", () => {
    open();
    const logIn = screen.getByText("landing.head.logIn");
    expect(logIn.closest("button")?.className).toContain("ui-btn-primary");
    fireEvent.click(logIn);
    expect(auth.logIn).toHaveBeenCalledOnce();

    const starts = screen.getAllByText("landing.hero.start");
    expect(starts).toHaveLength(1);
    fireEvent.click(starts[0]);
    expect(auth.logIn).toHaveBeenCalledTimes(2);
    expect(auth.enterWithoutAccount).not.toHaveBeenCalled();
  });

  it("puts the way in without an account first in the header, then Google sign-in, each with short words for a narrow header", () => {
    open();
    const header = [
      ...document.querySelectorAll<HTMLElement>(
        ".landing-head nav a, .landing-head nav button",
      ),
    ];
    expect(header.map((el) => el.getAttribute("aria-label"))).toEqual([
      "landing.withoutAccount",
      "landing.head.logIn",
    ]);
    expect(header[0].querySelector(".landing-head-short")?.textContent).toBe(
      "landing.head.withoutAccount",
    );
    expect(
      header[1].querySelector(".landing-head-last-short")?.textContent,
    ).toBe("landing.head.logInShort");
    expect(
      document.querySelector(".landing-brand")?.getAttribute("aria-label"),
    ).toBeTruthy();
  });

  it("leads the hero only to the demo", () => {
    open();
    const hero = document.querySelector(".landing-hero .landing-cta-buttons");
    expect(
      [...(hero?.querySelectorAll("a, button") ?? [])].map(
        (el) => el.textContent,
      ),
    ).toEqual(["landing.hero.try"]);
  });

  it("keeps one Google sign-in, and asks nothing to be accepted", () => {
    open();
    expect(screen.getAllByText("landing.head.logIn")).toHaveLength(1);
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["while the identity service has not answered", null],
    ["when the identity service does not answer", false],
  ])(
    "offers no Google sign-in %s, and every start enters without an account",
    (_label, reachable) => {
      auth.signInReachable = reachable;
      open();
      expect(screen.queryByText("landing.head.logIn")).toBeNull();

      // The header's way in without an account is its primary, at every
      // width, with short words for a phone and its full name for all.
      const way = document.querySelector<HTMLButtonElement>(
        ".landing-head nav button.ui-btn-primary",
      );
      expect(way?.getAttribute("aria-label")).toBe("landing.withoutAccount");
      expect(way?.querySelector(".landing-head-long")?.textContent).toBe(
        "landing.withoutAccount",
      );
      expect(way?.querySelector(".landing-head-short")?.textContent).toBe(
        "landing.head.withoutAccount",
      );

      for (const start of screen.getAllByText("landing.hero.start"))
        fireEvent.click(start);
      expect(auth.enterWithoutAccount).toHaveBeenCalledOnce();
      expect(auth.logIn).not.toHaveBeenCalled();
    },
  );

  it("enters without an account from the header and the close, with no Google", () => {
    open();
    const ways = screen.getAllByText("landing.withoutAccount");
    expect(ways).toHaveLength(2);
    for (const way of ways) fireEvent.click(way);
    expect(auth.enterWithoutAccount).toHaveBeenCalledTimes(2);
    expect(auth.logIn).not.toHaveBeenCalled();
  });

  // Firefox and Safari cannot open a folder, which is where projects live
  // without an account: each way in says so instead of entering.
  it("stops each way in without an account where the browser cannot open a folder, and offers Google", () => {
    folders = false;
    open();
    for (const way of screen.getAllByText("landing.withoutAccount")) {
      fireEvent.click(way);
      expect(screen.getByText("landing.noFolders.title")).toBeTruthy();
      expect(screen.getByText("landing.noFolders.lead")).toBeTruthy();
      expect(screen.getByText("Chrome")).toBeTruthy();
      expect(screen.getByText("landing.noFolders.signIn")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "confirm.cancel" }));
      expect(screen.queryByText("landing.noFolders.title")).toBeNull();
    }
    expect(auth.enterWithoutAccount).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("landing.withoutAccount")[0]);
    const dialog = screen.getByRole("dialog");
    expect(
      dialog.querySelector('a[href="/app/editor/demo"]')?.textContent,
    ).toBe("landing.noFolders.demo");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "landing.head.logIn" }),
    );
    expect(auth.logIn).toHaveBeenCalledOnce();
  });

  it("offers the demo instead of Google when the browser cannot open a folder and Google does not answer", () => {
    folders = false;
    auth.signInReachable = false;
    open();
    // With no Google, "Start writing" is the way in without an account.
    fireEvent.click(screen.getByText("landing.hero.start"));
    expect(screen.getByText("landing.noFolders.lead")).toBeTruthy();
    expect(screen.queryByText("landing.noFolders.signIn")).toBeNull();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toContain("landing.head.logIn");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "landing.hero.try" }),
    );
    expect(auth.enterWithoutAccount).not.toHaveBeenCalled();
    expect(auth.logIn).not.toHaveBeenCalled();
  });

  it("opens the disclaimer from its band and from the footer", () => {
    open();
    fireEvent.click(screen.getByText("legal.landing.more"));
    expect(screen.getByText("legal.notice.lede")).toBeTruthy();
    fireEvent.click(screen.getByText("legal.close"));
    expect(screen.queryByText("legal.notice.lede")).toBeNull();

    fireEvent.click(screen.getByText("legal.links.notice"));
    expect(screen.getByText("legal.notice.lede")).toBeTruthy();
    expect(screen.getByText("legal.links.privacy").getAttribute("href")).toBe(
      "/privacy",
    );
    expect(screen.getByText("legal.links.terms").getAttribute("href")).toBe(
      "/terms",
    );
  });

  it("offers the demo with no account at each decision point", () => {
    open();
    // The hero, the band after the small demonstrations, and the close.
    const links = screen.getAllByText("landing.hero.try");
    expect(links).toHaveLength(3);
    // Under each demonstration the visitor can try.
    links.push(...screen.getAllByText("landing.tryFull"));
    expect(links).toHaveLength(5);
    for (const link of links)
      expect(link.closest("a")?.getAttribute("href")).toBe("/app/editor/demo");
    // Each pair of ways in carries its price and terms on one line.
    expect(screen.getAllByText("landing.hero.note")).toHaveLength(2);
    // The first question is whether it can be tried without an account.
    expect(document.querySelector(".landing-faq details")?.id).toBe("faq-demo");
  });

  it("shows each screenshot in the theme the visitor wears, sized before it loads", () => {
    open();
    const shot = screen.getByAltText("landing.hero.shotAlt");
    expect(shot.getAttribute("src")).toBe("/landing/matte-dark-section.webp");
    expect(shot.getAttribute("width")).toBe("2560");
    expect(shot.getAttribute("height")).toBe("1600");
  });

  it("opens on the editor itself, loaded at once", () => {
    open();
    const shot = screen.getByAltText("landing.hero.shotAlt");
    expect(shot.closest(".landing-hero")).not.toBeNull();
    expect(shot.getAttribute("loading")).toBe("eager");
    expect(
      screen.getByAltText("landing.cards.desk.alt").getAttribute("loading"),
    ).toBe("lazy");
  });

  it("shows a cropped surface whole, never wider than the app draws it", () => {
    open();
    const shot = screen.getByAltText("landing.cards.ask.alt");
    // The comments surface is captured as its crop alone, at twice the
    // app's pixels, so its frame stops at half the picture's width.
    const { width, height } = shots.surfaces.comments;
    expect(shot.getAttribute("width")).toBe(`${width}`);
    expect(shot.getAttribute("height")).toBe(`${height}`);
    expect(shot.getAttribute("style")).toBeNull();
    expect(shot.closest("figure")?.style.maxWidth).toBe(`${width / 2}px`);
  });

  it("presents a linear discovery from writing to the themes, without the chapter rail", () => {
    open();
    expect(
      screen.queryByRole("navigation", { name: "landing.rail" }),
    ).toBeNull();
    expect(document.querySelector(".landing-rail")).toBeNull();
    expect(
      [...document.querySelectorAll("main > section[id]")].map(
        (section) => section.id,
      ),
    ).toEqual([
      "write",
      "organise",
      "foundation",
      "demo",
      "revise",
      "templates",
      "help",
      "keep",
      "mobile",
      "free",
      "wear",
      "faq",
    ]);
    expect(
      [...document.querySelectorAll("#help > .landing-block[id]")].map(
        (block) => block.id,
      ),
    ).toEqual(["continuity", "letter"]);
    expect(document.querySelector(".landing-numeral")).toBeNull();
    expect(document.querySelector(".landing-hero .landing-live")).toBeNull();
  });

  it("takes a change from the snapshot one at a time", () => {
    open();
    expect(
      screen.getAllByRole("button", { name: "snapshots.acceptChange" }),
    ).toHaveLength(2);
    fireEvent.click(
      screen.getAllByRole("button", { name: "snapshots.acceptChange" })[0],
    );
    expect(
      screen.getAllByRole("button", { name: "snapshots.acceptChange" }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "snapshots.acceptChange" }),
    );
    expect(screen.getByText("snapshots.allAccepted")).toBeTruthy();

    // A coarser view starts over, with the whole sentence as one change.
    fireEvent.change(
      screen.getByRole("combobox", { name: "snapshots.granularity" }),
      { target: { value: "sentence" } },
    );
    expect(
      screen.getAllByRole("button", { name: "snapshots.acceptChange" }),
    ).toHaveLength(1);
  });

  it("shows the app's actual persona picker and the four editorial profiles", () => {
    open();
    expect(
      screen.getByAltText("landing.captures.personas").getAttribute("src"),
    ).toBe("/landing/matte-dark-personas-1.webp");
    for (const name of ["phos", "nova", "spark", "lumi"])
      expect(screen.getByText(`landing.team.${name}.role`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Spark" })).toBeNull();
  });

  it("lets a visitor try every theme, its sheets fetched on the way", () => {
    open();
    expect(prefetchSheets).toHaveBeenCalled();
    const shine = screen.getByRole("button", { name: /Shine/ });
    expect(shine.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(shine);
    expect(looks.setFamily).toHaveBeenCalledWith("shine");
    fireEvent.click(screen.getByRole("button", { name: "once dark" }));
    expect(looks.setScheme).toHaveBeenCalledWith("light");
  });

  it("asks every question the FAQ promises", () => {
    open();
    for (const id of FAQ)
      expect(screen.getByText(`landing.faq.${id}.q`)).toBeTruthy();
  });

  it("sends a signed-in writer to the Library", () => {
    auth.status = "authenticated";
    open();
    expect(screen.getByText("library")).toBeTruthy();
    expect(screen.queryByText("landing.hero.title")).toBeNull();
  });

  it("says why a sign-in did not finish, and Try again asks again", async () => {
    auth.logIn.mockRejectedValueOnce(new PlatformError("popup-blocked"));
    open();
    fireEvent.click(screen.getByText("landing.head.logIn"));

    expect(await screen.findByText("auth.problemTitle")).toBeTruthy();
    expect(screen.getByText("auth.popupBlocked")).toBeTruthy();
    fireEvent.click(screen.getByText("auth.tryAgain"));
    expect(auth.logIn).toHaveBeenCalledTimes(2);
  });

  it("shows a notice left by the account that just ended, once", async () => {
    const { leaveFarewell, peekFarewell } =
      await import("../../../auth/farewell");
    leaveFarewell("auth.farewellRevokePending");
    open();

    expect(screen.getByText("auth.farewellTitle")).toBeTruthy();
    expect(screen.getByText("auth.farewellRevokePending")).toBeTruthy();
    expect(peekFarewell()).toBeNull();
    fireEvent.click(screen.getByText("confirm.done"));
    await waitFor(() =>
      expect(screen.queryByText("auth.farewellTitle")).toBeNull(),
    );
  });

  it("says nothing when the writer closed Google's window", async () => {
    auth.logIn.mockRejectedValueOnce(new PlatformError("flow-cancelled"));
    open();
    fireEvent.click(screen.getByText("landing.head.logIn"));

    await waitFor(() => expect(auth.logIn).toHaveBeenCalledOnce());
    expect(screen.queryByText("auth.problemTitle")).toBeNull();
  });

  it("shows the real editor in the final theme preview", () => {
    open();
    const shot = screen.getByAltText("landing.live.label");
    expect(shot.getAttribute("src")).toBe("/landing/matte-dark-section.webp");
    expect(shot.closest("#wear")).not.toBeNull();
    expect(document.querySelector(".landing-live-bar")).toBeNull();
  });

  it("holds the completed shortcut example for a visitor who asked for less motion", () => {
    still = true;
    vi.useFakeTimers();
    open();
    const line = document.querySelector(".landing-demo-prose");
    expect(line?.textContent).toContain("landing.keys.line");
    const before = line?.textContent;
    tick(10000);
    expect(line?.textContent).toBe(before);
  });

  it("pauses the animated shortcut example in a readable state and can play again", () => {
    vi.useFakeTimers();
    const { container } = open();
    tick(600);
    fireEvent.click(
      screen.getByRole("button", { name: "landing.motion.pause" }),
    );
    const line = container.querySelector(".landing-demo-prose");
    expect(line?.textContent).toContain("landing.keys.line");
    const paused = line?.textContent;
    tick(20000);
    expect(line?.textContent).toBe(paused);
    fireEvent.click(
      screen.getByRole("button", { name: "landing.motion.play" }),
    );
    expect(
      container.querySelector(".landing")?.hasAttribute("data-paused"),
    ).toBe(false);
    const before = line?.textContent;
    tick(2000);
    expect(line?.textContent).not.toBe(before);
  });

  it("keeps the pause control in the header, beside the account actions", () => {
    open();
    const header = document.querySelector(".landing-head");
    expect(
      header?.querySelector('button[aria-label="landing.motion.pause"]'),
    ).not.toBeNull();
  });

  it("holds back only the commands, the personas and the smaller features", () => {
    open();
    const folded = [...document.querySelectorAll<HTMLElement>(".landing-more")];
    expect(
      folded.map(
        (fold) => fold.querySelector(".landing-more-toggle")?.textContent,
      ),
    ).toEqual([
      "landing.team.explore",
      "landing.commands.explore",
      "landing.more",
    ]);
  });

  it("keeps a folded rest inert until its toggle opens it", () => {
    open();
    const toggle = screen.getByRole("button", { name: "landing.more" });
    const body = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body?.hasAttribute("inert")).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hasAttribute("inert")).toBe(false);
  });

  it("shows real multi-selection instead of invented chapter-movement controls", () => {
    open();
    expect(
      screen.getByAltText("landing.cards.structure.alt").getAttribute("src"),
    ).toBe("/landing/matte-dark-structure-1.webp");
    expect(document.querySelector(".landing-structure")).toBeNull();
  });

  it("plays a sequence of real screenshots in turn, and holds it while paused", () => {
    vi.useFakeTimers();
    open();
    const current = () =>
      screen.getByAltText("landing.cards.henosis.alt").getAttribute("src");
    expect(current()).toBe("/landing/matte-dark-henosis-1.webp");
    tick(1400);
    expect(current()).toBe("/landing/matte-dark-henosis-2.webp");
    fireEvent.click(
      screen.getByRole("button", { name: "landing.motion.pause" }),
    );
    tick(10000);
    expect(current()).toBe("/landing/matte-dark-henosis-2.webp");
  });

  it("shows a sample continuity answer inside the real assistant interface", () => {
    open();
    expect(
      screen.getByAltText("landing.captures.continuity").getAttribute("src"),
    ).toBe("/landing/matte-dark-continuity.webp");
    expect(
      screen.queryByRole("button", { name: "landing.context.show" }),
    ).toBeNull();
  });

  it("shows the real revision-plan interface instead of a simulated review", () => {
    open();
    const shot = screen.getByAltText("landing.letter.planAlt");
    expect(shot.getAttribute("src")).toBe("/landing/matte-dark-letter.webp");
    expect(shot.getAttribute("width")).toBe(`${shots.surfaces.letter.width}`);
    expect(
      screen.queryByRole("button", { name: "landing.letter.after" }),
    ).toBeNull();
    expect(
      screen.getByText("landing.commands.explore").closest(".landing-more"),
    ).not.toBeNull();
  });
});

// The demo site's ways in: the download and the demo, and nothing that signs
// in, so the page is the same for every visitor.
describe("Landing on the demo site", () => {
  const openDemoSite = () =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Landing useEntry={useDownloadEntry} />} />
        </Routes>
      </MemoryRouter>,
    );

  it("offers the download in the header and the close, and no sign-in", () => {
    auth.status = "authenticated";
    openDemoSite();
    const downloads = screen.getAllByRole("link", { name: "landing.download" });
    expect(downloads).toHaveLength(2);
    for (const link of downloads)
      expect(link.getAttribute("href")).toBe(QUICKSTART_URL);
    expect(screen.queryByText("landing.head.logIn")).toBeNull();
    expect(screen.queryByText("landing.hero.start")).toBeNull();
    expect(screen.queryByText("landing.withoutAccount")).toBeNull();
    expect(
      document.querySelector(".landing-head .landing-head-last-short")
        ?.textContent,
    ).toBe("landing.head.download");
  });
});
