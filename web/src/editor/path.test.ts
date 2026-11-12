// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { projectPath, spineName } from "./path";

// Pins the editor's link builder, which the web application may import
// without the editor. Both functions are pure string work, so they carry
// nothing of the editor into the bundle.

describe("projectPath", () => {
  // The address is the book's own id, never its storage backend: an address
  // that names where the bytes live breaks a bookmark when the book moves to
  // a remote.
  it("addresses a project by its own id, and by nothing else", () => {
    expect(projectPath("110602fd-b26c-4bb4-8d3f-8446b74cdf48")).toBe(
      "/app/project/110602fd-b26c-4bb4-8d3f-8446b74cdf48",
    );
  });

  // A uuid needs no encoding, but the id is read out of a JSON file a writer
  // can hand-edit, so the link builder never trusts it to hold no path
  // separator.
  it("encodes an id that is not the uuid it is supposed to be", () => {
    expect(projectPath("Once Dark/2")).toBe("/app/project/Once%20Dark%2F2");
  });
});

describe("spineName", () => {
  it("names the project’s spine, so the shelf and the panel can hand it over", () => {
    expect(spineName({ providerId: "local", key: "once-dark" })).toBe(
      "spine-local-once-dark",
    );
  });

  // A view-transition-name is a CSS identifier; a project key is not.
  it("reduces a folder name to something CSS will accept", () => {
    expect(spineName({ providerId: "drive", key: "Once Dark/2" })).toBe(
      "spine-drive-Once-Dark-2",
    );
  });

  it("gives two projects two names", () => {
    const one = spineName({ providerId: "local", key: "a" });
    const two = spineName({ providerId: "local", key: "b" });
    expect(one).not.toBe(two);
  });
});
