// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  cardActions,
  isDangerous,
  storageStateFor,
  type CardActionId,
  type CardActionInput,
} from "./cardActions";
import type { CardState } from "./useProjects";

const input = (over: Partial<CardActionInput> = {}): CardActionInput => ({
  storage: "local",
  state: "ready",
  remoteConnected: false,
  // A reachable web address by default; the reveal rows below flip it off.
  canRevealRemote: true,
  // A mapped root, the default: only the rootless rows below flip it.
  localRootReady: true,
  ...over,
});

const local = (state: CardState, remoteConnected = false) =>
  cardActions(input({ storage: "local", state, remoteConnected }));

const onRemote = (state: CardState, remoteConnected = true) =>
  cardActions(input({ storage: "remote", state, remoteConnected }));

const synced = (state: CardState, remoteConnected = true, remoteKey?: string) =>
  cardActions(input({ storage: "synced", state, remoteConnected, remoteKey }));

describe("storageStateFor", () => {
  it("is remote for anything on a network backend", () => {
    expect(storageStateFor("remote", false)).toBe("remote");
  });

  it("is local for an unpaired local project", () => {
    expect(storageStateFor("device", false)).toBe("local");
  });

  it("is synced for a paired local project", () => {
    expect(storageStateFor("device", true)).toBe("synced");
  });
});

describe("local, disconnected", () => {
  it("offers locate, properties, duplicate, export and remove", () => {
    expect(local("ready", false)).toEqual([
      "locate",
      "properties",
      "duplicate",
      "export",
      "forget",
    ]);
  });

  it("never offers sync or Move to Drive with nowhere to reach", () => {
    const items = local("ready", false);
    expect(items).not.toContain("sync");
    expect(items).not.toContain("moveToRemote");
  });
});

describe("local cards locate the folder wherever Drive state is", () => {
  it("a local card always carries locate — the local half's reveal", () => {
    expect(local("ready", false)).toContain("locate");
    expect(local("ready", true)).toContain("locate");
  });

  it("a synced card carries locate too — it is still a local folder", () => {
    expect(synced("ready", true)).toContain("locate");
  });

  it("a Drive card never does — its reveal is the Drive link", () => {
    expect(onRemote("ready")).not.toContain("locate");
  });

  it("no local card carries locate without a mapped root — the action walks the handle, and a click that does nothing is not an action", () => {
    expect(
      cardActions(
        input({ storage: "local", state: "ready", localRootReady: false }),
      ),
    ).not.toContain("locate");
    expect(
      cardActions(
        input({
          storage: "synced",
          state: "ready",
          localRootReady: false,
        }),
      ),
    ).not.toContain("locate");
  });
});

describe("local, connected", () => {
  it("adds sync and Move to Drive", () => {
    const items = local("ready", true);
    expect(items).toContain("sync");
    expect(items).toContain("moveToRemote");
  });

  it("never offers syncNow, unpair, or delete — nothing here is paired or on Drive", () => {
    const items = local("ready", true);
    expect(items).not.toContain("syncNow");
    expect(items).not.toContain("unpair");
    expect(items).not.toContain("delete");
  });
});

describe("drive", () => {
  it("gives a readable Drive project reveal, properties, duplicate, export, Move to Local, forget and delete", () => {
    expect(onRemote("ready")).toEqual([
      "reveal",
      "properties",
      "duplicate",
      "export",
      "moveToLocal",
      "forget",
      "delete",
    ]);
  });

  it("never offers sync, syncNow, or unpair — a Drive project is never paired", () => {
    const items = onRemote("ready");
    expect(items).not.toContain("sync");
    expect(items).not.toContain("syncNow");
    expect(items).not.toContain("unpair");
  });

  it("withholds Move to Local from anything short of fully readable", () => {
    for (const state of [
      "loading",
      "blocked",
      "gone",
      "unreadable",
    ] as CardState[]) {
      expect(onRemote(state)).not.toContain("moveToLocal");
    }
  });

  it("withholds delete only while loading or gone — a folder still worth binning otherwise", () => {
    expect(onRemote("loading")).not.toContain("delete");
    expect(onRemote("gone")).not.toContain("delete");
    expect(onRemote("unreadable")).toContain("delete");
  });

  it("withholds reveal when the backend has no web address", () => {
    // A backend without `folderUrl` has nowhere to send the writer, so the row
    // is absent rather than present and inert, as for every other capability.
    // Everything else the card offers is unaffected: a missing
    // capability, not a broken card.
    const items = cardActions(
      input({
        storage: "remote",
        state: "ready",
        remoteConnected: true,
        canRevealRemote: false,
      }),
    );
    expect(items).not.toContain("reveal");
    expect(items).toContain("delete");
  });

  it("withholds Move to Local and delete when Drive is disconnected", () => {
    const items = cardActions(
      input({ storage: "remote", state: "ready", remoteConnected: false }),
    );
    expect(items).not.toContain("moveToLocal");
    expect(items).not.toContain("delete");
  });

  it("offers forget even when Drive is disconnected — removing from library is local-only", () => {
    const items = cardActions(
      input({ storage: "remote", state: "ready", remoteConnected: false }),
    );
    expect(items).toContain("forget");
  });
});

describe("a blocked Drive card — the connection is gone, and delete needs it", () => {
  it("offers only forget — everything else needs a reach this device does not have, but removing from the library is local-only", () => {
    expect(onRemote("blocked", false)).toEqual(["forget"]);
  });

  it("withholds properties, duplicate, moveToLocal and delete, unlike a merely stale but readable card", () => {
    const items = onRemote("blocked", false);
    expect(items).not.toContain("properties");
    expect(items).not.toContain("duplicate");
    expect(items).not.toContain("moveToLocal");
    expect(items).not.toContain("delete");
  });

  it("a blocked LOCAL card is reachable — its files are on this disk, the banner is the recovery", () => {
    const items = cardActions(
      input({
        storage: "local",
        state: "blocked",
        localRootReady: true,
      }),
    );
    expect(items).toContain("locate");
    expect(items).toContain("forget");
  });

  it("a GONE local card offers no reveal — the folder is not under this root, and the card already says so", () => {
    const items = cardActions(
      input({
        storage: "local",
        state: "gone",
        localRootReady: true,
      }),
    );
    expect(items).not.toContain("locate");
    expect(items).toEqual(["forget"]);
  });
});

describe("synced, connected", () => {
  it("gives locate, properties, duplicate, export, syncNow, unpair, forget and delete — never sync or moveToRemote", () => {
    const items = synced("ready", true);
    // Forget comes ahead of delete: it is reversible and undoable, so it is
    // not part of the destructive run.
    expect(items).toEqual([
      "locate",
      "properties",
      "duplicate",
      "export",
      "syncNow",
      "unpair",
      "forget",
      "delete",
    ]);
  });

  it("adds Reveal in Drive when the paired Drive folder id is available", () => {
    const items = synced("ready", true, "folder-123");
    expect(items[0]).toBe("reveal");
    expect(items).toContain("reveal");
  });

  it("omits Reveal in Drive when no Drive folder id is resolved", () => {
    expect(synced("ready", true)).not.toContain("reveal");
  });

  it("offers both Delete and Remove — the explicit per-side choice, not one bundled action", () => {
    const items = synced("ready", true);
    expect(items).toContain("delete");
    expect(items).toContain("forget");
  });

  it("never offers sync or moveToRemote — already synced, and identity never becomes Drive-primary", () => {
    const items = synced("ready", true);
    expect(items).not.toContain("sync");
    expect(items).not.toContain("moveToRemote");
  });
});

describe("synced, disconnected", () => {
  it("still offers unpair — a local-only operation, the way out of a stuck pairing", () => {
    expect(synced("ready", false)).toContain("unpair");
  });

  it("withholds syncNow and delete — both need to reach Drive", () => {
    const items = synced("ready", false);
    expect(items).not.toContain("syncNow");
    expect(items).not.toContain("delete");
  });

  it("omits Reveal in Drive even with a paired folder id when disconnected", () => {
    const items = synced("ready", false, "folder-123");
    expect(items).not.toContain("reveal");
  });

  it("omits Reveal in Drive when no Drive folder id is resolved", () => {
    expect(synced("ready", false)).not.toContain("reveal");
  });
});

describe("readability gates properties and duplicate everywhere", () => {
  it("withholds properties and duplicate from a project that cannot be read right now", () => {
    for (const state of [
      "loading",
      "blocked",
      "gone",
      "unreadable",
    ] as CardState[]) {
      expect(local(state)).not.toContain("properties");
      expect(local(state)).not.toContain("duplicate");
      expect(onRemote(state)).not.toContain("properties");
      expect(onRemote(state)).not.toContain("duplicate");
      expect(synced(state)).not.toContain("properties");
      expect(synced(state)).not.toContain("duplicate");
    }
  });

  // An export reads every file the book has, so a card that cannot be
  // read now would open a window only to say it could not open the book.
  it("offers export only on a card read this session, wherever it lives", () => {
    for (const state of [
      "loading",
      "blocked",
      "gone",
      "unreadable",
    ] as CardState[]) {
      expect(local(state)).not.toContain("export");
      expect(onRemote(state)).not.toContain("export");
      expect(synced(state)).not.toContain("export");
    }
    expect(local("ready")).toContain("export");
    expect(onRemote("ready")).toContain("export");
    expect(synced("ready")).toContain("export");
  });
});

describe("menu order", () => {
  // Menu draws one separator, before the first item marked danger. A safe item
  // after a destructive one would end up below that rule.
  it("puts every destructive item last, in one run", () => {
    const cases: CardActionId[][] = [
      local("ready", true),
      local("blocked"),
      onRemote("ready"),
      onRemote("blocked"),
      synced("ready", true),
      synced("ready", true, "folder-123"),
      synced("ready", false),
    ];
    for (const items of cases) {
      const first = items.findIndex(isDangerous);
      if (first === -1) continue;
      expect(items.slice(first).every(isDangerous)).toBe(true);
    }
  });

  it("leads with Reveal in Drive, which is the only one that leaves the app", () => {
    expect(onRemote("ready")[0]).toBe("reveal");
  });

  it("Move to Local is dangerous; Move to Drive is not", () => {
    expect(isDangerous("moveToLocal")).toBe(true);
    expect(isDangerous("moveToRemote")).toBe(false);
  });

  it("unpair is not dangerous — both copies survive it", () => {
    expect(isDangerous("unpair")).toBe(false);
  });

  it("forget is dangerous — it sits in the danger zone alongside delete and moveToLocal", () => {
    expect(isDangerous("forget")).toBe(true);
  });
});
