// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setCurrentUserId } from "../../auth/currentUser";
import { markUserPurged } from "../../profile/purgeLatch";
import { isPermanent } from "../../project/sync/remoteQueue";
import { StorageError } from "../types";
import {
  SEGMENT_ALPHABET,
  pathSegments,
  remoteSegmentFor,
  segmentFor,
} from "./cachePath";
import { openCacheStore } from "./opfsCacheStore";
import { domError, fakeOpfs, type FakeOpfs } from "./fakeOpfs.fixture";
import type { CacheStore } from "./cacheStore";

// Pins the OPFS adapter against a fake that can evict. Two invariants run
// through the rows.
//
// A miss is a value. Every way an entry can be absent (cold start, a missing
// user directory, a missing project segment, an eviction between two awaits
// inside one operation) arrives as `null`, never as a throw. The queue
// classifies a thrown `not-found` as permanent and dead-letters the op, and
// the cache is the queue's only source, so that throw would discard
// the writer's only copy of that work.
//
// A short file is not an entry. OPFS has no portable atomic rename, and what
// an interrupted write leaves behind depends on the engine: Chromium writes
// through a swap file and keeps the previous entry intact
// (`e2e/cache-store.spec.ts`), while `fakeOpfs.fixture.ts` models the harsher
// truncate-on-open behaviour so the adapter cannot depend on the kinder one.
// Either way the failure leaves bytes that read cleanly and mean nothing; the
// header checksum turns those into misses.

// The project's own id: the working copy is named after the book, and
// the copy inside it after the remote it is bound to.
const BOOK = "3f1c9a52-0b6e-4d21-a7f8-9c2e6b40d115";
const TARGET = { id: BOOK, remote: { providerId: "drive", key: "folder-1" } };
const PATH = "/document/section--opening.EL2.00.md";

let opfs: FakeOpfs;
let store: CacheStore;
/** The book's segment and this remote's copy in it, as one path. */
let segment: string;

beforeEach(async () => {
  opfs = fakeOpfs();
  opfs.install();
  setCurrentUserId("7");
  segment = `${await segmentFor(BOOK)}/${await remoteSegmentFor(TARGET.remote)}`;
  store = openCacheStore(TARGET);
});

afterEach(() => {
  opfs.uninstall();
  setCurrentUserId(null);
});

/** The committed bytes for a path, as they sit on the fake. */
function raw(path = PATH): string | undefined {
  const parts = path.split("/").filter(Boolean);
  return opfs.files.get(`cache/7/${segment}/${parts.join("/")}`);
}

describe("naming", () => {
  it("produces a segment from a provably conservative alphabet", async () => {
    // A segment the platform refuses as a name, such as one holding a slash,
    // is the failure this guards. Asserting the output alphabet here leaves
    // the browser spec only to confirm that the platform accepts hex, which
    // `SAFE_ID` already assumes.
    // The id is a uuid wherever the app minted it, but it is read from
    // `document-properties.json`, which a writer can hand-edit, so nothing
    // guarantees its shape here. These inputs are the case for the digest.
    for (const id of [BOOK, "a/b", "..", "", "ü — ñ", "x".repeat(400)]) {
      const seg = await segmentFor(id);
      expect(seg).toMatch(SEGMENT_ALPHABET);
    }
  });

  it("gives different projects different segments, including near-misses", async () => {
    // A collision serves one book's bytes for another book's path. There is no
    // attacker here, so preimage resistance is irrelevant; collision
    // resistance is why the digest is untruncated.
    const ids = ["a/b", "a%2Fb", "a:b", "a", "b"];
    const segs = await Promise.all(ids.map((id) => segmentFor(id)));
    expect(new Set(segs).size).toBe(ids.length);
  });

  it("keeps a book's copy for as long as it keeps its remote", async () => {
    const first = openCacheStore(TARGET);
    await first.write(PATH, "hello");
    first.dispose();

    const again = openCacheStore({ id: BOOK, remote: { ...TARGET.remote } });
    expect((await again.read(PATH))?.text).toBe("hello");
    again.dispose();
  });

  it("gives a book bound to another remote its own copy, never the last one's", async () => {
    // A book moved off Drive and later back onto a new folder keeps its id.
    // The copy it left describes the old folder, and serving it would shadow
    // the new folder's text.
    const old = openCacheStore(TARGET);
    await old.write(PATH, "the old folder's text");
    old.dispose();

    const moved = openCacheStore({
      id: BOOK,
      remote: { providerId: "drive", key: "folder-2" },
    });
    expect(await moved.read(PATH)).toBeNull();
    await moved.write(PATH, "the new folder's text");
    moved.dispose();

    const back = openCacheStore(TARGET);
    expect((await back.read(PATH))?.text).toBe("the old folder's text");
    back.dispose();
  });

  it("separates remotes whose fields would run together", async () => {
    const a = await remoteSegmentFor({ providerId: "a:b", key: "c" });
    const b = await remoteSegmentFor({ providerId: "a", key: "b:c" });
    expect(a).toMatch(SEGMENT_ALPHABET);
    expect(a).not.toBe(b);
  });

  it("refuses a path it cannot walk, and never normalizes one", () => {
    for (const bad of ["", "/", "/a/../b", "/a/./b", "/a\\b", "/a\0b"]) {
      const err = (() => {
        try {
          pathSegments(bad);
        } catch (e) {
          return e;
        }
        return null;
      })();
      // It must be a `StorageError`, because a bare throw reaches the drain as
      // `codeOf() === null`, neither permanent nor recognised. It must carry
      // `unusable-path`, the one source code the drain stops on instead of
      // retrying against a remote that was never the problem. And a `key`:
      // the writer can act on this failure, and the storage layer's own
      // English must never reach a screen.
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).code).toBe("unusable-path");
      expect((err as StorageError).key).toBe("storage.unusablePath");
    }
    // Refusing is not rewriting: a legal path passes through unchanged, with
    // no collapsing and no trimming.
    expect(pathSegments("/document/a.md")).toEqual(["document", "a.md"]);
  });
});

describe("opening the store", () => {
  it("refuses with no resolved user", () => {
    setCurrentUserId(null);
    expect(() => openCacheStore(TARGET)).toThrow(/no resolved user/);
  });

  it("refuses with no remote target — which is what excludes the demo", () => {
    // The demo editor has only memory storage. It needs no code of its own,
    // because `/app/editor/demo` has no remote to open a store against; a
    // change that hands the demo a remote fails here instead of caching a
    // visitor's typing.
    expect(() =>
      openCacheStore({ id: BOOK, remote: { providerId: "", key: "" } }),
    ).toThrow(/no remote target/);
  });

  it("stops working when the signed-in user changes under it", async () => {
    await store.write(PATH, "mine");
    setCurrentUserId("9");
    // Poisoned, not re-pointed: the second writer must not read the first
    // one's prose through a store the first one opened.
    await expect(store.read(PATH)).rejects.toBeInstanceOf(StorageError);
    await expect(store.write(PATH, "theirs")).rejects.toBeInstanceOf(
      StorageError,
    );
  });

  // A save that outlasts the sign-out's wait for open work must not recreate
  // the working copy the purge deletes.
  it("refuses a write once this user's data is purged, and creates nothing", async () => {
    markUserPurged("7");
    await expect(store.write(PATH, "late")).rejects.toMatchObject({
      code: "permission",
    });
    expect(opfs.dirs.has("cache/7")).toBe(false);
  });

  it("lands nothing from a write already in flight when the purge starts", async () => {
    const late = store.write(PATH, "late");
    markUserPurged("7");
    await expect(late).rejects.toMatchObject({ code: "permission" });
    expect(raw()).toBeUndefined();
    expect(opfs.dirs.has("cache/7")).toBe(false);
  });
});

describe("reading what is not there", () => {
  it("misses on a cold start, with nothing in the origin at all", async () => {
    expect(await store.read(PATH)).toBeNull();
    expect(await store.has(PATH)).toBe(false);
    await expect(store.remove(PATH)).resolves.toBeUndefined();
  });

  it("misses identically when the user directory or the segment is absent", async () => {
    // A cold start must be byte-identical to a first-ever run. If these three
    // states could be told apart, something above would branch on a
    // distinction nothing can produce truthfully.
    opfs.seedDir("cache");
    expect(await store.read(PATH)).toBeNull();
    opfs.seedDir("cache/7");
    expect(await store.read(PATH)).toBeNull();
    opfs.seedDir(`cache/7/${segment}`);
    expect(await store.read(PATH)).toBeNull();
  });

  it("creates nothing while probing", async () => {
    await store.has(PATH);
    await store.read(PATH);
    // A probe that scaffolds directories leaves empty user directories for
    // `dropOtherUserCaches` to sweep: a read with a side effect on the
    // sign-out path.
    expect(opfs.dirs.has("cache/7")).toBe(false);
    expect(opfs.calls.every((c) => c.create !== true)).toBe(true);
  });
});

describe("round trip", () => {
  it("returns the exact bytes, for every shape that usually gets mangled", async () => {
    // The cache must be byte-identical to what the remote holds. A normalizing
    // round trip either breaks every fingerprint comparison or edits the
    // writer's prose; CRLF and split surrogates are the usual culprits.
    for (const text of [
      "",
      "plain",
      "é combining",
      "😀 surrogate pair",
      "crlf\r\nkept",
      "lone\rcarriage",
      "trailing newline\n",
    ]) {
      await store.write(PATH, text);
      const entry = await store.read(PATH);
      expect(entry?.text).toBe(text);
      expect(entry?.text.length).toBe(text.length);
    }
  });

  it("treats an empty file as a value, not a miss", async () => {
    await store.write(PATH, "");
    expect(await store.read(PATH)).toEqual({
      text: "",
      hash: expect.any(String),
    });
    expect(await store.has(PATH)).toBe(true);
  });

  it("reads back in the same tick it was written", async () => {
    // The awaited write, made observable: the promise does not resolve until
    // the bytes are in the file.
    const written = await store.write(PATH, "fresh");
    expect((await store.read(PATH))?.hash).toBe(written.hash);
  });

  it("closes the writable, so the next write is not locked out", async () => {
    await store.write(PATH, "one");
    await store.write(PATH, "two");
    expect((await store.read(PATH))?.text).toBe("two");
    const closes = opfs.calls.filter((c) => c.call === "close").length;
    expect(closes).toBe(2);
  });
});

describe("eviction, which is not an event", () => {
  it("misses cleanly after an entry is evicted between has and read", async () => {
    await store.write(PATH, "prose");
    expect(await store.has(PATH)).toBe(true);
    opfs.evictAll();
    expect(await store.read(PATH)).toBeNull();
  });

  it("misses when the bytes vanish between opening the file and reading it", async () => {
    // Only a hook can produce this case: the handle is in hand, the file is
    // gone. `cacheRoot.ts` is a single seam so that a fake can.
    await store.write(PATH, "prose");
    opfs.hook = (call) => {
      if (call.call === "getFile") opfs.evictAll();
    };
    expect(await store.read(PATH)).toBeNull();
  });

  it("misses only the entry that was evicted, not its siblings", async () => {
    // Per-file eviction is a real shape, not only a whole-origin wipe: a
    // browser reclaiming space need not take everything. If one gone entry
    // made its neighbours unreadable, a partial eviction would read as total
    // loss and the fill would re-fetch a whole project.
    await store.write(PATH, "one");
    await store.write("/document/other.md", "two");
    opfs.evict(`cache/7/${segment}/document/other.md`);
    expect((await store.read(PATH))?.text).toBe("one");
    expect(await store.read("/document/other.md")).toBeNull();
  });

  it("misses when the segment vanishes mid-walk", async () => {
    await store.write(PATH, "prose");
    opfs.hook = (call) => {
      if (call.call === "getDirectoryHandle" && call.path.endsWith(segment)) {
        opfs.evictAll();
      }
    };
    expect(await store.read(PATH)).toBeNull();
  });

  it("leaves no half-entry that reads as valid when a write dies mid-flight", async () => {
    await store.write(PATH, "the good version");
    opfs.hook = (call) => {
      if (call.call === "close") throw domError("QuotaExceededError");
    };
    await expect(
      store.write(PATH, "the doomed version"),
    ).rejects.toBeInstanceOf(StorageError);
    // The file is present, truncated by `createWritable`, so the miss must
    // come from the header check.
    expect(raw()).toBe("");
    expect(await store.read(PATH)).toBeNull();
    expect(await store.has(PATH)).toBe(false);
  });

  it("treats a corrupted entry as a miss, not as content", async () => {
    await store.write(PATH, "prose");
    const key = `cache/7/${segment}/document/section--opening.EL2.00.md`;
    // A header that parses, over bytes that do not match it: a torn write no
    // truncation produced, or a file something else touched.
    opfs.files.set(key, `${"a".repeat(64)}\ntampered`);
    expect(await store.read(PATH)).toBeNull();
    // And a file with no header at all.
    opfs.files.set(key, "just some bytes");
    expect(await store.read(PATH)).toBeNull();
  });
});

describe("failures reach the caller as codes, not as DOMExceptions", () => {
  it("maps quota to a code the queue will RETRY, never dead-letter", async () => {
    opfs.hook = (call) => {
      if (call.call === "write") throw domError("QuotaExceededError");
    };
    const err = await store.write(PATH, "prose").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("no-space");
    // Asserted against the queue's own predicate. The cache is a source, and
    // a source's errors never reach `isPermanent`, so this pin is a
    // second line of defence: it fails if a cache error is ever routed to the
    // destination's axis.
    expect(isPermanent((err as StorageError).code)).toBe(false);
  });

  it("never mints a permanent code for a failure that heals", async () => {
    // The whole mapping table, checked for one property. The source axis, not
    // the destination's predicate, protects the queue from these codes:
    // `not-found` is permanent and reachable here, but only from a
    // read path, where it becomes a miss and never reaches the queue.
    for (const name of [
      "QuotaExceededError",
      "NoModificationAllowedError",
      "InvalidStateError",
      "AbortError",
      "UnknownEngineError",
    ]) {
      opfs.hook = (call) => {
        if (call.call === "createWritable") throw domError(name);
      };
      const err = await store.write(PATH, "prose").catch((e: unknown) => e);
      expect(isPermanent((err as StorageError).code)).toBe(false);
    }
  });

  it("maps a refusal to permission and anything else to io", async () => {
    for (const [name, code] of [
      ["NotAllowedError", "permission"],
      ["SecurityError", "permission"],
      ["NoModificationAllowedError", "io"],
      ["InvalidStateError", "io"],
      ["AbortError", "io"],
    ] as const) {
      opfs.hook = (call) => {
        if (call.call === "createWritable") throw domError(name);
      };
      const err = await store.write(PATH, "prose").catch((e: unknown) => e);
      expect((err as StorageError).code).toBe(code);
    }
  });

  it("maps a vanished parent on the WRITE path to not-found, loudly", async () => {
    // `not-found` is a miss on a read and a real failure on a write, and the
    // adapter must not blur them: a save whose directory disappeared
    // mid-flight did not happen, and reporting it as a miss would let the
    // queue append an op for a write that never landed.
    opfs.hook = (call) => {
      if (call.call === "getFileHandle") throw domError("NotFoundError");
    };
    const err = await store.write(PATH, "prose").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("not-found");
  });

  it("lets a probe fail loudly when the failure is not absence", async () => {
    // `has` swallows `NotFoundError`, which is a miss. Anything else is a
    // platform problem the caller must hear about; swallowing one class too
    // many turns a broken store into an empty one.
    await store.write(PATH, "prose");
    opfs.hook = (call) => {
      if (call.call === "getFile") throw domError("NoModificationAllowedError");
    };
    await expect(store.has(PATH)).rejects.toBeInstanceOf(StorageError);
    await expect(store.read(PATH)).rejects.toBeInstanceOf(StorageError);
  });

  it("aborts the writable when the write fails, so nothing stays locked", async () => {
    opfs.hook = (call) => {
      if (call.call === "write") throw domError("QuotaExceededError");
    };
    await store.write(PATH, "prose").catch(() => {});
    expect(opfs.calls.some((c) => c.call === "abort")).toBe(true);
  });

  it("maps something that is not a DOMException at all to io", async () => {
    // The engine is not the only thing that can throw in here. Whatever it is
    // arrives as a `StorageError` with a transient code rather than raw, so
    // the drain never has to string-match a message.
    for (const thrown of [new TypeError("boom"), "a bare string"]) {
      opfs.hook = () => {
        throw thrown;
      };
      const err = await store.write(PATH, "prose").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).code).toBe("io");
    }
  });

  it("keeps the original failure when the cleanup abort fails too", async () => {
    // Both halves fail at once: the write is rejected for quota, and the abort
    // that unlocks the file throws on its way out. The caller still hears
    // `no-space`; reporting the abort would turn a transient, actionable
    // failure into a lock nobody can explain.
    await store.write(PATH, "one");
    opfs.hook = (call) => {
      if (call.call === "write") throw domError("QuotaExceededError");
      if (call.call === "abort") throw domError("InvalidStateError");
    };
    const err = await store.write(PATH, "two").catch((e: unknown) => e);
    expect((err as StorageError).code).toBe("no-space");
  });

  it("refuses every call once disposed, and does not mind being disposed twice", async () => {
    // `dispose` releases the `onUserChange` subscription this store takes at
    // construction; the drain opens one store per pass, so an undisposed
    // store leaks one listener and its closure per drain. The unsubscribe is
    // not observable from here. What is observable, and what stops a caller
    // that kept a reference, is that every method refuses afterwards.
    await store.write(PATH, "one");
    store.dispose();
    store.dispose();

    for (const call of [
      () => store.read(PATH),
      () => store.write(PATH, "two"),
      () => store.has(PATH),
      () => store.remove(PATH),
      () => store.dropProject(),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      // `io`: the drain classifies this on the source axis and retries. A
      // permanent code would stop an op over a bug in the store's own
      // lifetime handling.
      expect((err as StorageError).code).toBe("io");
      expect(isPermanent((err as StorageError).code)).toBe(false);
    }
    // The bytes are untouched: disposal releases a subscription, not data.
    expect(raw()).toBeDefined();
  });

  it("declines rather than pretending when the browser has no OPFS at all", async () => {
    opfs.uninstall();
    // A miss for reads, the same answer as an empty cache, which is true.
    expect(await store.read(PATH)).toBeNull();
    // A write must not report a success it did not achieve.
    await expect(store.write(PATH, "prose")).rejects.toBeInstanceOf(
      StorageError,
    );
  });
});

describe("removing", () => {
  it("removes one entry and leaves the rest of the project alone", async () => {
    await store.write(PATH, "one");
    await store.write("/document/other.md", "two");
    await store.remove(PATH);
    expect(await store.read(PATH)).toBeNull();
    expect((await store.read("/document/other.md"))?.text).toBe("two");
  });

  it("is idempotent", async () => {
    await store.write(PATH, "one");
    await store.remove(PATH);
    await expect(store.remove(PATH)).resolves.toBeUndefined();
  });

  it("drops the whole project segment, which is the eviction unit", async () => {
    await store.write(PATH, "one");
    await store.write("/document/other.md", "two");
    await store.dropProject();
    expect([...opfs.files.keys()].some((k) => k.includes(segment))).toBe(false);
    // The user's own directory survives: this drops a project, not an account.
    expect(opfs.dirs.has("cache/7")).toBe(true);
  });

  it("reports a real platform failure rather than shrugging it off", async () => {
    // Absent is fine and silent; anything else is a failure the caller must
    // hear about. These are the only two places in the adapter that swallow
    // an exception by name, and swallowing one class too many reports a
    // delete that never happened as done.
    await store.write(PATH, "one");
    opfs.hook = (call) => {
      if (call.call === "removeEntry")
        throw domError("NoModificationAllowedError");
    };
    await expect(store.remove(PATH)).rejects.toBeInstanceOf(StorageError);
    await expect(store.dropProject()).rejects.toBeInstanceOf(StorageError);
  });

  it("drops a project that was never cached without complaining", async () => {
    await expect(store.dropProject()).resolves.toBeUndefined();
  });

  it("drops a project whose segment is already gone, quietly", async () => {
    // The user directory exists, because another project cached, but this
    // one's segment does not. Absent is the goal achieved, not a failure.
    await store.write(PATH, "one");
    opfs.evict(`cache/7/${segment}`);
    await expect(store.dropProject()).resolves.toBeUndefined();
  });
});
