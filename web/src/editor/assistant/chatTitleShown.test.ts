// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { chatTitleShown } from "./chatTitleShown";

const t = ((key: string) => `t:${key}`) as unknown as TFunction;

describe("a chat's name on screen", () => {
  it("says a stored default as its kind, in the writer's language", () => {
    expect(
      chatTitleShown(t, { title: "Editorial review", kind: "editorial" }),
    ).toBe("t:dock.chatKind.editorial");
    expect(chatTitleShown(t, { title: "New chat", kind: "general" })).toBe(
      "t:dock.chatKind.general",
    );
  });

  it("keeps a name the chat was given", () => {
    expect(
      chatTitleShown(t, { title: "Sul primo giorno", kind: "drafting" }),
    ).toBe("Sul primo giorno");
  });
});
