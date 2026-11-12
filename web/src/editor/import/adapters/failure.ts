// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Refusal } from "../domain/sniff";

// A reader's way of saying no. Readers throw this, and only this, for a file
// they will not read; anything else they throw is a bug in the reader and is
// reported as one ("damaged"). The reason is a sentence the window can say,
// never the parser's own words, which are written for a developer and in
// English.

export class ReadRefused extends Error {
  readonly reason: Refusal;
  constructor(reason: Refusal, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "ReadRefused";
    this.reason = reason;
  }
}
