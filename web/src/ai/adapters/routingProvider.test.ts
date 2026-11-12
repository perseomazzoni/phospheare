// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { RoutingModelProvider } from "./routingProvider";
import type { ModelProvider } from "../ports";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
} from "../domain/types";

// Pins the composite in front of both provider kinds, which never guesses. A
// `ModelRef` naming an absent provider is an ordinary state: a chat records
// its model, the writer disconnects that provider, and the chat stays on
// screen. Answering it from another provider would speak in a different
// model's voice, charge a different account and write the wrong pair into the
// turn.

function descriptor(
  providerId: string,
  id: string,
  kind: ModelDescriptor["kind"] = "device",
): ModelDescriptor {
  return {
    id,
    providerId,
    label: id,
    kind,
    capabilities: { tools: true, structuredOutput: true },
  };
}

function stub(
  id: string,
  overrides: Partial<ModelProvider> = {},
): ModelProvider {
  return {
    id,
    listModels: async () => [descriptor(id, `${id}/one`)],
    describeModel: async (ref: ModelRef) => descriptor(id, ref.modelId),
    estimate: async () => ({ tokens: 1, exact: true }),
    generate: async function* (): AsyncIterable<ModelEvent> {
      yield { type: "completed", reason: "answer" };
    },
    ...overrides,
  } as ModelProvider;
}

function request(providerId: string): ModelRequest {
  return {
    model: { providerId, modelId: "a-model" },
    instructions: "Answer.",
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
    limits: { inputTokens: 1_000, outputTokens: 100 },
  };
}

async function collect(
  provider: ModelProvider,
  req: ModelRequest,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of provider.generate(
    req,
    new AbortController().signal,
  ))
    events.push(event);
  return events;
}

const signal = () => new AbortController().signal;

describe("routing by the ref's own provider", () => {
  it("sends a run to the provider the ref names", async () => {
    const device = vi.fn();
    const remote = vi.fn();
    const composite = new RoutingModelProvider(
      stub("ollama", {
        generate: async function* () {
          device();
          yield { type: "completed", reason: "answer" } as ModelEvent;
        },
      }),
      stub("a-provider", {
        generate: async function* () {
          remote();
          yield { type: "completed", reason: "answer" } as ModelEvent;
        },
      }),
    );

    await collect(composite, request("a-provider"));

    expect(remote).toHaveBeenCalledOnce();
    expect(device).not.toHaveBeenCalled();
  });

  it("refuses a provider nobody handed in, rather than answering anyway", async () => {
    // A chat whose provider is disconnected. Falling back to whatever else is
    // available would answer in another model's voice and bill another
    // account.
    const composite = new RoutingModelProvider(stub("ollama"));

    const events = await collect(composite, request("gone-away"));

    expect(events).toEqual([
      {
        type: "failed",
        error: {
          code: "not-configured",
          message: "No provider is connected for gone-away.",
          retryable: false,
        },
      },
    ]);
  });

  it("yields that refusal rather than throwing it", async () => {
    // A throw here surfaces as a broken panel in front of the writer; a
    // `failed` event renders as a strip whose copy points at Settings.
    const composite = new RoutingModelProvider(stub("ollama"));

    await expect(
      collect(composite, request("gone-away")),
    ).resolves.toHaveLength(1);
  });

  it("does not turn an unknown id into an adapter", async () => {
    // The composite holds a written-out list, not a registry, so the property
    // `contract.test.ts` pins holds through it.
    const composite = new RoutingModelProvider(stub("ollama"));

    await expect(
      composite.describeModel(
        { providerId: "invented", modelId: "x" },
        signal(),
      ),
    ).rejects.toThrow(/no-provider-for:invented/);
  });

  it("is not itself addressable, though the port makes it carry an id", async () => {
    const composite = new RoutingModelProvider(stub("ollama"));

    expect(composite.id).toBe("routing");
    // Nothing mints a ref naming it, because every descriptor carries its
    // delegate's id, and one that did is refused like any other unknown.
    await expect(
      composite.describeModel(
        { providerId: "routing", modelId: "x" },
        signal(),
      ),
    ).rejects.toThrow(/no-provider-for:routing/);
  });
});

describe("listing", () => {
  it("offers the device first and the remotes after", async () => {
    // A model on the writer's own machine is free, private and needs no
    // account, so it leads.
    const composite = new RoutingModelProvider(
      stub("ollama"),
      stub("a-provider"),
    );

    const models = await composite.listModels(signal());

    expect(models.map((model) => model.providerId)).toEqual([
      "ollama",
      "a-provider",
    ]);
  });

  it("one provider being down does not hide the others", async () => {
    // Ollama is a process a writer starts by hand, so "not running" is the
    // common case. One rejection must not empty a menu that holds working
    // remote models.
    const composite = new RoutingModelProvider(
      stub("ollama", {
        listModels: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
      stub("a-provider"),
    );

    const models = await composite.listModels(signal());

    expect(models.map((model) => model.id)).toEqual(["a-provider/one"]);
  });

  it("is empty rather than broken when every provider is down", async () => {
    const down = { listModels: async () => Promise.reject(new Error("no")) };
    const composite = new RoutingModelProvider(
      stub("ollama", down),
      stub("a-provider", down),
    );

    await expect(composite.listModels(signal())).resolves.toEqual([]);
  });

  it("carries each delegate's own kind through unchanged", async () => {
    // A privacy gate reads `kind`, so the composite never restates it; each
    // descriptor comes from the provider that knows.
    const composite = new RoutingModelProvider(
      stub("ollama"),
      stub("a-provider", {
        listModels: async () => [
          descriptor("a-provider", "a-provider/one", "remote"),
        ],
      }),
    );

    const models = await composite.listModels(signal());

    expect(models.map((model) => model.kind)).toEqual(["device", "remote"]);
  });
});

describe("estimating", () => {
  it("asks the provider when it knows one", async () => {
    const composite = new RoutingModelProvider(
      stub("ollama", {
        estimate: async () => ({ tokens: 42, exact: true }),
      }),
    );

    await expect(composite.estimate(request("ollama"))).resolves.toEqual({
      tokens: 42,
      exact: true,
    });
  });

  it("counts it here when it does not, rather than throwing", async () => {
    // Every adapter estimates with the same shared function, so this is the
    // number the delegate would produce. A disconnected chat then reaches
    // `generate`, where the refusal is an event the transcript renders, rather
    // than failing a step earlier.
    const composite = new RoutingModelProvider(stub("ollama"));

    const estimate = await composite.estimate(request("gone-away"));

    expect(estimate.exact).toBe(false);
    expect(estimate.tokens).toBeGreaterThan(0);
  });
});

describe("probing", () => {
  it("delegates to the provider that can", async () => {
    const composite = new RoutingModelProvider(
      stub("ollama", { probeTools: async () => true }),
    );

    await expect(
      composite.probeTools({ providerId: "ollama", modelId: "x" }, signal()),
    ).resolves.toBe(true);
  });

  it("throws rather than quietly reporting that a model has no tools", async () => {
    // `false` reads as "probed, and this model has no tools", which would hide
    // a working model's tool support. Callers gate on `kind === "device"`
    // before asking, so reaching this means a caller skipped the gate.
    const composite = new RoutingModelProvider(stub("a-provider"));

    await expect(
      composite.probeTools(
        { providerId: "a-provider", modelId: "x" },
        signal(),
      ),
    ).rejects.toThrow(/probe-unsupported:a-provider/);
  });
});
