// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI,
  aiSettingsKey,
  normalizeOllamaEndpoint,
  parseAiSettings,
  serializeAiSettings,
} from "./settings";

describe("model settings", () => {
  it("provides a working dev default, and a key only for an account", () => {
    expect(parseAiSettings(null)).toEqual(DEFAULT_AI);
    expect(aiSettingsKey(null)).toBeNull();
    expect(aiSettingsKey("user-1")).toBe("ai.connection.user-1");
  });

  it("round-trips a device-local Ollama connection", () => {
    const raw = serializeAiSettings({ endpoint: "http://127.0.0.1:11434" });
    expect(parseAiSettings(raw)).toEqual({
      endpoint: "http://127.0.0.1:11434",
    });
  });

  it("reads a blob carrying the old provider and model fields as an endpoint", () => {
    // The record holds the endpoint only; the chat is the one place a model
    // selection is written. The parser neither reads nor adopts
    // other fields, so a reader that grew a migration branch fails here.
    const stale = JSON.stringify({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "qwen3:8b",
    });
    expect(parseAiSettings(stale)).toEqual({
      endpoint: "http://127.0.0.1:11434",
    });
  });

  it("accepts loopback only and refuses credentials, paths, queries or schemes", () => {
    expect(normalizeOllamaEndpoint("http://localhost:11434/")).toBe(
      "http://localhost:11434",
    );
    // The IPv6 loopback literal is accepted and folded to `localhost`, the
    // same address by the one name a Content-Security-Policy can express.
    // It is loopback, so it is not refused, and folding it keeps the
    // writer's configuration working under the policy.
    expect(normalizeOllamaEndpoint("http://[::1]:11434")).toBe(
      "http://localhost:11434",
    );
    expect(normalizeOllamaEndpoint("http://[::1]")).toBe("http://localhost");
    expect(() => normalizeOllamaEndpoint("https://models.example.com")).toThrow(
      "loopback-only",
    );
    expect(() =>
      normalizeOllamaEndpoint("http://user:pass@localhost:11434"),
    ).toThrow("invalid-endpoint");
    expect(() => normalizeOllamaEndpoint("http://localhost:11434/api")).toThrow(
      "invalid-path",
    );
    expect(() => normalizeOllamaEndpoint("ftp://localhost:11434")).toThrow(
      "invalid-scheme",
    );
    expect(() =>
      normalizeOllamaEndpoint("http://localhost:11434?token=x"),
    ).toThrow("invalid-endpoint");
    expect(() =>
      normalizeOllamaEndpoint("http://localhost:11434#frag"),
    ).toThrow("invalid-endpoint");
    expect(() => normalizeOllamaEndpoint("http://localhost:0")).toThrow(
      "invalid-endpoint",
    );
    expect(() => normalizeOllamaEndpoint("not a url")).toThrow();
  });

  it("fails closed on malformed stored settings", () => {
    expect(parseAiSettings("not-json")).toEqual(DEFAULT_AI);
    // A junk value in a field the record does not have reaches nothing: the
    // endpoint beside it is still read, and the rest of the blob is not.
    expect(
      parseAiSettings(
        JSON.stringify({
          endpoint: "http://localhost:11434",
          model: 7,
        }),
      ),
    ).toEqual({ endpoint: "http://localhost:11434" });
    expect(
      parseAiSettings(
        JSON.stringify({ endpoint: "http://192.168.1.10:11434" }),
      ),
    ).toEqual(DEFAULT_AI);
  });
});
