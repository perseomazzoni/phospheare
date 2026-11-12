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
  waitFor,
} from "@testing-library/react";
import { createContext, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { AuthUser } from "../auth/AuthContext";
import type { AssistantDependencies } from "../ai";
import { getCurrentUserId, setCurrentUserId } from "../auth/currentUser";
import type { Platform } from "../platform";
import {
  DEFAULT_FILES,
  FakeProvider,
  PROPS,
  STRUCTURE,
  seedProps,
} from "./project.fixture";
import { STRUCTURE_FILE } from "../project/naming";
import { DEMO_MODEL, DemoModelProvider } from "../ai/adapters/demo";
import {
  forgetRemoteProviders,
  refreshRemoteProviders,
} from "../ai/host/openrouterConnection";

// ── The demo answers from the demo model ─────────────────────────────────────
//
// The demo route is public and sits outside `SessionGate` but inside
// `AuthProvider` (`App.tsx`), so a signed-in visitor reaches it with their
// session. The demo's Assistant answers from the static demo model alone, so
// the bridge builds nothing from that session: no device model, and no
// OpenRouter adapter spending the visitor's key on the demo book. The
// control is one line in the bridge, so these rows go through the real bridge
// with a signed-in user who has a connected remote; a bare `Workspace`
// harness has no account and would pass whatever the bridge did.
//
// Counted at construction, because an adapter that exists is one a later
// change can call; the rows do not wait for a request that may never be made.
//
// The same real bridge carries the search wiring's rows: what it
// hands the Assistant is observable only here.

const built = vi.hoisted(() => ({
  assistant: 0,
  remote: 0,
  device: 0,
  wikipedia: 0,
  providerSearch: 0,
  deps: null as unknown,
  // A search the next-built Assistant reports as waiting on the writer, and
  // the reveal it was asked for.
  pending: null as unknown,
  revealed: 0,
}));

vi.mock("../ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ai")>();
  class Assistant extends real.Assistant {
    constructor(...args: ConstructorParameters<typeof real.Assistant>) {
      super(...args);
      built.assistant += 1;
      built.deps = args[0];
      const pending = built.pending;
      if (pending) {
        // One object per base snapshot: `useSyncExternalStore` loops on a
        // snapshot that is new on every read.
        const base = this.getSnapshot;
        let seen: ReturnType<typeof base> | null = null;
        let shown: ReturnType<typeof base> | null = null;
        this.getSnapshot = () => {
          const now = base();
          if (now !== seen || !shown) {
            seen = now;
            shown = { ...now, pendingSearch: pending as never };
          }
          return shown;
        };
      }
    }
    override revealPendingSearch(): void {
      built.revealed += 1;
      super.revealPendingSearch();
    }
  }
  return { ...real, Assistant };
});
// The bridge builds every OpenRouter adapter and both engines through these
// three factories, so counting them counts what the bridge built.
vi.mock("../ai/host/openrouterConnection", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../ai/host/openrouterConnection")>();
  return {
    ...real,
    openRouterProvider: (
      ...args: Parameters<typeof real.openRouterProvider>
    ) => {
      built.remote += 1;
      return real.openRouterProvider(...args);
    },
    openRouterSearch: (...args: Parameters<typeof real.openRouterSearch>) => {
      built.providerSearch += 1;
      return real.openRouterSearch(...args);
    },
    wikipediaSearch: (...args: Parameters<typeof real.wikipediaSearch>) => {
      built.wikipedia += 1;
      return real.wikipediaSearch(...args);
    },
  };
});
vi.mock("../ai/host/deviceConnectionAdapter", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../ai/host/deviceConnectionAdapter")>();
  class DeviceOllamaProvider extends real.DeviceOllamaProvider {
    constructor(
      ...args: ConstructorParameters<typeof real.DeviceOllamaProvider>
    ) {
      super(...args);
      built.device += 1;
    }
  }
  return { ...real, DeviceOllamaProvider };
});

// The account comes through a context the rows own, so a row can hand the
// bridge a re-read of the same account (a new object, the same id) or a
// different one, as the account layer would.
interface AuthStub {
  user: AuthUser | null;
  refresh: () => Promise<void>;
  status: "authenticated";
}
vi.mock("../auth/AuthContext", async () => {
  const { createContext: make, useContext } = await import("react");
  const Stub = make<AuthStub | null>(null);
  return {
    AuthStub: Stub,
    useAuth: () => {
      const value = useContext(Stub);
      if (!value) throw new Error("no auth stub");
      return value;
    },
  };
});
// Stable across renders, as in the workspace suite: a `t` minted per call
// re-runs every effect that depends on it, and the surface never settles.
const i18n = vi.hoisted(() => ({
  t: (key: string) => key,
  i18n: { language: "en", resolvedLanguage: "en" },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => i18n }));
vi.mock("./tree/DocumentTree", () => ({ default: () => null }));

// The real bundle, as `projectFacts.test.ts` does: the Wikipedia engine
// reads the edition through `projectFactsOf`, whose beats are an i18next
// lookup, and an uninitialised instance throws there.
const { default: i18next } = await import("i18next");
const { default: en } = await import("../locales/en.json");
await i18next.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

const { EditorScreen } = await import("./EditorRoute");
const { EditorServicesProvider } = await import("./services/context");
const { accountServices } = await import("./services/account");
const { demoEditorServices } = await import("./services/demo");
const { useAuth } = await import("../auth/AuthContext");
// The demo route's services as `App.tsx` builds them: the signed-in face,
// and nothing of the session behind it.
const demoServices = demoEditorServices({ useFace: () => useAuth().user });
const { AuthStub } = (await import("../auth/AuthContext")) as unknown as {
  AuthStub: ReturnType<typeof createContext<AuthStub | null>>;
};

// jsdom measures no client rects, and the demo opens a file whose caret
// asks for them: give it the empty answer jsdom implies, as the workspace
// suite does.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
Element.prototype.scrollIntoView = () => {};
// The real route mounts the whole writing surface for every row, which is
// slow in jsdom and several times slower under coverage: the workspace
// suite's own reason for the same raised timeout.
vi.setConfig({ testTimeout: 60000 });

const refresh = vi.fn(() => Promise.resolve());

type Connection = NonNullable<AuthUser["openRouter"]>;

function signedIn(id: string, openrouter: Partial<Connection> = {}): AuthUser {
  return {
    id,
    name: "Ada",
    email: `${id}@example.org`,
    avatarUrl: null,
    withGoogle: true,
    driveConnected: false,
    driveEmail: null,
    welcomed: true,
    remoteCopiesKept: false,
    openRouter: {
      providerId: "openrouter",
      connected: true,
      upstreamHost: "openrouter.ai",
      accountLabel: null,
      expiresAtOrBefore: null,
      limitUsd: 5,
      state: "ready",
      notice: null,
      waitUntil: null,
      spentUsd: null,
      remainingUsd: null,
      spentShare: null,
      remembered: false,
      refusal: null,
      required: { limitUsd: 10 },
      ...openrouter,
    },
  };
}

// A small project behind the real route rather than the demo's own fixture
// book: the editor services are the fact under test, and the bridge reads
// nothing else about the route. The fixture book is the whole demo novel,
// which the real writing surface lays out in full; jsdom takes minutes over
// it.
function project(language = "en") {
  const fake = new FakeProvider();
  for (const [path, content] of Object.entries(DEFAULT_FILES))
    fake.files.set(path, content);
  seedProps(
    fake,
    PROPS.replace('"language": "en"', `"language": "${language}"`),
  );
  fake.files.set(STRUCTURE_FILE, STRUCTURE);
  return fake;
}

function screenFor(demo: boolean, language?: string) {
  const provider = project(language);
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <EditorServicesProvider value={demo ? demoServices : accountServices}>
            <EditorScreen provider={provider} projectKey="proj" />
          </EditorServicesProvider>
        ),
      },
    ],
    { initialEntries: ["/app/editor/demo"] },
  );
  const wrap = (user: AuthUser): ReactNode => (
    <AuthStub.Provider value={{ user, refresh, status: "authenticated" }}>
      <RouterProvider router={router} />
    </AuthStub.Provider>
  );
  return { router, wrap };
}

/** Settle the open pipeline and every effect it schedules. */
async function settled() {
  await waitFor(() =>
    expect(document.querySelector(".editor-shell")).toBeTruthy(),
  );
  for (let i = 0; i < 5; i += 1) await act(async () => {});
}

beforeEach(() => {
  built.pending = null;
  built.revealed = 0;
  built.assistant = 0;
  built.remote = 0;
  built.device = 0;
  built.wikipedia = 0;
  built.providerSearch = 0;
  built.deps = null;
  refresh.mockClear();
});
afterEach(cleanup);

describe("the demo's Assistant answers from the demo model", () => {
  it("builds no real model for a signed-in visitor with a connected key", async () => {
    const { wrap } = screenFor(true);
    render(wrap(signedIn("u1")));
    await waitFor(() => expect(built.assistant).toBeGreaterThan(0));
    await settled();

    const deps = built.deps as AssistantDependencies;
    expect(deps.model).toBeInstanceOf(DemoModelProvider);
    // A first chat starts on it, so the visitor never meets an empty model
    // button.
    expect(deps.defaultModel).toEqual(DEMO_MODEL);
    expect(built).toMatchObject({
      remote: 0,
      device: 0,
      // No search engine either: the demo reaches no search route.
      wikipedia: 0,
      providerSearch: 0,
    });
  });

  it("the same visitor on a real project gets both", async () => {
    // The twin of the row above, which a bridge that built nothing anywhere
    // would pass.
    const { wrap } = screenFor(false);
    render(wrap(signedIn("u1")));
    await waitFor(() => expect(built.assistant).toBeGreaterThan(0));

    expect(built.remote).toBeGreaterThan(0);
    expect(built.device).toBeGreaterThan(0);
    expect(built.deps).not.toHaveProperty("defaultModel");
  });

  it("a real project's bar carries the spark from its first paint", async () => {
    // The buttons key on the Assistant, so an Assistant built one commit after
    // the bar brings the spark a cell late and the bar jumps. Every commit is
    // watched, and no bar shows the camera without the spark beside it.
    const painted: boolean[] = [];
    const watch = new MutationObserver(() => {
      if (!document.querySelector('button[aria-label="toolbar.snapshot"]'))
        return;
      painted.push(
        !!document.querySelector('button[aria-label="toolbar.assistant"]'),
      );
    });
    watch.observe(document.body, { childList: true, subtree: true });
    try {
      const { wrap } = screenFor(false);
      render(wrap(signedIn("u1")));
      // The project opens on its Desk; the bar arrives with the first
      // file, which is the moment this row is about.
      const resume = await waitFor(() => {
        const found = [...document.querySelectorAll("button")].find((button) =>
          button.textContent?.includes("desk.continue"),
        );
        if (!found) throw new Error("no Desk yet");
        return found;
      });
      fireEvent.click(resume);
      await waitFor(() =>
        expect(
          document.querySelector('button[aria-label="toolbar.snapshot"]'),
        ).toBeTruthy(),
      );
      await settled();
    } finally {
      watch.disconnect();
    }

    expect(painted.length).toBeGreaterThan(0);
    expect(painted.every(Boolean)).toBe(true);
  });

  it("a re-read of the same account keeps the Assistant, so no answer is aborted", async () => {
    const { wrap } = screenFor(false);
    const view = render(wrap(signedIn("u1")));
    await waitFor(() => expect(built.assistant).toBeGreaterThan(0));
    await settled();
    const before = built.assistant;

    // The account is read again: a new object, the same writer.
    view.rerender(wrap(signedIn("u1")));
    await settled();

    expect(built.assistant).toBe(before);
  });

  it("a different account gets a new Assistant, never the last one's", async () => {
    // A run started for one account never sends steps on another's key:
    // a changed id replaces it, even when both accounts have the
    // same providers connected.
    const { wrap } = screenFor(false);
    const view = render(wrap(signedIn("u1")));
    await waitFor(() => expect(built.assistant).toBeGreaterThan(0));
    await settled();
    const before = built.assistant;

    view.rerender(wrap(signedIn("u2")));
    await settled();

    expect(built.assistant).toBe(before + 1);
  });
});

// ── The search the bridge offers ─────────────────────────────────────────────

const webSearch = () => (built.deps as AssistantDependencies | null)?.webSearch;

/** A run on a model the writer chose at the provider, and one on the device. */
const REMOTE = { providerId: "openrouter", modelId: "vendor/chosen" };
const DEVICE = { providerId: "ollama", modelId: "llama3:latest" };

describe("the search the bridge offers an Assistant", () => {
  async function opened(user: AuthUser, demo = false, language?: string) {
    const { wrap } = screenFor(demo, language);
    const view = render(wrap(user));
    await waitFor(() => expect(built.assistant).toBeGreaterThan(0));
    await settled();
    return { rerender: (next: AuthUser) => view.rerender(wrap(next)) };
  }

  it("builds the floor and a searching provider's engine on a real project", async () => {
    await opened(signedIn("u1"));

    expect(built.wikipedia).toBeGreaterThan(0);
    expect(built.providerSearch).toBe(1);
    expect(webSearch()?.wikipedia.engine).toEqual({ kind: "wikipedia" });
    expect(webSearch()?.accountId).toBe(getCurrentUserId);
  });

  it("the demo builds neither engine for a visitor whose provider can search", async () => {
    const { wrap } = screenFor(true);
    render(wrap(signedIn("u1")));
    await settled();

    expect(built.wikipedia).toBe(0);
    expect(built.providerSearch).toBe(0);
    expect(webSearch()).toBeUndefined();
  });

  it("offers the provider while its key can answer, and follows the verdict without a rebuild", async () => {
    const { rerender } = await opened(signedIn("u1"));
    const assistants = built.assistant;
    const engine = webSearch()?.provider(REMOTE);

    expect(engine?.engine).toEqual({
      kind: "provider",
      providerId: "openrouter",
    });
    // One value per provider, so the ask can hold it.
    expect(webSearch()?.provider(REMOTE)).toBe(engine);

    rerender(signedIn("u1", { state: "limit-reached" }));
    await settled();
    expect(webSearch()?.provider(REMOTE)).toBeNull();

    rerender(signedIn("u1"));
    await settled();
    expect(webSearch()?.provider(REMOTE)).toBe(engine);
    expect(built.assistant).toBe(assistants);
    expect(built.providerSearch).toBe(1);
  });

  it("searches on the run's own model, and offers no provider for a model it cannot search on", async () => {
    await opened(signedIn("u1"));

    // One engine per model, so each ask holds the engine of its own model.
    const other = { providerId: "openrouter", modelId: "vendor/other" };
    expect(webSearch()?.provider(other)).not.toBe(
      webSearch()?.provider(REMOTE),
    );
    expect(webSearch()?.provider(other)).toBe(webSearch()?.provider(other));
    // A device model, or a variant: Wikipedia, never another model.
    expect(webSearch()?.provider(DEVICE)).toBeNull();
    expect(
      webSearch()?.provider({ ...REMOTE, modelId: "vendor/chosen:free" }),
    ).toBeNull();
  });

  it("a re-read of the same account after a search keeps the Assistant and its engine", async () => {
    // A provider search re-reads the account (`onSpent`), and an engine set
    // keyed on that object would rebuild the Assistant and abort the answer
    // that searched.
    const { rerender } = await opened(signedIn("u1"));
    const assistants = built.assistant;
    const engine = webSearch()?.provider(REMOTE);

    rerender(signedIn("u1"));
    await settled();

    expect(built.assistant).toBe(assistants);
    expect(webSearch()?.provider(REMOTE)).toBe(engine);
  });

  it("offers no provider that went disconnected, even while its engine exists", async () => {
    const { rerender } = await opened(signedIn("u1"));
    // A stale Assistant's thunk must read the live row, not the one it was
    // built with.
    const stale = webSearch();

    rerender(signedIn("u1", { connected: false }));
    await settled();

    expect(stale?.provider(REMOTE)).toBeNull();
  });

  // What the engines are built with, observed through a request.
  // The engines call the global `fetch` when they search, and
  // the key's reading calls it too, so the stub goes in before the route
  // renders.
  let keyReads = 0;
  function stubFetch() {
    const sent: Array<{ url: string; body: unknown }> = [];
    keyReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://openrouter.ai/api/v1/key") {
          keyReads += 1;
          return new Response(
            JSON.stringify({
              data: { limit: 5, limit_remaining: 5, usage: 0, byok_usage: 0 },
            }),
            { status: 200 },
          );
        }
        sent.push({
          url,
          body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        });
        return new Response(JSON.stringify({ pages: [] }), { status: 200 });
      }),
    );
    return sent;
  }

  /** A key in this tab for `writerId`, as a remembered vault entry yields. */
  async function holdKey(writerId: string) {
    setCurrentUserId(writerId);
    localStorage.setItem(`openrouter.remember.${writerId}`, "1");
    const vault = {
      get: async () => "sk-or-test",
      set: async () => ({ remembered: true }),
      delete: async () => undefined,
    };
    await refreshRemoteProviders(writerId, { vault } as unknown as Platform);
  }

  it("searches the edition of the book's own language", async () => {
    const sent = stubFetch();
    let outcome: unknown;
    try {
      await opened(signedIn("u1"), false, "it");
      outcome = await webSearch()?.wikipedia.search(
        "Roma",
        new AbortController().signal,
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(outcome).toEqual({ status: "searched", results: [] });
    expect(sent).toEqual([
      {
        url: "https://it.wikipedia.org/w/rest.php/v1/search/page?q=Roma&limit=5",
        body: null,
      },
    ]);
  });

  it("reads the key again after a provider search", async () => {
    const sent = stubFetch();
    try {
      await holdKey("u1");
      await opened(signedIn("u1"));
      const before = keyReads;
      await webSearch()
        ?.provider(REMOTE)
        ?.search("rome", new AbortController().signal);
      await waitFor(() => expect(keyReads).toBeGreaterThan(before));
    } finally {
      vi.unstubAllGlobals();
      forgetRemoteProviders("u1");
      setCurrentUserId(null);
    }

    expect(sent.map((one) => one.url)).toEqual([
      "https://openrouter.ai/api/v1/chat/completions",
    ]);
  });

  it("builds no provider engine while no key is connected", async () => {
    await opened(signedIn("u1", { connected: false, state: null }));

    expect(built.providerSearch).toBe(0);
    expect(webSearch()?.provider(REMOTE)).toBeNull();
    // The floor stays: any account may search Wikipedia.
    expect(webSearch()?.wikipedia).toBeTruthy();
  });
});

// ── Ask buttons while a search waits ─────────────────────────────────────────

describe("the Ask buttons while a search waits", () => {
  const ASK = {
    askId: "ask-1",
    engine: { kind: "wikipedia" },
    kind: "first",
    rows: [{ rowId: "r0", query: "Porta Pia", bookWords: false }],
  };
  const control = (name: string) =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

  async function opened() {
    built.pending = ASK;
    const { wrap } = screenFor(false);
    render(wrap(signedIn("u1")));
    const resume = await waitFor(() => {
      const found = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("desk.continue"),
      );
      if (!found) throw new Error("no Desk yet");
      return found;
    });
    fireEvent.click(resume);
    await waitFor(() =>
      expect(control("toolbar.assistantWaiting")).toBeTruthy(),
    );
    await settled();
  }

  it("marks the bar's Ask button, brings the writer to the ask, then toggles as always", async () => {
    await opened();
    const marked = control("toolbar.assistantWaiting");
    expect(marked?.getAttribute("data-attention")).toBe("1");
    expect(built.revealed).toBe(0);

    await act(async () => marked?.click());
    // The face is in view: the button is pressed, plain and named plainly; the
    // mark and the name leave together.
    const plain = control("toolbar.assistant");
    expect(built.revealed).toBe(1);
    expect(plain?.getAttribute("aria-pressed")).toBe("true");
    expect(plain?.hasAttribute("data-attention")).toBe(false);

    // A press on the unmarked, pressed button shuts the dock and reveals
    // nothing: it never swaps the writer's chat.
    await act(async () => plain?.click());
    expect(built.revealed).toBe(1);
    expect(control("toolbar.assistantWaiting")).toBeTruthy();
  });

  it("marks the Ask tab and routes it through the same handler", async () => {
    await opened();
    // Open the dock on another face: the Ask tab is then marked.
    await act(async () => control("toolbar.snapshot")?.click());
    const tab = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '.ui-bar-track button[aria-label="dock.askWaiting"]',
      );
      if (!found) throw new Error("no marked Ask tab");
      return found;
    });
    expect(tab.getAttribute("data-attention")).toBe("1");
    await act(async () => tab.click());
    expect(built.revealed).toBe(1);
    expect(
      document.querySelector('.ui-bar-track button[aria-label="dock.ask"]'),
    ).toBeTruthy();
  });

  it("an unmarked Ask tab reveals nothing: the face is already in view", async () => {
    await opened();
    await act(async () => control("toolbar.assistantWaiting")?.click());
    expect(built.revealed).toBe(1);
    const tab = document.querySelector<HTMLElement>(
      '.ui-bar-track button[aria-label="dock.ask"]',
    );
    expect(tab?.hasAttribute("data-attention")).toBe(false);
    await act(async () => tab?.click());
    expect(built.revealed).toBe(1);
  });

  it("names the palette's entry by the wait", async () => {
    await opened();
    await act(async () => control("titlebar.palette")?.click());
    await waitFor(() =>
      expect(document.body.textContent).toContain("toolbar.assistantWaiting"),
    );
  });
});
