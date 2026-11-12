// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_TITLES, isDefaultChatTitle } from "./chatTitle";
import { CHAT_KINDS } from "./types";

describe("the name a chat is made with", () => {
  it("is its kind's, and only its own kind's", () => {
    for (const kind of CHAT_KINDS)
      expect(isDefaultChatTitle(DEFAULT_CHAT_TITLES[kind], kind)).toBe(true);
    expect(isDefaultChatTitle("Drafting", "editorial")).toBe(false);
    expect(isDefaultChatTitle("Where is the story weak?", "general")).toBe(
      false,
    );
  });
});
