// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { StorageError } from "../../../storage/types";
import {
  defaultProperties,
  serializeProperties,
} from "../../../project/properties";
import { pairingFor } from "../../../project/sync/pairing";
import { getManifest } from "../../../project/sync/manifestStore";
import { sha256Hex } from "../../../text/hash";
import type { SyncCheckResult } from "../../../project/sync/check";
import {
  copyCancelled,
  copyOk,
  copyProjectMock,
  createDriveProject,
  driveProviderFake,
  driveRef,
  localProviderFake,
  localRef,
  projectIdFor,
  readFileLocal,
  ref,
  renderAction,
  resetShelfFakes,
  shelfDoubles,
  tearDownShelf,
  writeFileLocal,
} from "./shelfActions.fixture";
import { useProjectSync } from "./useProjectSync";

vi.mock(
  "react-i18next",
  async () => (await import("./shelfActions.fixture")).mocks.i18n,
);
vi.mock(
  "../../../storage",
  async () => (await import("./shelfActions.fixture")).mocks.storage,
);
vi.mock(
  "../../../project/transfer",
  async () => (await import("./shelfActions.fixture")).mocks.transfer,
);
vi.mock(
  "../../../project/projectId",
  async () => (await import("./shelfActions.fixture")).mocks.projectId,
);

function renderActions() {
  const doubles = shelfDoubles();
  const hook = renderAction(({ failure, copyJob }) =>
    useProjectSync({
      checkNow: doubles.api.checkNow,
      markSynced: doubles.api.markSynced,
      revalidate: doubles.api.revalidate,
      unpair: doubles.api.unpair,
      toasts: doubles.toasts,
      failure,
      copyJob,
    }),
  );
  return { hook, ...doubles };
}

beforeEach(resetShelfFakes);
afterEach(tearDownShelf);

describe("start", () => {
  it("pairs only once the copy is proven, then writes the recovery hint", async () => {
    createDriveProject.mockResolvedValue(driveRef);
    copyProjectMock.mockResolvedValue(copyOk);
    readFileLocal.mockResolvedValue(
      serializeProperties(defaultProperties("Project")),
    );
    const { hook, api, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.start(localRef);
    });

    expect(await pairingFor("book-l1")).toEqual({
      providerId: "drive",
      key: "d1",
    });
    expect(api.markSynced).toHaveBeenCalledWith("book-l1");
    expect(writeFileLocal).toHaveBeenCalledWith(
      localRef,
      "/document-properties.json",
      expect.stringContaining("remote"),
    );
    expect(toasts.post).toHaveBeenCalledWith("library.syncStarted");
  });

  it("starts the manifest from the bytes the copy sent, so the first edit pushes as usual", async () => {
    // An empty manifest would leave the first edit's push facing a remote
    // file with no baseline, which the queue stops as an edit made elsewhere.
    const sourceRef = ref("local", "l3", "Third Project");
    const structure = "version: 1\n";
    const digest = await sha256Hex(structure);
    createDriveProject.mockResolvedValue(ref("drive", "d3"));
    copyProjectMock.mockImplementation(
      async (
        _from: unknown,
        _to: unknown,
        opts: { onCopied?: (path: string, content: string) => void },
      ) => {
        opts.onCopied?.("/document-structure.yaml", structure);
        return copyOk;
      },
    );
    readFileLocal.mockResolvedValue(
      serializeProperties(defaultProperties("Project")),
    );
    const localFingerprint = localProviderFake.fingerprintFile;
    const driveFingerprint = driveProviderFake.fingerprintFile;
    localProviderFake.fingerprintFile = async () => ({ hash: digest });
    driveProviderFake.fingerprintFile = async () => ({ hash: digest });
    try {
      const { hook } = renderActions();
      await act(async () => {
        await hook.result.current.start(sourceRef);
      });
    } finally {
      localProviderFake.fingerprintFile = localFingerprint;
      driveProviderFake.fingerprintFile = driveFingerprint;
    }

    const manifest = await getManifest("book-l3");
    expect(manifest?.remote).toEqual({ providerId: "drive", key: "d3" });
    expect(manifest?.files["/document-structure.yaml"]).toMatchObject({
      local: digest,
      remote: digest,
    });
  });

  it("a copy whose book left the shelf mid-flight is honest: copy landed, nothing paired, no hint", async () => {
    // The flow started from the card, so a null mirror answer means the row
    // was removed on another device while the copy ran. The Drive copy stays,
    // but pairing it would sync a book absent from the shelf, the recovery
    // hint would claim a pairing that does not exist, and "sync started"
    // would be false.
    //
    // A distinct key: `openDb()` memoizes its connection module-wide, as
    // `idb.test.ts` pins, so a pairing made by an earlier row in this file's
    // shared fake database does not leak into this one.
    const sourceRef = ref("local", "l2", "Another Project");
    createDriveProject.mockResolvedValue(driveRef);
    copyProjectMock.mockResolvedValue(copyOk);
    projectIdFor.mockReturnValue(null);
    const { hook, api, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.start(sourceRef);
    });

    expect(toasts.post).toHaveBeenCalledWith("library.syncRowLost");
    expect(toasts.post).not.toHaveBeenCalledWith("library.syncStarted");
    expect(await pairingFor("book-l2")).toBeNull();
    expect(api.markSynced).not.toHaveBeenCalled();
    // The recovery hint was not written into the local properties.
    const hintWrites = writeFileLocal.mock.calls.filter(
      ([, path]) => path === "/document-properties.json",
    );
    expect(hintWrites).toHaveLength(0);
  });

  it("a cancelled copy posts the honest toast and pairs nothing", async () => {
    // A distinct key: `openDb()` memoizes its connection module-wide, so the
    // pairing made by an earlier row lives on in this file's shared fake
    // database, and `l2` is untouched by it.
    const sourceRef = ref("local", "l2", "Another Project");
    createDriveProject.mockResolvedValue(driveRef);
    copyProjectMock.mockResolvedValue(copyCancelled);
    const { hook, api, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.start(sourceRef);
    });

    expect(toasts.post).toHaveBeenCalledWith("library.copyCancelled");
    expect(api.markSynced).not.toHaveBeenCalled();
    expect(await pairingFor("l2")).toBeNull();
  });
});

describe("syncNow", () => {
  const result = (
    verdict: Partial<SyncCheckResult["verdict"]>,
  ): SyncCheckResult => ({
    remoteTarget: { providerId: "drive", key: "d1" },
    verdict: { conflict: false, toPull: [], toPush: [], files: [], ...verdict },
    localStats: null,
    remoteStats: null,
  });

  it("says what was pulled when there was something to pull", async () => {
    const { hook, api, toasts } = renderActions();
    api.checkNow.mockResolvedValue(result({ toPull: ["/a.md"] }));

    await act(async () => {
      await hook.result.current.syncNow(localRef);
    });
    expect(toasts.post).toHaveBeenCalledWith("sync.pulled");
  });

  it("says up to date when there is nothing to do", async () => {
    const { hook, api, toasts } = renderActions();
    api.checkNow.mockResolvedValue(result({}));

    await act(async () => {
      await hook.result.current.syncNow(localRef);
    });
    expect(toasts.post).toHaveBeenCalledWith("sync.upToDate");
  });

  it("says another device is still uploading when the remote is half there", async () => {
    const { hook, api, toasts } = renderActions();
    api.checkNow.mockResolvedValue({
      ...result({ toPull: ["/document/a.md"] }),
      uploading: true,
    });

    await act(async () => {
      await hook.result.current.syncNow(localRef);
    });
    expect(toasts.post).toHaveBeenCalledWith("sync.stillUploading");
  });

  it("stays quiet on a conflict — the banner is already carrying it", async () => {
    const { hook, api, toasts } = renderActions();
    api.checkNow.mockResolvedValue(result({ conflict: true }));

    await act(async () => {
      await hook.result.current.syncNow(localRef);
    });
    expect(toasts.post).not.toHaveBeenCalled();
  });

  it("surfaces a real failure", async () => {
    const { hook, api, toasts } = renderActions();
    api.checkNow.mockRejectedValue(
      new StorageError("drive down", "unavailable"),
    );

    await act(async () => {
      await hook.result.current.syncNow(localRef);
    });
    expect(toasts.post).not.toHaveBeenCalled();
    expect(hook.result.current.shelfError).toBe("storage.unreachable");
  });
});

describe("unpair", () => {
  it("unpairs with a word of confirmation", async () => {
    const { hook, api, toasts } = renderActions();

    await act(async () => {
      await hook.result.current.unpair(localRef);
    });
    expect(api.unpair).toHaveBeenCalledWith(localRef);
    expect(toasts.post).toHaveBeenCalledWith("library.unpaired");
  });
});

describe("uploadAgain", () => {
  it("drops the old pairing first, then uploads again, holding the key while it runs", async () => {
    const { hook, api } = renderActions();
    createDriveProject.mockResolvedValue(driveRef);
    copyProjectMock.mockResolvedValue(copyCancelled);
    let release = () => {};
    api.unpair.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    let job: Promise<void> = Promise.resolve();
    act(() => {
      job = hook.result.current.uploadAgain("p1", localRef);
    });
    expect(hook.result.current.uploadingAgain).toBe("p1");
    expect(createDriveProject).not.toHaveBeenCalled();

    await act(async () => {
      release();
      await job;
    });
    expect(hook.result.current.uploadingAgain).toBeNull();
    expect(api.unpair).toHaveBeenCalledWith(localRef);
    expect(api.unpair.mock.invocationCallOrder[0]).toBeLessThan(
      createDriveProject.mock.invocationCallOrder[0],
    );
  });

  it("says so when the old pairing cannot be dropped, and uploads nothing", async () => {
    const { hook, api, toasts } = renderActions();
    api.unpair.mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await hook.result.current.uploadAgain("p1", localRef);
    });
    expect(toasts.post).toHaveBeenCalledWith("sync.uploadAgainFailed");
    expect(createDriveProject).not.toHaveBeenCalled();
    expect(hook.result.current.uploadingAgain).toBeNull();
  });
});
