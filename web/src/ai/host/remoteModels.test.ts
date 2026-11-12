// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHOSEN_MODELS_PREF,
  CuratedModelProvider,
  MAX_CHOSEN_MODELS,
  SyncedRemoteModelPreferences,
} from "./remoteModels";
import type { ModelProvider, RemoteModelPreferences } from "../ports";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
} from "../domain/types";

const prefs = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  writes: [] as Array<{ key: string; value: unknown }>,
}));

vi.mock("../../profile/profileSync", () => ({
  getPref: <T>(key: string, fallback: T) =>
    prefs.store.has(key) ? (prefs.store.get(key) as T) : fallback,
  setPref: (key: string, value: unknown) => {
    prefs.store.set(key, value);
    prefs.writes.push({ key, value });
  },
}));

beforeEach(() => {
  prefs.store.clear();
  prefs.writes.length = 0;
});

afterEach(() => vi.restoreAllMocks());

function descriptor(id: string, providerId = "a-provider"): ModelDescriptor {
  return {
    id,
    providerId,
    label: id,
    kind: "remote",
    capabilities: { tools: true, structuredOutput: true },
  };
}

function stub(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "a-provider",
    listModels: async () => [
      descriptor("one"),
      descriptor("two"),
      descriptor("three"),
    ],
    describeModel: async (ref: ModelRef) => descriptor(ref.modelId),
    estimate: async () => ({ tokens: 7, exact: true }),
    generate: async function* (): AsyncIterable<ModelEvent> {
      yield { type: "completed", reason: "answer" };
    },
    ...overrides,
  } as ModelProvider;
}

const signal = () => new AbortController().signal;

function fixed(models: readonly ModelRef[]): RemoteModelPreferences {
  return { chosen: () => models, choose: () => {} };
}

describe("the stored set", () => {
  it("writes exactly the two fields the server's domain accepts", () => {
    // Anything else the caller carries, such as a `modelRevision` from a
    // descriptor, would be an extra key, and the profile refuses the whole
    // list for one.
    new SyncedRemoteModelPreferences().choose([
      { providerId: "a-provider", modelId: "one", modelRevision: "abc" },
    ]);

    expect(prefs.writes).toEqual([
      {
        key: CHOSEN_MODELS_PREF,
        value: [{ providerId: "a-provider", modelId: "one" }],
      },
    ]);
  });

  it("is written whole rather than appended to", () => {
    // The preference merge is last-write-wins per key, so two devices
    // curating at once resolve to one of the two lists. That suits a list a
    // person keeps by hand, which this is, and not a log.
    const remote = new SyncedRemoteModelPreferences();
    remote.choose([{ providerId: "a-provider", modelId: "one" }]);
    remote.choose([{ providerId: "a-provider", modelId: "two" }]);

    expect(remote.chosen()).toEqual([
      { providerId: "a-provider", modelId: "two" },
    ]);
  });

  it("drops a rotted row rather than routing to a provider named undefined", () => {
    // The cache is a JSON blob a profile pull replaces wholesale, so its
    // contents need not match this build's shape. A ref with no `providerId`
    // would reach the composite and be refused there, far from the cause.
    prefs.store.set(CHOSEN_MODELS_PREF, [
      { providerId: "a-provider", modelId: "one" },
      { modelId: "no-provider" },
      { providerId: "a-provider" },
      null,
      "a-provider/two",
      { providerId: "", modelId: "blank" },
    ]);

    expect(new SyncedRemoteModelPreferences().chosen()).toEqual([
      { providerId: "a-provider", modelId: "one" },
    ]);
  });

  it("answers with nothing when the stored value is not a list at all", () => {
    prefs.store.set(CHOSEN_MODELS_PREF, { providerId: "a-provider" });

    expect(new SyncedRemoteModelPreferences().chosen()).toEqual([]);
  });

  it("holds no more than the server will take, reading and writing", () => {
    const many = Array.from({ length: MAX_CHOSEN_MODELS + 5 }, (_, i) => ({
      providerId: "a-provider",
      modelId: `m${i}`,
    }));
    prefs.store.set(CHOSEN_MODELS_PREF, many);

    expect(new SyncedRemoteModelPreferences().chosen()).toHaveLength(
      MAX_CHOSEN_MODELS,
    );

    new SyncedRemoteModelPreferences().choose(many);
    expect(prefs.writes[0].value).toHaveLength(MAX_CHOSEN_MODELS);
  });
});

describe("the curated provider", () => {
  it("offers only what the writer chose", async () => {
    const curated = new CuratedModelProvider(
      stub(),
      fixed([{ providerId: "a-provider", modelId: "two" }]),
    );

    const offered = await curated.listModels(signal());

    expect(offered.map((model) => model.id)).toEqual(["two"]);
  });

  it("offers NOTHING when nothing was chosen, and asks the provider nothing", async () => {
    // Empty means empty, never "all": a connected provider would otherwise
    // put hundreds of rows in a popover, and the place with room to choose is
    // where the writer connected it.
    const listModels = vi.fn();
    const curated = new CuratedModelProvider(stub({ listModels }), fixed([]));

    await expect(curated.listModels(signal())).resolves.toEqual([]);
    expect(listModels).not.toHaveBeenCalled();
  });

  it("still answers for a model that is no longer chosen", async () => {
    // A chat records the model that answered it, and a writer tidying the
    // menu has revoked nothing, so an old conversation can still continue.
    const generate = vi.fn(async function* (): AsyncIterable<ModelEvent> {
      yield { type: "completed", reason: "answer" };
    });
    const curated = new CuratedModelProvider(stub({ generate }), fixed([]));

    const events: ModelEvent[] = [];
    for await (const event of curated.generate(
      {
        model: { providerId: "a-provider", modelId: "un-chosen" },
        instructions: "Answer.",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
        limits: { inputTokens: 100, outputTokens: 10 },
      } as ModelRequest,
      signal(),
    ))
      events.push(event);

    expect(events).toEqual([{ type: "completed", reason: "answer" }]);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("describes and estimates an un-chosen model too", async () => {
    const curated = new CuratedModelProvider(stub(), fixed([]));

    await expect(
      curated.describeModel(
        { providerId: "a-provider", modelId: "un-chosen" },
        signal(),
      ),
    ).resolves.toMatchObject({ id: "un-chosen" });
    await expect(curated.estimate({} as ModelRequest)).resolves.toEqual({
      tokens: 7,
      exact: true,
    });
  });

  it("wears its delegate's id, not one of its own", async () => {
    // The composite routes on the descriptor's provider id. A wrapper with
    // its own id would make every model it offers unroutable.
    const curated = new CuratedModelProvider(stub(), fixed([]));

    expect(curated.id).toBe("a-provider");
  });

  it("re-reads the chosen set on every listing", async () => {
    // Read live, not captured at construction: the composition root builds
    // these once per connected provider, and a change in Settings shows
    // without reloading the editor.
    let chosen: ModelRef[] = [];
    const curated = new CuratedModelProvider(stub(), {
      chosen: () => chosen,
      choose: () => {},
    });

    await expect(curated.listModels(signal())).resolves.toEqual([]);
    chosen = [{ providerId: "a-provider", modelId: "three" }];
    await expect(
      curated.listModels(signal()).then((m) => m.map((one) => one.id)),
    ).resolves.toEqual(["three"]);
  });

  it("does not pretend to probe", async () => {
    // On the port, absence is the answer. Forwarding an optional member would
    // invent one here, and `false` reads as "probed, and it has no tools".
    const curated: ModelProvider = new CuratedModelProvider(
      stub({ probeTools: async () => true }),
      fixed([]),
    );

    expect(curated.probeTools).toBeUndefined();
  });

  it("ignores a chosen model belonging to a different provider", async () => {
    // One preference key holds the set for every provider, so each wrapper
    // matches on the pair rather than on the model id.
    const curated = new CuratedModelProvider(
      stub(),
      fixed([{ providerId: "somebody-else", modelId: "two" }]),
    );

    await expect(curated.listModels(signal())).resolves.toEqual([]);
  });
});
