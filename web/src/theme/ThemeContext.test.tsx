// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { clearThemes, register } from "./application/registry";
import { setCurrentUserId } from "../auth/currentUser";
import { setPref } from "../profile/profileSync";
import { matte } from "./themes/matte";
import { shine } from "./themes/shine";
import { radiant } from "./themes/radiant";
import { choices } from "./compose";
import { applyTheme, loadSheet } from "./page";

vi.mock("../storage/driveProvider", () => ({
  driveProvider: {
    id: "drive",
    writeFile: () => Promise.resolve(),
    readFile: () => Promise.resolve("{}"),
  },
}));

const { storedChoice } = choices;

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

/** Reports both halves, so a test can catch them disagreeing. */
function Probe() {
  const { theme } = useTheme();
  return <span data-testid="state">{theme.id}</span>;
}

function paintedThemeId(): string | undefined {
  return document.documentElement.dataset.theme;
}

// The sheets fetched up front, so a choice goes on at once, as it does once
// Settings has fetched them.
beforeAll(() =>
  Promise.all(
    [matte.light, matte.dark, shine.light, shine.dark].map(loadSheet),
  ),
);

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
  }));
  clearThemes();
  register(matte.light);
  register(matte.dark);
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  // Explicit: this project has no global test setup file, so nothing else
  // unmounts the previous render and the probes would pile up.
  cleanup();
  setCurrentUserId(null);
  clearThemes();
  vi.unstubAllGlobals();
});

describe("ThemeProvider — following the account", () => {
  it("adopts the writer’s own theme when they sign in", () => {
    setCurrentUserId("user-a");
    setPref("theme", matte.light.id);
    setCurrentUserId(null);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe(matte.dark.id);

    act(() => setCurrentUserId("user-a"));

    expect(screen.getByTestId("state").textContent).toBe(matte.light.id);
  });

  // A repaint in `adapters/page.ts`, which touches the DOM and nothing else,
  // would leave `useTheme()` reporting a theme the page has stopped wearing.
  it("keeps the page and the React state in step across that switch", () => {
    setCurrentUserId("user-a");
    setPref("theme", matte.dark.id);
    setCurrentUserId(null);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => setCurrentUserId("user-a"));

    expect(paintedThemeId()).toBe(matte.dark.id);
    expect(screen.getByTestId("state").textContent).toBe(paintedThemeId());
  });

  it("falls back to the default when the writer signs out", () => {
    setCurrentUserId("user-a");
    setPref("theme", matte.light.id);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe(matte.light.id);

    act(() => setCurrentUserId(null));

    expect(screen.getByTestId("state").textContent).toBe(matte.dark.id);
    expect(paintedThemeId()).toBe(matte.dark.id);
  });

  it("swaps one account’s theme for another’s on a user switch", () => {
    setCurrentUserId("user-a");
    setPref("theme", matte.dark.id);
    setCurrentUserId("user-b");
    setPref("theme", matte.dark.id);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe(matte.dark.id);

    act(() => setCurrentUserId("user-a"));

    expect(screen.getByTestId("state").textContent).toBe(matte.dark.id);
  });

  // Re-deriving a choice is not making one. Writing it back would stamp a
  // fresh timestamp on a preference nobody touched, enough to beat the device
  // where the writer changed it in the next merge.
  it("does not write the preference back while re-deriving it", () => {
    setCurrentUserId("user-a");
    setPref("theme", matte.dark.id);
    const before = localStorage.getItem("profile.user-a");
    setCurrentUserId(null);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => setCurrentUserId("user-a"));

    expect(localStorage.getItem("profile.user-a")).toBe(before);
  });

  it("stops listening once unmounted", () => {
    const view = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    view.unmount();

    setCurrentUserId("user-a");
    setPref("theme", matte.dark.id);

    expect(() => act(() => setCurrentUserId(null))).not.toThrow();
  });
});

// A writer picks a theme, then its variant. Each choice keeps the other:
// changing theme keeps still dark still dark, and flipping the variant never
// leaves the theme in use.
describe("ThemeProvider — a theme and its variant", () => {
  function Chooser() {
    const { theme, setFamily, setScheme } = useTheme();
    return (
      <>
        <span data-testid="state">{theme.id}</span>
        <button onClick={() => setFamily("shine")}>shine</button>
        <button onClick={() => setFamily("matte")}>matte</button>
        <button onClick={() => setScheme("dark")}>dark</button>
        <button onClick={() => setScheme("light")}>light</button>
      </>
    );
  }

  beforeEach(() => {
    register(shine.light);
    register(shine.dark);
  });

  it("changes theme and keeps the variant, then the variant and keeps the theme", () => {
    render(
      <ThemeProvider>
        <Chooser />
      </ThemeProvider>,
    );
    const state = () => screen.getByTestId("state").textContent;
    expect(state()).toBe("matte-dark");

    act(() => screen.getByText("light").click());
    expect(state()).toBe("matte-light");

    act(() => screen.getByText("shine").click());
    expect(state()).toBe("shine-light");
    expect(paintedThemeId()).toBe("shine-light");

    act(() => screen.getByText("dark").click());
    expect(state()).toBe("shine-dark");

    act(() => screen.getByText("matte").click());
    expect(state()).toBe("matte-dark");
  });

  it("remembers the variant it lands on, family and scheme in one key", () => {
    // Preferences are kept per account; with nobody signed in there is
    // nowhere to keep one.
    setCurrentUserId("u1");
    render(
      <ThemeProvider>
        <Chooser />
      </ThemeProvider>,
    );
    act(() => screen.getByText("shine").click());
    act(() => screen.getByText("dark").click());
    expect(storedChoice()).toBe("shine-dark");
  });

  it("composes a theme and its variant chosen in the same tick", () => {
    render(
      <ThemeProvider>
        <Chooser />
      </ThemeProvider>,
    );
    // One act, no render between: the variant must apply to the theme just
    // chosen, not to the one the page was on.
    act(() => {
      screen.getByText("shine").click();
      screen.getByText("dark").click();
    });
    expect(screen.getByTestId("state").textContent).toBe("shine-dark");
    expect(paintedThemeId()).toBe("shine-dark");
  });
});

// A choice that follows the system repaints as the system's scheme changes,
// and keeps following across a change of theme.
describe("ThemeProvider — following the system", () => {
  let dark = false;
  const listeners = new Set<() => void>();

  function System() {
    const { theme, mode, setFamily, setScheme } = useTheme();
    return (
      <>
        <span data-testid="state">{`${theme.id} ${mode}`}</span>
        <button onClick={() => setScheme("system")}>system</button>
        <button onClick={() => setScheme("light")}>light</button>
        <button onClick={() => setFamily("shine")}>shine</button>
      </>
    );
  }

  function flip(next: boolean) {
    dark = next;
    act(() => listeners.forEach((listener) => listener()));
  }

  beforeEach(() => {
    dark = false;
    listeners.clear();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return dark && query.includes("dark");
      },
      media: query,
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
    }));
    register(shine.light);
    register(shine.dark);
  });

  it("follows the system's scheme as it changes", () => {
    setCurrentUserId("u1");
    render(
      <ThemeProvider>
        <System />
      </ThemeProvider>,
    );
    const state = () => screen.getByTestId("state").textContent;
    act(() => screen.getByText("system").click());
    expect(state()).toBe("matte-light system");
    expect(storedChoice()).toBe("matte-system");

    flip(true);
    expect(state()).toBe("matte-dark system");
    expect(paintedThemeId()).toBe("matte-dark");
    expect(storedChoice()).toBe("matte-system");

    act(() => screen.getByText("shine").click());
    expect(state()).toBe("shine-dark system");
    expect(storedChoice()).toBe("shine-system");
  });

  it("stays on a chosen variant when the system changes", () => {
    render(
      <ThemeProvider>
        <System />
      </ThemeProvider>,
    );
    act(() => screen.getByText("light").click());
    flip(true);
    expect(screen.getByTestId("state").textContent).toBe("matte-light light");
  });

  it("keeps a first-time visitor in still dark whatever the system asks", () => {
    render(
      <ThemeProvider>
        <System />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("matte-dark dark");
    flip(true);
    flip(false);
    expect(screen.getByTestId("state").textContent).toBe("matte-dark dark");
  });
});

// A theme the writer has not worn on this visit has its sheet fetched when
// chosen: the page keeps its theme until the sheet is here, and the latest
// choice is the one that goes on.
describe("ThemeProvider — a sheet fetched on choosing", () => {
  function Chooser() {
    const { theme, setFamily, setScheme } = useTheme();
    return (
      <>
        <span data-testid="state">{theme.id}</span>
        <button onClick={() => setFamily("shine")}>shine</button>
        <button onClick={() => setFamily("matte")}>matte</button>
        <button onClick={() => setScheme("dark")}>dark</button>
        <button onClick={() => setScheme("light")}>light</button>
      </>
    );
  }

  let arrive: (css: string) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const page = () => (
    <ThemeProvider>
      <Chooser />
    </ThemeProvider>
  );
  let again: (ui: React.ReactElement) => void = () => {};

  beforeEach(() => {
    // A loader of its own, so its sheet is not one fetched before.
    const fetching = new Promise<string>((done, refuse) => {
      arrive = done;
      fail = refuse;
    });
    const sheet = () => fetching;
    register({ ...shine.light, sheet });
    register({ ...shine.dark, sheet });
    // The page wears its first theme before the provider mounts (`main.tsx`).
    applyTheme(matte.dark);
    again = render(page()).rerender;
  });

  const state = () => screen.getByTestId("state").textContent;

  it("keeps the page as it was until the sheet is here", async () => {
    act(() => setCurrentUserId("user-a"));
    act(() => screen.getByText("shine").click());
    expect(state()).toBe("matte-dark");
    expect(paintedThemeId()).not.toBe("shine-dark");
    expect(storedChoice()).toBeNull();
    // The app renders on while the sheet is fetched.
    again(page());
    await act(async () => arrive(".x { color: red; }"));
    expect(state()).toBe("shine-dark");
    expect(paintedThemeId()).toBe("shine-dark");
    expect(storedChoice()).toBe("shine-dark");
  });

  it("puts on the latest choice, made while the sheet was fetched", async () => {
    act(() => screen.getByText("shine").click());
    act(() => screen.getByText("dark").click());
    await act(async () => arrive(".x { color: red; }"));
    expect(state()).toBe("shine-dark");
    expect(paintedThemeId()).toBe("shine-dark");
  });

  it("drops a choice another overtook before its sheet came", async () => {
    act(() => screen.getByText("shine").click());
    act(() => screen.getByText("matte").click());
    await act(async () => arrive(".x { color: red; }"));
    expect(state()).toBe("matte-dark");
    expect(paintedThemeId()).toBe("matte-dark");
  });

  it("stays in its theme, and keeps no choice, when the sheet cannot be fetched", async () => {
    act(() => setCurrentUserId("user-a"));
    act(() => screen.getByText("shine").click());
    await act(async () => fail(new Error("offline")));
    expect(state()).toBe("matte-dark");
    expect(storedChoice()).toBeNull();
    act(() => screen.getByText("light").click());
    expect(state()).toBe("matte-light");
  });
});

// A synced choice, from another device or a re-read, is compared with the
// choice in force, theme and mode, and put on without being written back.
describe("ThemeProvider — following the stored choice", () => {
  function Follower() {
    const { theme, mode, followStored } = useTheme();
    return (
      <>
        <span data-testid="state">{`${theme.id} ${mode}`}</span>
        <button onClick={followStored}>follow</button>
      </>
    );
  }

  it("leaves a choice that follows the system alone, and writes nothing", () => {
    setCurrentUserId("user-a");
    setPref("theme", "matte-system");
    const before = localStorage.getItem("profile.user-a");
    render(
      <ThemeProvider>
        <Follower />
      </ThemeProvider>,
    );
    act(() => screen.getByText("follow").click());
    expect(screen.getByTestId("state").textContent).toBe("matte-light system");
    expect(localStorage.getItem("profile.user-a")).toBe(before);
  });

  it("takes a fixed variant from another device over following the system", () => {
    setCurrentUserId("user-a");
    setPref("theme", "matte-system");
    render(
      <ThemeProvider>
        <Follower />
      </ThemeProvider>,
    );
    setPref("theme", "matte-light");
    act(() => screen.getByText("follow").click());
    expect(screen.getByTestId("state").textContent).toBe("matte-light light");
  });

  it("puts the choice on a page that wears none yet, once the account is known", () => {
    render(
      <ThemeProvider>
        <Follower />
      </ThemeProvider>,
    );
    expect(paintedThemeId()).toBeUndefined();
    act(() => setCurrentUserId("user-b"));
    expect(paintedThemeId()).toBe("matte-dark");
  });
});

// The fade runs its update later, after the browser has its picture; a
// choice made before then wins over the one the fade was started for.
describe("ThemeProvider — a switch behind the fade", () => {
  let updates: (() => void)[] = [];

  function Chooser() {
    const { theme, setScheme } = useTheme();
    return (
      <>
        <span data-testid="state">{theme.id}</span>
        <button onClick={() => setScheme("dark")}>dark</button>
        <button onClick={() => setScheme("light")}>light</button>
      </>
    );
  }

  beforeEach(() => {
    updates = [];
    Object.assign(document, {
      startViewTransition: (update: () => void) => {
        updates.push(update);
        return {
          ready: Promise.resolve(),
          finished: new Promise<void>(() => {}),
        };
      },
    });
    applyTheme(matte.light);
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("lands on the later choice when the earlier fade runs after it", () => {
    setCurrentUserId("user-a");
    setPref("theme", "matte-light");
    render(
      <ThemeProvider>
        <Chooser />
      </ThemeProvider>,
    );
    act(() => screen.getByText("dark").click());
    act(() => screen.getByText("light").click());
    act(() => updates.forEach((update) => update()));
    expect(paintedThemeId()).toBe("matte-light");
    expect(screen.getByTestId("state").textContent).toBe("matte-light");
    expect(storedChoice()).toBe("matte-light");
  });
});

// A sheet that cannot be fetched hands the choice back to what the page
// wears, not to another choice still on its way.
describe("ThemeProvider — two fetches, one dropped and one failed", () => {
  it("returns to the theme on the page", async () => {
    let arriveShine: (css: string) => void = () => {};
    let failRadiant: (error: Error) => void = () => {};
    const shineSheet = new Promise<string>((done) => (arriveShine = done));
    const radiantSheet = new Promise<string>(
      (_done, refuse) => (failRadiant = refuse),
    );
    register({ ...shine.dark, sheet: () => shineSheet });
    register({ ...radiant.dark, sheet: () => radiantSheet });
    applyTheme(matte.dark);

    function Chooser() {
      const { theme, setFamily, setScheme } = useTheme();
      return (
        <>
          <span data-testid="state">{theme.id}</span>
          <button onClick={() => setFamily("shine")}>shine</button>
          <button onClick={() => setFamily("radiant")}>radiant</button>
          <button onClick={() => setScheme("light")}>light</button>
        </>
      );
    }
    render(
      <ThemeProvider>
        <Chooser />
      </ThemeProvider>,
    );
    act(() => screen.getByText("shine").click());
    act(() => screen.getByText("radiant").click());
    await act(async () => arriveShine(".x { color: red; }"));
    await act(async () => failRadiant(new Error("offline")));
    expect(screen.getByTestId("state").textContent).toBe("matte-dark");
    act(() => screen.getByText("light").click());
    expect(screen.getByTestId("state").textContent).toBe("matte-light");
  });
});
