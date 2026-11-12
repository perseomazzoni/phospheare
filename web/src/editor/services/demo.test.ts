// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { DEMO_MODEL, DemoModelProvider } from "../../ai/adapters/demo";
import { demoEditorServices } from "./demo";

// Pins what the demo route lends the editor: the way home, the demo model and
// nothing else, so no account, key or queue reaches the demo book.

describe("the demo editor's services", () => {
  it("lead home and answer from the demo model alone, with no search", () => {
    const services = demoEditorServices();
    expect(services.exit).toBe("landing");
    const wiring = services.useAssistantWiring(() => "en");
    expect(wiring?.defaultModel).toEqual(DEMO_MODEL);
    expect(wiring?.createModel()).toBeInstanceOf(DemoModelProvider);
    expect(wiring?.webSearch).toBeUndefined();
    expect(services.useRemoteProviders()).toBeUndefined();
  });

  it("build one wiring for every render, so the Assistant is not rebuilt", () => {
    const services = demoEditorServices();
    expect(services.useAssistantWiring(() => "en")).toBe(
      services.useAssistantWiring(() => "it"),
    );
  });

  it("have no face, no hold and no queue of their own", async () => {
    const services = demoEditorServices();
    const place = { providerId: "memory", key: "demo" };
    expect(services.useFace()).toBeNull();
    expect(typeof services.holdOpenWork(async () => true)).toBe("function");
    expect(services.connectionFor("memory")).toBeNull();
    expect(services.usePendingPaths(place).size).toBe(0);
    expect(services.useLostPaths(place).size).toBe(0);
    expect(services.readStale(place, "a.md")).toBe(false);
    await expect(services.forgetLostAt(place, "a.md")).resolves.toBeUndefined();
  });

  it("take the face and the sign-out hold a program with accounts lends", () => {
    const face = { name: "Ada", email: "ada@example.com", avatarUrl: null };
    const holdOpenWork = vi.fn(() => () => undefined);
    const services = demoEditorServices({ useFace: () => face, holdOpenWork });
    expect(services.useFace()).toBe(face);
    const write = async () => true;
    services.holdOpenWork(write);
    expect(holdOpenWork).toHaveBeenCalledWith(write);
  });
});
