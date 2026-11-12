// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { kindForDestination } from "./providerKind";

// The axis a privacy gate branches on, derived from where the bytes
// go, so no adapter can answer the question with a constant of its own. The
// destination is the input.

const direct = (endpoint: string) =>
  kindForDestination({ via: "direct", endpoint });

describe("which side of the port a model is on", () => {
  it("counts this machine's loopback as the device, however it is spelled", () => {
    for (const endpoint of [
      "http://localhost:11434",
      "http://127.0.0.1:11434",
      "http://[::1]:11434",
      "https://LOCALHOST:443",
      // The whole 127.0.0.0/8 block is loopback, and a runtime is free to
      // bind somewhere in it other than .1.
      "http://127.0.0.2:11434",
    ])
      expect(direct(endpoint), endpoint).toBe("device");
  });

  it("counts a private LAN address as REMOTE, which is the point", () => {
    // The intuitive answer is wrong, and this is the judgement the function
    // exists to make. `192.168.1.40` is the writer's own network, perhaps
    // their own desktop seen from their laptop, and it is still another
    // machine: the manuscript leaves this computer to reach it. `device`
    // means bytes bound to this one, so anything that travels pays the same
    // privacy review every remote seam pays.
    for (const endpoint of [
      "http://192.168.1.40:11434",
      "http://10.0.0.5:11434",
      "http://172.16.4.9:11434",
      "http://my-desktop.local:11434",
    ])
      expect(direct(endpoint), endpoint).toBe("remote");
  });

  it("counts a public host as remote", () => {
    expect(direct("https://api.anthropic.com")).toBe("remote");
    expect(direct("http://169.254.169.254")).toBe("remote");
  });

  it("fails closed on anything it cannot read", () => {
    // An endpoint this cannot parse is not one it can vouch for, and the
    // caller's own validation should have refused it first.
    for (const endpoint of ["", "not a url", "://nonsense"])
      expect(direct(endpoint), endpoint).toBe("remote");
  });
});
