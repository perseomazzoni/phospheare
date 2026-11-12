// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectRef, StorageProvider } from "../../../storage";

// Pins where an export lands. The sink decides which homes a book has, and a
// home that fails never stops the others or the download. Both rest on two
// lookups the rest of the app owns, the provider registry and the pairing, so
// both are mocked: the rows choose what the registry holds and whether the
// book is paired, and watch where the bytes go.
//
// The registry is mocked whole rather than spread over the real one, because
// the real index loads the Drive client and the local root at import, and the
// sink asks it only for `getProvider`.

const providers = new Map<string, StorageProvider>();
vi.mock("../../../storage", () => ({
  getProvider: (id: string) => providers.get(id) ?? null,
}));

const remoteFor = vi.fn();
vi.mock("../../../project/sync/remoteFor", () => ({
  remoteFor: (ref: ProjectRef) => remoteFor(ref),
}));

const { projectExportSink } = await import("./projectSink");

const ref: ProjectRef = {
  providerId: "local",
  key: "once-dark",
  name: "Once Dark",
  openedAt: "2026-10-01T00:00:00.000Z",
};

const PDF = "application/pdf";
const BYTES = new Uint8Array([0x25, 0x00, 0xff]);

/**
 * A bare provider: only what the sink touches, every call recorded. `holds` is
 * what its `export/` folder already has; `listFails` is a home that cannot
 * answer (the remote offline).
 */
function home(
  id: string,
  kind: "device" | "remote",
  opts: { holds?: string[]; listFails?: boolean; writeFails?: boolean } = {},
) {
  const holds = opts.holds ?? [];
  return {
    id,
    kind,
    exists: vi.fn(async () => {
      if (opts.listFails) throw new Error("offline");
      return holds.length > 0;
    }),
    listDir: vi.fn(async () => {
      if (opts.listFails) throw new Error("offline");
      return holds.map((name) => ({
        path: `/export/${name}`,
        name,
        kind: "file" as const,
      }));
    }),
    writeBytes: vi.fn(async () => {
      if (opts.writeFails) throw new Error("offline");
    }),
  } as unknown as StorageProvider & {
    exists: ReturnType<typeof vi.fn>;
    listDir: ReturnType<typeof vi.fn>;
    writeBytes: ReturnType<typeof vi.fn>;
  };
}

function sink(storage: StorageProvider, at: ProjectRef = ref) {
  const download = vi.fn();
  return {
    download,
    sink: projectExportSink({ storage, ref: at, download }),
  };
}

afterEach(() => {
  providers.clear();
  remoteFor.mockReset();
});

describe("the book's homes", () => {
  it("is the device folder alone for a book that is not paired", async () => {
    const local = home("local", "device");
    providers.set("local", local);
    remoteFor.mockResolvedValue(null);

    const reports = await sink(local).sink.save("once-dark.pdf", BYTES, PDF);
    expect(reports).toEqual([{ home: "device", ok: true }]);
    expect(local.writeBytes).toHaveBeenCalledWith(
      ref,
      "/export/once-dark.pdf",
      BYTES,
      PDF,
    );
  });

  // An export goes everywhere the book lives. The remote home is addressed
  // by the pairing's key, not the device folder's name; `drive:once-dark`
  // would be a folder that does not exist.
  it("adds the paired remote for a device book that syncs", async () => {
    const local = home("local", "device");
    const drive = home("drive", "remote");
    providers.set("local", local);
    providers.set("drive", drive);
    remoteFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });

    const reports = await sink(local).sink.save("once-dark.pdf", BYTES, PDF);
    expect(reports).toEqual([
      { home: "device", ok: true },
      { home: "remote", ok: true },
    ]);
    expect(drive.writeBytes).toHaveBeenCalledWith(
      { ...ref, providerId: "drive", key: "folder-1" },
      "/export/once-dark.pdf",
      BYTES,
      PDF,
    );
  });

  it("is the remote alone for a book that lives only there, with no pairing asked", async () => {
    const drive = home("drive", "remote");
    providers.set("drive", drive);
    const at = { ...ref, providerId: "drive", key: "folder-1" };

    const reports = await sink(drive, at).sink.save("a.pdf", BYTES, PDF);
    expect(reports).toEqual([{ home: "remote", ok: true }]);
    // A remote book is its own destination; there is nothing to look up.
    expect(remoteFor).not.toHaveBeenCalled();
  });

  // An unreadable pairing does not lose the export: the book still has its
  // device home, and the writer still gets the file.
  it("keeps the device home when the pairing cannot be read", async () => {
    const local = home("local", "device");
    providers.set("local", local);
    remoteFor.mockRejectedValue(new Error("idb closed"));

    expect(await sink(local).sink.save("a.pdf", BYTES, PDF)).toEqual([
      { home: "device", ok: true },
    ]);
  });

  it("skips a pairing whose remote is not registered in this build", async () => {
    const local = home("local", "device");
    providers.set("local", local);
    remoteFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });

    expect(await sink(local).sink.save("a.pdf", BYTES, PDF)).toEqual([
      { home: "device", ok: true },
    ]);
  });

  // For a backend this build does not register, the provider the book was
  // read through is the only home.
  it("falls back to the reader's provider when the registry has none", async () => {
    const demo = home("memory", "device");
    remoteFor.mockResolvedValue(null);
    const at = { ...ref, providerId: "memory" };

    expect(await sink(demo, at).sink.save("a.pdf", BYTES, PDF)).toEqual([
      { home: "device", ok: true },
    ]);
    expect(demo.writeBytes).toHaveBeenCalled();
  });

  it("asks for the homes and their folders once, however many questions follow", async () => {
    const local = home("local", "device", { holds: ["a.pdf"] });
    providers.set("local", local);
    remoteFor.mockResolvedValue(null);
    const { sink: s } = sink(local);

    await s.exists("a.pdf");
    await s.exists("a (2).pdf");
    await s.save("a (2).pdf", BYTES, PDF);
    expect(remoteFor).toHaveBeenCalledTimes(1);
    expect(local.listDir).toHaveBeenCalledTimes(1);
  });
});

describe("exists — is the name taken", () => {
  function paired(
    device: Parameters<typeof home>[2],
    remote: Parameters<typeof home>[2],
  ) {
    const local = home("local", "device", device);
    providers.set("local", local);
    providers.set("drive", home("drive", "remote", remote));
    remoteFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });
    return sink(local).sink;
  }

  it("is taken when any one home already holds the file", async () => {
    expect(await paired({}, { holds: ["a.pdf"] }).exists("a.pdf")).toBe(true);
    expect(await paired({ holds: ["a.pdf"] }, {}).exists("a.pdf")).toBe(true);
  });

  it("is free when no home holds it", async () => {
    expect(await paired({}, { holds: ["b.pdf"] }).exists("a.pdf")).toBe(false);
  });

  // A Windows or macOS disk opens `Book.pdf` for `book.pdf`, so the check
  // ignores case, or a second export would truncate the first.
  it("is taken under any letter case", async () => {
    expect(await paired({ holds: ["Book.pdf"] }, {}).exists("book.pdf")).toBe(
      true,
    );
    expect(await paired({}, { holds: ["book.PDF"] }).exists("BOOK.pdf")).toBe(
      true,
    );
  });

  // An offline remote cannot say the name is taken. Reading its silence as a
  // collision would push every offline export to `name (2)`, `name (3)`, …
  // for a file that exists nowhere, so the homes that can answer decide the
  // name, and `save` never writes to the silent one.
  it("decides the name by the homes that can answer", async () => {
    expect(await paired({}, { listFails: true }).exists("a.pdf")).toBe(false);
    // …and still hears a home that can.
    expect(
      await paired({ listFails: true }, { holds: ["a.pdf"] }).exists("a.pdf"),
    ).toBe(true);
  });
});

describe("save — one report per home", () => {
  // A home that could not say what its folder holds may already hold this
  // name, so writing there could overwrite. It is skipped and reported,
  // never written.
  it("never writes into a home that could not say what it holds", async () => {
    const local = home("local", "device");
    const drive = home("drive", "remote", { listFails: true });
    providers.set("local", local);
    providers.set("drive", drive);
    remoteFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });

    expect(await sink(local).sink.save("a.pdf", BYTES, PDF)).toEqual([
      { home: "device", ok: true },
      { home: "remote", ok: false },
    ]);
    expect(drive.writeBytes).not.toHaveBeenCalled();
  });

  it("reports a home that failed without stopping the others", async () => {
    const local = home("local", "device");
    providers.set("local", local);
    providers.set("drive", home("drive", "remote", { writeFails: true }));
    remoteFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });

    expect(await sink(local).sink.save("a.pdf", BYTES, PDF)).toEqual([
      { home: "device", ok: true },
      { home: "remote", ok: false },
    ]);
  });

  // `writeBytes` is optional on the port, and its absence means the backend
  // cannot hold a binary. The home is reported, not skipped in silence, so
  // the toast tells the writer where the file did not land.
  it("reports a home whose provider cannot write bytes as failed", async () => {
    const local = home("local", "device");
    const textOnly = { ...home("drive", "remote"), writeBytes: undefined };
    providers.set("local", local);
    providers.set("drive", textOnly as unknown as StorageProvider);
    remoteFor.mockResolvedValue({ providerId: "drive", key: "folder-1" });

    expect(await sink(local).sink.save("a.pdf", BYTES, PDF)).toEqual([
      { home: "device", ok: true },
      { home: "remote", ok: false },
    ]);
  });
});

describe("download", () => {
  it("hands the name, the bytes and the type to the browser", () => {
    const local = home("local", "device");
    const { sink: s, download } = sink(local);
    s.download("once-dark.epub", BYTES, "application/epub+zip");
    expect(download).toHaveBeenCalledWith(
      "once-dark.epub",
      BYTES,
      "application/epub+zip",
    );
  });
});

// The last check before a path is built. The window sanitises what the
// writer types; this refuses anything that could still leave `export/`: a
// separator of either platform, or a leading dot (`..`, and the hidden files
// the listings never show).
describe("a file name that could leave export/", () => {
  const unsafe = ["", "../a.pdf", "a/b.pdf", "a\\b.pdf", ".hidden.pdf", ".."];

  it.each(unsafe)("is refused everywhere: %j", async (name) => {
    const local = home("local", "device");
    providers.set("local", local);
    remoteFor.mockResolvedValue(null);
    const { sink: s, download } = sink(local);

    await expect(s.exists(name)).rejects.toThrow("export-file-name");
    await expect(s.save(name, BYTES, PDF)).rejects.toThrow("export-file-name");
    expect(() => s.download(name, BYTES, PDF)).toThrow("export-file-name");
    expect(local.exists).not.toHaveBeenCalled();
    expect(local.writeBytes).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("lets an ordinary name with spaces and dots through", async () => {
    const local = home("local", "device");
    providers.set("local", local);
    remoteFor.mockResolvedValue(null);
    await sink(local).sink.save("Once Dark (2).v1.pdf", BYTES, PDF);
    expect(local.writeBytes).toHaveBeenCalledWith(
      ref,
      "/export/Once Dark (2).v1.pdf",
      BYTES,
      PDF,
    );
  });
});
