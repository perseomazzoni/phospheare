// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A fake OPFS: the only way a test can produce this layer's real failures. No
// browser reports an eviction, OPFS is evictable on every engine, and
// `navigator.storage.persist()` may be refused, so an entry vanishing between
// two awaits inside one operation of the layer above can only come from a
// fake that evicts on command. That is what `hook` is for, and why
// `cacheRoot.ts` is the single seam it stands in for.
//
// It is a module in `src/`, not a closure in one test file, because several
// suites share it, divergent copies of a fake stop modelling the same thing,
// and a test file importing another is fragile under vitest's per-file
// environment.
//
// It counts toward coverage with no exclusion: an uncovered branch in a
// double is a case it claims to support and no test exercises. Delete an
// unreached branch instead of excluding it.
//
// Truncate-on-open is pessimistic and is not a claim about any engine.
// `createWritable()` empties the file at once, bytes appear only when
// `close()` resolves, and `abort()` leaves it empty. Chromium is kinder: the
// original stays readable and an abort leaves it untouched
// (`e2e/cache-store.spec.ts` pins that). Whether a half-finished write keeps
// the previous bytes is the engine's choice, not the spec's promise, and
// being wrong pushes a torn file over the writer's remote copy. The harsh
// model proves the adapter never relies on the original surviving.
//
// Errors are real `DOMException`s with real names. The layer above routes on
// `err.name`, and `new Error("NotFoundError")` has the name "Error", so it
// would let a wrong mapping pass every test.

/** One faked platform call, in the order it happened. */
export interface OpfsCall {
  call:
    | "getDirectory"
    | "getDirectoryHandle"
    | "getFileHandle"
    | "removeEntry"
    | "keys"
    | "getFile"
    | "createWritable"
    | "write"
    | "close"
    | "abort";
  /** The full path the call concerns; "" is the OPFS root. */
  path: string;
  /** Whether the call was allowed to create what it did not find. */
  create?: boolean;
}

export function domError(name: string): DOMException {
  return new DOMException(`fake: ${name}`, name);
}

function join(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

export interface FakeOpfs {
  /** Directory paths that exist. The OPFS root ("") always does. */
  readonly dirs: Set<string>;
  /** File path to committed content. Assert bytes here, never call counts. */
  readonly files: Map<string, string>;
  /** Every faked call, in order. */
  readonly calls: OpfsCall[];
  /**
   * Called before each faked call. Mutate the store to evict mid-operation, or
   * throw to make the platform refuse.
   */
  hook: ((call: OpfsCall) => void) | null;
  /** Creates a directory and every parent, as a `{create:true}` walk does. */
  seedDir(path: string): void;
  /**
   * Puts a file there with content, and stamps it as the newest write.
   *
   * Seed through this, not through `files`: it gives the entry an mtime, and
   * the budget evicts least-recently-written first, so an unstamped cache
   * evicts in `Map` insertion order.
   */
  seedFile(path: string, content: string): void;
  /** Drops everything, as an eviction of the whole origin does. */
  evictAll(): void;
  /** Drops one entry; browsers also evict per file. */
  evict(path: string): void;
  install(): void;
  uninstall(): void;
}

export function fakeOpfs(): FakeOpfs {
  const dirs = new Set<string>([""]);
  const files = new Map<string, string>();
  const calls: OpfsCall[] = [];
  // Write times, beside the bytes: a real OPFS file has an mtime the platform
  // maintains, and the budget evicts least-recently-written first. Without a
  // clock, every eviction test would depend on `Map` iteration order.
  const mtimes = new Map<string, number>();
  let clock = 1;

  /** The immediate children of a directory path, files and directories. */
  function childrenOf(path: string): string[] {
    const under = path === "" ? "" : `${path}/`;
    const seen = new Set<string>();
    for (const key of [...dirs, ...files.keys()]) {
      if (key === path || !key.startsWith(under)) continue;
      const rest = key.slice(under.length);
      if (rest === "" || rest.includes("/")) continue;
      seen.add(rest);
    }
    return [...seen];
  }

  const fake: FakeOpfs = {
    dirs,
    files,
    calls,
    hook: null,
    seedDir(path) {
      const parts = path.split("/").filter(Boolean);
      let at = "";
      for (const part of parts) {
        at = join(at, part);
        dirs.add(at);
      }
    },
    seedFile(path, content) {
      const cut = path.lastIndexOf("/");
      if (cut > 0) fake.seedDir(path.slice(0, cut));
      files.set(path, content);
      mtimes.set(path, clock++);
    },
    evictAll() {
      dirs.clear();
      dirs.add("");
      files.clear();
    },
    evict(path) {
      files.delete(path);
      dirs.delete(path);
    },
    install() {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: { getDirectory: async () => dirHandle("") },
      });
    },
    uninstall() {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: undefined,
      });
    },
  };

  function record(call: OpfsCall): void {
    calls.push(call);
    fake.hook?.(call);
  }

  function writable(path: string): FileSystemWritableFileStream {
    // Truncate-on-open, at once and visibly, as the header states.
    files.set(path, "");
    let buffer = "";
    let open = true;
    return {
      async write(data: unknown) {
        record({ call: "write", path });
        if (!open) throw domError("InvalidStateError");
        buffer += String(data);
      },
      async close() {
        record({ call: "close", path });
        if (!open) throw domError("InvalidStateError");
        open = false;
        files.set(path, buffer);
        // A real close advances the file's mtime. It is stamped here, not on
        // `write()`, because the bytes are not the file until this settles,
        // the instant the adapter may call the write done.
        mtimes.set(path, clock++);
      },
      async abort() {
        record({ call: "abort", path });
        open = false;
      },
    } as unknown as FileSystemWritableFileStream;
  }

  function fileHandle(path: string): FileSystemFileHandle {
    return {
      kind: "file",
      name: path.slice(path.lastIndexOf("/") + 1),
      async getFile() {
        record({ call: "getFile", path });
        const content = files.get(path);
        // The eviction case: the handle is still in hand, the bytes are not.
        if (content === undefined) throw domError("NotFoundError");
        return {
          text: async () => content,
          // The budget measures bytes and write recency, so a fake `File` with
          // only `text()` would let eviction tests pass against a cache
          // measured as empty. `size` counts UTF-8 bytes, not characters,
          // because prose holds many characters wider than one byte.
          size: new TextEncoder().encode(content).length,
          lastModified: mtimes.get(path) ?? 0,
        } as unknown as File;
      },
      async createWritable() {
        record({ call: "createWritable", path });
        if (!files.has(path)) throw domError("NotFoundError");
        return writable(path);
      },
    } as unknown as FileSystemFileHandle;
  }

  function dirHandle(path: string): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      name: path.slice(path.lastIndexOf("/") + 1),
      async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
        const at = join(path, name);
        record({
          call: "getDirectoryHandle",
          path: at,
          create: !!opts?.create,
        });
        if (!dirs.has(at)) {
          if (!opts?.create) throw domError("NotFoundError");
          if (files.has(at)) throw domError("TypeMismatchError");
          dirs.add(at);
        }
        return dirHandle(at);
      },
      async getFileHandle(name: string, opts?: { create?: boolean }) {
        const at = join(path, name);
        record({ call: "getFileHandle", path: at, create: !!opts?.create });
        // A walk that reached here through a directory the hook has since
        // evicted must fail like the platform, not invent the parent back.
        if (!dirs.has(path)) throw domError("NotFoundError");
        if (!files.has(at)) {
          if (!opts?.create) throw domError("NotFoundError");
          files.set(at, "");
        }
        return fileHandle(at);
      },
      async removeEntry(name: string, opts?: { recursive?: boolean }) {
        const at = join(path, name);
        record({ call: "removeEntry", path: at });
        if (!dirs.has(at) && !files.has(at)) throw domError("NotFoundError");
        files.delete(at);
        dirs.delete(at);
        if (opts?.recursive) {
          const under = `${at}/`;
          for (const key of [...files.keys()])
            if (key.startsWith(under)) files.delete(key);
          for (const key of [...dirs])
            if (key.startsWith(under)) dirs.delete(key);
        }
      },
      async *keys() {
        record({ call: "keys", path });
        for (const name of childrenOf(path)) yield name;
      },
      // The walk the budget uses: it needs the handle as well as the name, to
      // recurse into a directory or measure a file. It shares `childrenOf`
      // with `keys()`, because two listings that disagree let a sweep measure
      // a directory it cannot then remove.
      async *entries() {
        record({ call: "keys", path });
        for (const name of childrenOf(path)) {
          const at = join(path, name);
          yield [name, dirs.has(at) ? dirHandle(at) : fileHandle(at)] as [
            string,
            FileSystemHandle,
          ];
        }
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  return fake;
}
