// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  defaultDestination,
  destinationHintKey,
  destinationOptions,
  destinationUsable,
  type DestinationFacts,
} from "./destinations";

const t = ((key: string) => key) as unknown as TFunction;

const facts = (over: Partial<DestinationFacts> = {}): DestinationFacts => ({
  driveConnected: true,
  email: "ada@example.com",
  localAvailable: true,
  localRootReady: true,
  remoteAvailable: true,
  ...over,
});

describe("destinations", () => {
  it("offers both places, the disk first, while Drive is connected", () => {
    const options = destinationOptions(facts(), t);
    expect(options.map((o) => o.id)).toEqual(["local", "drive"]);
    expect(options.every((o) => !o.disabled)).toBe(true);
    expect(options[1].sub).toBe("create.driveSub");
  });

  it("leaves Drive out, not disabled, while it is not connected", () => {
    const options = destinationOptions(facts({ driveConnected: false }), t);
    expect(options.map((o) => o.id)).toEqual(["local"]);
  });

  it("shows the disk disabled, with its reason, when no root is mapped", () => {
    const [local] = destinationOptions(facts({ localRootReady: false }), t);
    expect(local.disabled).toBe(true);
    expect(local.sub).toBe("create.localSubNoRoot");
  });

  it("says the browser cannot write the disk where it cannot", () => {
    const [local] = destinationOptions(facts({ localAvailable: false }), t);
    expect(local.disabled).toBe(true);
    expect(local.sub).toBe("library.diskUnsupported");
  });

  it("leads with the mapped root, and with Drive only when the disk is impossible", () => {
    expect(defaultDestination(facts())).toBe("local");
    expect(defaultDestination(facts({ localRootReady: false }))).toBe("drive");
    expect(defaultDestination(facts({ localAvailable: false }))).toBe("drive");
  });

  it("gates each place on its own facts", () => {
    expect(destinationUsable("drive", facts({ driveConnected: false }))).toBe(
      false,
    );
    expect(destinationUsable("drive", facts())).toBe(true);
    expect(destinationUsable("local", facts({ localRootReady: false }))).toBe(
      false,
    );
    expect(destinationUsable("local", facts())).toBe(true);
  });

  it("points at Settings only while Drive is not connected", () => {
    expect(destinationHintKey(facts())).toBeNull();
    expect(destinationHintKey(facts({ driveConnected: false }))).toBe(
      "create.connectDriveHint",
    );
    expect(
      destinationHintKey(
        facts({ driveConnected: false, localRootReady: false }),
      ),
    ).toBe("create.noDestinationHint");
  });

  it("never suggests Remote Storage to a writer without Google", () => {
    const offline = { driveConnected: false, remoteAvailable: false };
    expect(destinationHintKey(facts(offline))).toBeNull();
    expect(
      destinationHintKey(facts({ ...offline, localRootReady: false })),
    ).toBe("create.noDestinationHintLocal");
  });
});
