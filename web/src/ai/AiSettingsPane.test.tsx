// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { OllamaProvider } from "./adapters/ollama";
import { PERSONAS } from "./domain/personas";
import AiSettingsPane from "./AiSettingsPane";
import { DeviceConnectionPreferences } from "./host/deviceConnectionAdapter";
import type { ModelDescriptor, ModelRef } from "./domain/types";
import type { RemoteModelPreferences, RemoteProviderStatus } from "./ports";

const connection = new DeviceConnectionPreferences();

/**
 * A curated set held in memory. The real one writes through the preference
 * drain, which needs an open writer; these rows pin what the pane does with
 * the port, not how the port stores the set.
 */
class FakeRemoteModels implements RemoteModelPreferences {
  constructor(private models: readonly ModelRef[] = []) {}
  chosen(): readonly ModelRef[] {
    return this.models;
  }
  choose(models: readonly ModelRef[]): void {
    this.models = models;
  }
}

function pane(
  options: {
    remoteModels?: RemoteModelPreferences;
    remoteProviders?: readonly RemoteProviderStatus[];
    onConnect?: (providerId: string) => void;
    connectBlocked?: boolean;
    connecting?: string | null;
    readCatalogue?: (
      providerId: string,
      signal: AbortSignal,
    ) => Promise<ModelDescriptor[]>;
    onDisconnect?: (providerId: string) => void;
    onRemember?: (providerId: string, remember: boolean) => void;
    credentialProtection?: "sealed" | "unavailable";
  } = {},
) {
  return (
    <AiSettingsPane
      connection={connection}
      remoteModels={options.remoteModels ?? new FakeRemoteModels()}
      remoteProviders={options.remoteProviders}
      onConnect={options.onConnect}
      connectBlocked={options.connectBlocked}
      connecting={options.connecting}
      readCatalogue={options.readCatalogue}
      onDisconnect={options.onDisconnect}
      onRemember={options.onRemember}
      credentialProtection={options.credentialProtection}
    />
  );
}

/** The app's language, which a test may set apart from the browser's. */
const appLanguage = { current: "en" };

// A `date` value is shown after the key, so a stamp's formatting is visible.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { date?: string }) =>
      values?.date === undefined ? key : `${key} ${values.date}`,
    i18n: { language: appLanguage.current },
  }),
}));

// The pane lives behind the session gate, so a writer is always signed in;
// with nobody, the connection keeps nothing. Mocked rather than
// imported, because this layer may not name the host's auth, which
// `boundaries.test.ts` pins.
vi.mock("../auth/currentUser", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentUserId: () => "user-1",
}));

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected test value");
  return value;
}

describe("AiSettingsPane", () => {
  it("discovers local Ollama models and lists the ones that can answer, choosing none", async () => {
    vi.spyOn(OllamaProvider.prototype, "listModels").mockResolvedValue([
      {
        id: "writer:latest",
        providerId: "ollama",
        label: "writer:latest",
        kind: "device" as const,
        capabilities: { tools: false, structuredOutput: true },
      },
      {
        id: "embed:latest",
        providerId: "ollama",
        label: "embed:latest",
        kind: "device" as const,
        capabilities: { tools: false, structuredOutput: false },
      },
    ]);
    vi.spyOn(OllamaProvider.prototype, "describeModel").mockImplementation(
      async (ref) => ({
        id: ref.modelId,
        providerId: ref.providerId,
        label: ref.modelId,
        kind: "device" as const,
        capabilities: {
          tools: ref.modelId === "writer:latest",
          structuredOutput: ref.modelId === "writer:latest",
        },
        contextTokens: 8192,
      }),
    );

    render(pane());
    fireEvent.click(screen.getByText("settings.ollamaAddressCustom"));
    fireEvent.change(screen.getByDisplayValue("http://localhost:11434"), {
      target: { value: "http://127.0.0.1:11434" },
    });
    fireEvent.click(screen.getByText("settings.testOllama"));

    await waitFor(() =>
      expect(screen.getByText("settings.aiLocalState.connected")).toBeTruthy(),
    );
    // A listing, not a picker: what the endpoint answered with, filtered to
    // what can hold a conversation.
    expect(screen.getByText(/writer:latest/)).toBeTruthy();
    expect(screen.queryByText(/embed:latest/)).toBeNull();

    // The pane chooses nothing: the chat is the one store of a model
    // selection. A selection written here would be an ambient
    // default the editor does not read, so the two could name different
    // models while one of them answered. The connection record is an
    // endpoint and nothing else.
    const saved = JSON.parse(
      must(localStorage.getItem("ai.connection.user-1")),
    );
    expect(saved).toEqual({ endpoint: "http://127.0.0.1:11434" });
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  // ── Default or Custom ──────────────────────────────────────────────────────

  it("reaches Ollama at its standard address with no field to fill", () => {
    render(pane());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen
        .getByText("settings.ollamaAddressDefault")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(connection.load()).toEqual({ endpoint: "http://localhost:11434" });
  });

  it("opens Custom on the standard address and saves only what it is told to", () => {
    render(pane());
    fireEvent.click(screen.getByText("settings.ollamaAddressCustom"));
    const field = screen.getByRole("textbox") as HTMLInputElement;
    expect(field.value).toBe("http://localhost:11434");
    // Nothing to save yet: the draft is what is in force.
    const save = screen.getByText("settings.ollamaAddressSave");
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field, { target: { value: "http://127.0.0.1:8080" } });
    // A draft is not an endpoint until it is saved.
    expect(connection.load()).toEqual({ endpoint: "http://localhost:11434" });
    fireEvent.click(save);
    expect(connection.load()).toEqual({ endpoint: "http://127.0.0.1:8080" });
  });

  it("saves a custom address on Enter, and on no other key", () => {
    render(pane());
    fireEvent.click(screen.getByText("settings.ollamaAddressCustom"));
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "http://127.0.0.1:8080" } });
    fireEvent.keyDown(field, { key: "a" });
    expect(connection.load()).toEqual({ endpoint: "http://localhost:11434" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(connection.load()).toEqual({ endpoint: "http://127.0.0.1:8080" });
  });

  it("refuses an address off this device and keeps the one in force", () => {
    render(pane());
    fireEvent.click(screen.getByText("settings.ollamaAddressCustom"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "http://example.com:11434" },
    });
    fireEvent.click(screen.getByText("settings.ollamaAddressSave"));
    expect(screen.getByRole("alert").textContent).toBe(
      "settings.ollamaAddressInvalid",
    );
    expect(connection.load()).toEqual({ endpoint: "http://localhost:11434" });
  });

  it("goes back to the standard address when Default is chosen again", () => {
    localStorage.setItem(
      "ai.connection.user-1",
      JSON.stringify({ endpoint: "http://127.0.0.1:8080" }),
    );
    render(pane());
    // A saved custom address opens on Custom, showing it.
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "http://127.0.0.1:8080",
    );
    fireEvent.click(screen.getByText("settings.ollamaAddressDefault"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(connection.load()).toEqual({ endpoint: "http://localhost:11434" });
    // The default is code, not data: nothing is left stored for it.
    expect(localStorage.getItem("ai.connection.user-1")).toBeNull();
  });

  it("ignores a model left in a stored connection, and reports discovery failures", async () => {
    // The stored blob carries two fields the record does not have. Neither
    // is read and neither is adopted, so the model in it reaches no surface.
    localStorage.setItem(
      "ai.connection.user-1",
      JSON.stringify({
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model: "saved:model",
      }),
    );
    vi.spyOn(OllamaProvider.prototype, "listModels").mockResolvedValue([]);
    render(pane());
    expect(screen.queryByText(/saved:model/)).toBeNull();
    fireEvent.click(screen.getByText("settings.testOllama"));
    await waitFor(() =>
      expect(screen.getByText("settings.aiLocalState.failed")).toBeTruthy(),
    );
  });

  it("stops and drops a check whose address changed while it ran", async () => {
    let answer: (models: never[]) => void = () => undefined;
    const listings: AbortSignal[] = [];
    vi.spyOn(OllamaProvider.prototype, "listModels").mockImplementation(
      (signal) =>
        new Promise((resolve) => {
          listings.push(signal);
          answer = resolve;
        }),
    );
    vi.spyOn(OllamaProvider.prototype, "describeModel").mockImplementation(
      async (ref) => ({
        id: ref.modelId,
        providerId: ref.providerId,
        label: ref.modelId,
        kind: "device" as const,
        capabilities: { tools: false, structuredOutput: true },
      }),
    );

    render(pane());
    fireEvent.click(screen.getByText("settings.ollamaAddressCustom"));
    fireEvent.change(screen.getByDisplayValue("http://localhost:11434"), {
      target: { value: "http://127.0.0.1:11434" },
    });
    fireEvent.click(screen.getByText("settings.testOllama"));
    await waitFor(() =>
      expect(screen.getByText("settings.aiLocalState.checking")).toBeTruthy(),
    );

    // Back to the standard address while the custom one is still answering.
    fireEvent.click(screen.getByText("settings.ollamaAddressDefault"));
    expect(screen.getByText("settings.aiLocalState.idle")).toBeTruthy();
    // The request to the old address is called off, not left to finish.
    expect(listings[0]?.aborted).toBe(true);

    answer([
      {
        id: "custom:latest",
        providerId: "ollama",
        label: "custom:latest",
        kind: "device",
        capabilities: { tools: false, structuredOutput: true },
      },
    ] as never[]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The answer was about an address no chat uses any more.
    expect(screen.getByText("settings.aiLocalState.idle")).toBeTruthy();
    expect(screen.queryByText("settings.aiLocalState.connected")).toBeNull();
    expect(screen.queryByText(/custom:latest/)).toBeNull();
  });

  it("stops and drops a tools probe superseded by a new address or check", async () => {
    vi.spyOn(OllamaProvider.prototype, "listModels").mockResolvedValue([
      {
        id: "writer:latest",
        providerId: "ollama",
        label: "writer:latest",
        kind: "device" as const,
        capabilities: { tools: true, structuredOutput: true },
      },
    ]);
    vi.spyOn(OllamaProvider.prototype, "describeModel").mockImplementation(
      async (ref) => ({
        id: ref.modelId,
        providerId: ref.providerId,
        label: ref.modelId,
        kind: "device" as const,
        capabilities: { tools: true, structuredOutput: true },
      }),
    );
    const verdicts: Array<(ok: boolean) => void> = [];
    const probes: AbortSignal[] = [];
    vi.spyOn(OllamaProvider.prototype, "probeTools").mockImplementation(
      (_ref, signal) =>
        new Promise((resolve) => {
          probes.push(signal);
          verdicts.push(resolve);
        }),
    );

    render(pane());
    fireEvent.click(screen.getByText("settings.ollamaAddressCustom"));
    fireEvent.change(screen.getByDisplayValue("http://localhost:11434"), {
      target: { value: "http://127.0.0.1:11434" },
    });
    fireEvent.click(screen.getByText("settings.testOllama"));
    await waitFor(() =>
      expect(screen.getByText("settings.aiLocalState.connected")).toBeTruthy(),
    );

    await waitFor(() => expect(verdicts).toHaveLength(1));

    // The standard address, checked while the custom one's probe still runs.
    fireEvent.click(screen.getByText("settings.ollamaAddressDefault"));
    // A probe is a whole inference on the device: the old one stops.
    expect(probes[0]?.aborted).toBe(true);
    fireEvent.click(screen.getByText("settings.testOllama"));
    await waitFor(() => expect(verdicts).toHaveLength(2));

    // The custom address's verdict says nothing about the standard one.
    verdicts[0]?.(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("settings.aiProbe.verified")).toBeNull();

    // Checking the same address again stops the probe still running.
    fireEvent.click(screen.getByText("settings.testOllama"));
    await waitFor(() => expect(verdicts).toHaveLength(3));
    expect(probes[1]?.aborted).toBe(true);
    expect(probes[2]?.aborted).toBe(false);

    verdicts[2]?.(false);
    await waitFor(() =>
      expect(screen.getByText("settings.aiProbe.unverified")).toBeTruthy(),
    );
  });

  it("stops a running tools probe when the pane closes", async () => {
    vi.spyOn(OllamaProvider.prototype, "listModels").mockResolvedValue([
      {
        id: "writer:latest",
        providerId: "ollama",
        label: "writer:latest",
        kind: "device" as const,
        capabilities: { tools: true, structuredOutput: true },
      },
    ]);
    vi.spyOn(OllamaProvider.prototype, "describeModel").mockImplementation(
      async (ref) => ({
        id: ref.modelId,
        providerId: ref.providerId,
        label: ref.modelId,
        kind: "device" as const,
        capabilities: { tools: true, structuredOutput: true },
      }),
    );
    const probes: AbortSignal[] = [];
    vi.spyOn(OllamaProvider.prototype, "probeTools").mockImplementation(
      (_ref, signal) =>
        new Promise(() => {
          probes.push(signal);
        }),
    );

    const { unmount } = render(pane());
    fireEvent.click(screen.getByText("settings.testOllama"));
    await waitFor(() => expect(probes).toHaveLength(1));

    unmount();
    expect(probes[0]?.aborted).toBe(true);
  });

  // ── The probe gate ─────────────────────────────────────────────────────────

  it("does not probe a model that is not on this device", async () => {
    // Gated on the descriptor's kind, never on a provider's name. A probe is
    // a whole synthetic inference: free against a runtime on the writer's
    // own machine, a billed request against anything else.
    // `kindForEndpoint` answers whether the URL is on this machine, so an
    // Ollama on the writer's LAN is `remote` and is not probed.
    vi.spyOn(OllamaProvider.prototype, "listModels").mockResolvedValue([
      {
        id: "writer:latest",
        providerId: "ollama",
        label: "writer:latest",
        kind: "remote" as const,
        capabilities: { tools: true, structuredOutput: true },
      },
    ]);
    vi.spyOn(OllamaProvider.prototype, "describeModel").mockImplementation(
      async (ref) => ({
        id: ref.modelId,
        providerId: ref.providerId,
        label: ref.modelId,
        kind: "remote" as const,
        capabilities: { tools: true, structuredOutput: true },
      }),
    );
    const probe = vi
      .spyOn(OllamaProvider.prototype, "probeTools")
      .mockResolvedValue(true);

    render(pane());
    fireEvent.click(screen.getByText("settings.testOllama"));

    await waitFor(() =>
      expect(screen.getByText("settings.aiProbe.skipped")).toBeTruthy(),
    );
    expect(probe).not.toHaveBeenCalled();
    // The pane says so rather than dropping the line, because a missing
    // "agent tools verified" reads as a failure.
    expect(screen.queryByText("settings.aiProbe.verified")).toBeNull();
  });

  // ── The remote section ─────────────────────────────────────────────────────

  const connected = [
    {
      providerId: "a-provider",
      connected: true,
      upstreamHost: "models.example",
      accountLabel: "writer@example.test",
      expiresAtOrBefore: null,
      limitUsd: 10,
      // False, because the vendor's one route that caps a PKCE-minted key is
      // documented and not deployed. A fixture defaulting to
      // true would render a claim no writer's key earns.
      required: { limitUsd: 10 },
    },
  ];

  /** The same provider before the writer has ever approved anything. */
  const disconnected = [
    {
      providerId: "a-provider",
      connected: false,
      upstreamHost: "models.example",
      accountLabel: null,
      expiresAtOrBefore: null,
      limitUsd: null,
      required: { limitUsd: 10 },
    },
  ];

  function catalogue(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `a/model-${i}`,
      providerId: "a-provider",
      label: `a/model-${i}`,
      kind: "remote" as const,
      capabilities: { tools: true, structuredOutput: true },
    }));
  }

  it("states where the words go whether or not anything is connected", () => {
    // The disclosure comes before the choice. Project text bound for a
    // remote provider goes to that provider's host, so each place states its
    // own destination rather than one sentence covering both.
    render(pane());

    // Each place is a card, and each card says it in its own lines.
    expect(screen.getByText("settings.aiLocalCannot")).toBeTruthy();
    expect(screen.getByText("settings.aiRemoteNone")).toBeTruthy();
  });

  it("offers a way in for a provider with no credential yet", () => {
    // A disconnected provider keeps its row; without it Settings has no
    // Connect control and nowhere for a writer to begin.
    const onConnect = vi.fn();
    render(pane({ remoteProviders: disconnected, onConnect }));

    expect(screen.getByText("settings.aiRemoteDisconnected")).toBeTruthy();
    fireEvent.click(screen.getByText("settings.aiRemoteConnect"));
    expect(onConnect).toHaveBeenCalledWith("a-provider");
  });

  it("offers renewal on the same button for a connected one", () => {
    // One flow, two entry points: a first connection and a renewal mint a key
    // the same way, and the vendor issues no refresh token, so neither has a
    // silent path.
    const onConnect = vi.fn();
    render(pane({ remoteProviders: connected, onConnect }));

    expect(screen.getByText(/^settings\.aiRemoteConnected/)).toBeTruthy();
    fireEvent.click(screen.getByText("settings.aiRemoteReconnect"));
    expect(onConnect).toHaveBeenCalledWith("a-provider");
  });

  it("says where the words go before connecting", () => {
    // A writer forms the belief at the choice, not in a document they will
    // not open. Once connected, the card is about the connection.
    const { unmount } = render(pane({ remoteProviders: disconnected }));
    expect(screen.getByText("settings.aiRemoteTransit")).toBeTruthy();
    unmount();

    render(pane({ remoteProviders: connected }));
    expect(screen.queryByText("settings.aiRemoteTransit")).toBeNull();
  });

  it("lists no models for a provider that is not connected", () => {
    // Nothing to list, nothing to filter, and no catalogue worth fetching
    // until a credential exists.
    render(pane({ remoteProviders: disconnected }));

    expect(screen.queryByText("settings.aiRemoteChoose")).toBeNull();
  });

  it("says a window was blocked rather than failing quietly", () => {
    render(pane({ remoteProviders: disconnected, connectBlocked: true }));

    expect(screen.getByText("settings.aiRemoteBlocked")).toBeTruthy();
  });

  it("holds the button while a window is open for that provider", () => {
    const onConnect = vi.fn();
    render(
      pane({
        remoteProviders: disconnected,
        onConnect,
        connecting: "a-provider",
      }),
    );

    const button = screen.getByText("settings.aiRemoteConnecting");
    fireEvent.click(button);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("names the destination a connected provider actually sends to", () => {
    // The host, not an id the app minted: it is the one name in the block a
    // writer can check against their own account.
    render(pane({ remoteProviders: connected }));

    expect(screen.getByText("models.example")).toBeTruthy();
    expect(screen.queryByText("settings.aiRemoteNone")).toBeNull();
  });

  it("dates the key's expiry in the app's language, not the browser's", () => {
    appLanguage.current = "it";
    try {
      const expires = "2026-12-31T12:00:00.000Z";
      render(
        pane({
          remoteProviders: [{ ...connected[0], expiresAtOrBefore: expires }],
        }),
      );
      const date = new Date(expires);
      const italian = date.toLocaleDateString("it", {
        day: "numeric",
        month: "long",
        ...(date.getFullYear() === new Date().getFullYear()
          ? {}
          : { year: "numeric" }),
      });
      expect(
        screen.getByText(new RegExp(`settings.aiRemoteExpires ${italian}`)),
      ).toBeTruthy();
    } finally {
      appLanguage.current = "en";
    }
  });

  it("says which models cost money and which do not", async () => {
    // The question a writer on the free tier asks of a list of hundreds of
    // models, few of them free.
    const readCatalogue = vi.fn().mockResolvedValue([
      {
        id: "a/free",
        providerId: "a-provider",
        label: "a/free",
        kind: "remote" as const,
        capabilities: { tools: true, structuredOutput: true },
        pricing: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
      },
      {
        id: "a/paid",
        providerId: "a-provider",
        label: "a/paid",
        kind: "remote" as const,
        capabilities: { tools: true, structuredOutput: true },
        pricing: { promptUsdPerMillion: 0.1, completionUsdPerMillion: 0.5 },
      },
    ]);

    render(pane({ remoteProviders: connected, readCatalogue }));
    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));

    await screen.findByText("settings.aiModelFree");
    // The figure, not only the word: the catalogue spans three orders of
    // magnitude, so "paid" would group a model costing cents a book with one
    // costing dollars a chapter.
    expect(screen.getByText("settings.aiModelPrice")).toBeTruthy();
  });

  it("says nothing at all about a model nobody priced", async () => {
    // "No price stated" is not "no charge". A boolean with Paid as the else
    // branch would label an unpriced model as costing money, and a lenient
    // parse would label it free. Absent renders as absent.
    const readCatalogue = vi.fn().mockResolvedValue([
      {
        id: "a/unpriced",
        providerId: "a-provider",
        label: "a/unpriced",
        kind: "remote" as const,
        capabilities: { tools: true, structuredOutput: true },
      },
    ]);

    render(pane({ remoteProviders: connected, readCatalogue }));
    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));

    await screen.findByText("a/unpriced");
    expect(screen.queryByText("settings.aiModelFree")).toBeNull();
    expect(screen.queryByText("settings.aiModelPrice")).toBeNull();
  });

  it("states the bounds a key must have before sending anyone to set them", () => {
    // Shown on the disconnected row, the only moment it can still prevent
    // the refusal. The provider's consent screen lets the spend limit and the
    // expiry be left empty, and empty there means unlimited and forever, so a
    // writer not told first finds out by being rejected afterwards.
    render(pane({ remoteProviders: disconnected }));

    expect(screen.getByText("settings.aiRemoteRequirement")).toBeTruthy();
  });

  it("leaves the rule off a connected provider, whose cap is on its state line", () => {
    // A renewal that breaks the rule is refused with the rule in its words.
    render(pane({ remoteProviders: connected }));

    expect(screen.queryByText("settings.aiRemoteRequirement")).toBeNull();
    expect(screen.getByText(/ · settings\.aiRemoteLimit( ·|$)/)).toBeTruthy();
  });

  it("names the cap's renewal period when the key renews", () => {
    // A $5 cap that renews each month is $5 a month, not $5 in all, and the
    // writer set that period on the provider's screen.
    render(
      pane({ remoteProviders: [{ ...connected[0], limitReset: "monthly" }] }),
    );

    expect(
      screen.getByText(/ · settings\.aiRemoteLimitRenews\.monthly( ·|$)/),
    ).toBeTruthy();
  });

  it("reads the catalogue through the reader it is given", async () => {
    // The key belongs to the open writer, so only the composition root can
    // bind the reader; the pane never holds a key.
    const readCatalogue = vi.fn().mockResolvedValue(catalogue(1));

    render(pane({ remoteProviders: connected, readCatalogue }));
    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));

    await waitFor(() => expect(readCatalogue).toHaveBeenCalledOnce());
    expect(readCatalogue.mock.calls[0][0]).toBe("a-provider");
    expect(readCatalogue.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });

  it("says the catalogue could not be read when it answers no models", async () => {
    const readCatalogue = vi.fn().mockResolvedValue([]);

    render(pane({ remoteProviders: connected, readCatalogue }));
    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));

    await screen.findByText("settings.aiRemoteUnread");
  });

  it("states the limit the key must stay under, from the status itself", () => {
    // The number is the check's own; a figure fixed in the pane could
    // contradict the check it describes.
    render(
      pane({
        remoteProviders: [{ ...disconnected[0], required: { limitUsd: 7 } }],
      }),
    );

    expect(screen.getByText("settings.aiRemoteRequirement")).toBeTruthy();
  });

  it("words a refusal by its code", () => {
    render(
      pane({
        remoteProviders: [{ ...disconnected[0], refusal: "limit-too-high" }],
      }),
    );

    expect(
      screen.getByText("settings.aiRemoteRefusal.limit-too-high"),
    ).toBeTruthy();
  });

  it("links the provider's own key list, connected or not", () => {
    // Every connection mints a key, and a removed one stays valid at the
    // provider until the writer deletes it there.
    for (const provider of [connected[0], disconnected[0]]) {
      const { unmount } = render(
        pane({
          remoteProviders: [
            { ...provider, keysUrl: "https://models.example/keys" },
          ],
        }),
      );
      const link = screen.getByText("settings.aiRemoteKeys").closest("a");
      expect(link?.getAttribute("href")).toBe("https://models.example/keys");
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
      unmount();
    }
  });

  it("says a removed key still works at the provider, until it connects again", () => {
    const keysUrl = "https://models.example/keys";
    const { unmount } = render(
      pane({
        remoteProviders: [{ ...disconnected[0], keysUrl, keyRemoved: true }],
      }),
    );
    expect(screen.getByText("settings.aiRemoteRemoved")).toBeTruthy();
    unmount();

    render(pane({ remoteProviders: [{ ...disconnected[0], keysUrl }] }));
    expect(screen.queryByText("settings.aiRemoteRemoved")).toBeNull();
  });

  it("offers a disconnect on a connected provider only", () => {
    const onDisconnect = vi.fn();
    const { unmount } = render(
      pane({ remoteProviders: disconnected, onDisconnect }),
    );
    expect(screen.queryByText("settings.aiRemoteDisconnect")).toBeNull();
    unmount();

    render(pane({ remoteProviders: connected, onDisconnect }));
    fireEvent.click(screen.getByText("settings.aiRemoteDisconnect"));
    expect(onDisconnect).toHaveBeenCalledWith("a-provider");
  });

  it("asks whether to remember the connection once connected, and only then", () => {
    const onRemember = vi.fn();
    const { unmount } = render(
      pane({ remoteProviders: disconnected, onRemember }),
    );
    expect(screen.queryByText("settings.aiRemoteRememberQuestion")).toBeNull();
    unmount();

    render(pane({ remoteProviders: connected, onRemember }));
    expect(
      screen.getByRole("radiogroup", {
        name: "settings.aiRemoteRememberQuestion",
      }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("radio", {
          name: "settings.aiRemoteRememberNo",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(screen.getByText("settings.aiRemoteRememberYesMore")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("radio", { name: "settings.aiRemoteRememberYes" }),
    );
    expect(onRemember).toHaveBeenLastCalledWith("a-provider", true);
  });

  it("forgets on the writer's choice", () => {
    const onRemember = vi.fn();
    render(
      pane({
        remoteProviders: [{ ...connected[0], remembered: true }],
        onRemember,
      }),
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "settings.aiRemoteRememberNo" }),
    );
    expect(onRemember).toHaveBeenLastCalledWith("a-provider", false);
  });

  it("says when this computer cannot remember, and offers no remembering", () => {
    const onRemember = vi.fn();
    render(
      pane({
        remoteProviders: connected,
        onRemember,
        credentialProtection: "unavailable",
      }),
    );

    expect(
      screen.getByText("settings.aiRemoteRememberUnavailable"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("radio", {
          name: "settings.aiRemoteRememberYes",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("reads no catalogue until the writer asks for one", async () => {
    // Hundreds of rows over the network. A writer opening Settings to change
    // their theme does not pay for it, and the set they already chose renders
    // from the preference alone.
    const readCatalogue = vi.fn().mockResolvedValue(catalogue(3));

    render(
      pane({
        remoteProviders: connected,
        remoteModels: new FakeRemoteModels([
          { providerId: "a-provider", modelId: "a/already-mine" },
        ]),
        readCatalogue,
      }),
    );

    expect(screen.getByText("a/already-mine")).toBeTruthy();
    expect(readCatalogue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));
    await waitFor(() => expect(readCatalogue).toHaveBeenCalledOnce());
  });

  it("writes a chosen model through the port and takes it back again", async () => {
    const readCatalogue = vi.fn().mockResolvedValue(catalogue(2));
    const remoteModels = new FakeRemoteModels();

    render(pane({ remoteProviders: connected, remoteModels, readCatalogue }));
    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBe(2));

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(remoteModels.chosen()).toEqual([
      { providerId: "a-provider", modelId: "a/model-1" },
    ]);

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(remoteModels.chosen()).toEqual([]);
  });

  it("draws no more than forty rows, and filters to find the rest", async () => {
    // Not a page: there is no "next", because paging hundreds of models is a
    // worse answer than typing three letters into the field above them.
    const readCatalogue = vi.fn().mockResolvedValue([
      ...catalogue(60),
      {
        id: "a/needle",
        providerId: "a-provider",
        label: "a/needle",
        kind: "remote" as const,
        capabilities: { tools: false, structuredOutput: false },
      },
    ]);

    render(pane({ remoteProviders: connected, readCatalogue }));
    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox")).toHaveLength(40),
    );
    expect(screen.queryByText("a/needle")).toBeNull();

    fireEvent.change(screen.getByLabelText("settings.aiRemoteFilter"), {
      target: { value: "needle" },
    });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("a/needle")).toBeTruthy();
    // Labelled rather than hidden. The local list filters out what cannot
    // hold a conversation, because that list answers whether the endpoint
    // works. Here a writer pays for access to these models, and a model
    // silently missing from a list they pay for is worse than a model marked
    // chat-only.
    expect(screen.getByText("settings.aiChatOnly")).toBeTruthy();
  });

  it("says nothing matches rather than showing an empty list", async () => {
    const readCatalogue = vi.fn().mockResolvedValue(catalogue(2));
    render(pane({ remoteProviders: connected, readCatalogue }));
    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));
    await waitFor(() =>
      expect(screen.getAllByRole("checkbox")).toHaveLength(2),
    );

    fireEvent.change(screen.getByLabelText("settings.aiRemoteFilter"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("settings.aiRemoteNoMatch")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("stops at the cap without dropping anything the writer already picked", async () => {
    // Refused rather than trimmed at the other end: making room by dropping
    // the oldest would remove a model the writer chose without telling them.
    const readCatalogue = vi.fn().mockResolvedValue(catalogue(30));
    const already = Array.from({ length: 24 }, (_, i) => ({
      providerId: "a-provider",
      modelId: `a/model-${i}`,
    }));
    const remoteModels = new FakeRemoteModels(already);

    render(pane({ remoteProviders: connected, remoteModels, readCatalogue }));
    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));
    await waitFor(() =>
      expect(screen.getByText("settings.aiRemoteFull")).toBeTruthy(),
    );

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // Everything already chosen stays enabled, so the way out of "full" is
    // reachable from the row the writer is looking at.
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[24].disabled).toBe(true);
    fireEvent.click(boxes[24]);
    expect(remoteModels.chosen()).toHaveLength(24);
  });

  it("says the catalogue could not be read, and stays usable", async () => {
    const readCatalogue = vi
      .fn()
      .mockRejectedValue(new Error("vendor is down"));
    render(
      pane({
        remoteProviders: connected,
        remoteModels: new FakeRemoteModels([
          { providerId: "a-provider", modelId: "a/already-mine" },
        ]),
        readCatalogue,
      }),
    );

    fireEvent.click(screen.getByText("settings.aiRemoteFilter"));
    await waitFor(() =>
      expect(screen.getByText("settings.aiRemoteUnread")).toBeTruthy(),
    );
    // What they already chose is still on screen and still removable: it came
    // from the preference, and the preference did not need the network.
    expect(screen.getByText("a/already-mine")).toBeTruthy();
  });

  // A persona is a file the app ships, never edited or listed in Settings.
  // The row pins the absence: no voice, no name, no button to one, so a
  // reinstated editor cannot arrive here unnoticed.
  it("offers no persona surface at all", () => {
    render(pane());
    for (const persona of PERSONAS) {
      expect(screen.queryByText(persona.name)).toBeNull();
      expect(screen.queryByText(persona.description)).toBeNull();
    }
    expect(screen.queryByText("settings.personas")).toBeNull();
    // No combobox at all: the chat is the one model selection store,
    // and a persona or chat-kind control would show up here.
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});
