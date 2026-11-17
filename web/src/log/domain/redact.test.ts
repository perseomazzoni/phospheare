// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { AS_USER, redact } from "./redact";

describe("the redaction", () => {
  it.each([
    ["mail ada.lovelace+x@mail.example.com now", "mail [email] now"],
    [
      "serving https://oncedarkstudio.dedyn.io:443",
      "serving https://[name]:443",
    ],
    ["from 192.168.1.23:5432 and 8.8.8.8", "from [address]:5432 and [address]"],
    ["from [fe80::a16:5ff:fe42:ade0%eth0]:53", "from [[address]]:53"],
    ["from 2001:db8::1", "from [address]"],
    ["mapped ::ffff:10.0.0.1", "mapped ::ffff:[address]"],
    ["full 2001:db8:0:0:0:0:0:1 too", "full [address] too"],
    [
      "local 127.0.0.1:5173 and [::1]:80 and 0.0.0.0",
      "local 127.0.0.1:5173 and [::1]:80 and 0.0.0.0",
    ],
    ["at 15:21:40.008 took 3ms", "at 15:21:40.008 took 3ms"],
    ["version 1.2.300.4", "version 1.2.300.4"],
    ["not an address 1:2:3:4:5:6:7:8:9", "not an address 1:2:3:4:5:6:7:8:9"],
    ["two gaps 1::2::3", "two gaps 1::2::3"],
    ["long group 12345:1:2:3:4:5:6:7", "long group 12345:1:2:3:4:5:6:7"],
    [
      "back /identity/google/callback?state=abc&code=very-secret#k=key",
      "back /identity/google/callback?state=[secret]&code=[secret]#k=[secret]",
    ],
  ])("%s", (line, want) => {
    expect(redact(line)).toBe(want);
  });

  it("removes the values the app knows, the longest first, in any case", () => {
    const known = [
      { value: "Ada", as: AS_USER },
      { value: "Ada Lovelace", as: "[full]" },
      { value: "Al", as: AS_USER },
    ];
    expect(redact("by ADA LOVELACE, then ada, Al stays", known)).toBe(
      "by [full], then [user], Al stays",
    );
  });

  it("removes a word of a name only where it stands as a word", () => {
    const known = [
      { value: "Ann", as: AS_USER, word: true },
      { value: "José", as: AS_USER, word: true },
    ];
    expect(
      redact(
        "Ann wrote; the channel 3ann-41 stays; José, (José) and Josély",
        known,
      ),
    ).toBe(
      "[user] wrote; the channel 3ann-41 stays; [user], ([user]) and Josély",
    );
  });

  it("keeps the ordinary word that a word of a name also is", () => {
    const known = [{ value: "Will", as: AS_USER, word: true }];
    expect(redact("Will said the sync will try again", known)).toBe(
      "[user] said the sync will try again",
    );
  });

  it("keeps a product's version, which reads like an address", () => {
    expect(
      redact(
        "Chrome/131.0.0.0 Safari/537.36 from 192.168.1.20 at http://10.0.0.7/",
      ),
    ).toBe(
      "Chrome/131.0.0.0 Safari/537.36 from [address] at http://[address]/",
    );
  });
});
