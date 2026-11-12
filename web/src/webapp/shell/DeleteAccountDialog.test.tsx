// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DeleteAccountDialog from "./DeleteAccountDialog";
import type { DeleteAccountFlow } from "./useDeleteAccount";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => cleanup());

// The reason for a deletion that stopped says what already happened: a step
// after Remote Storage was emptied never claims nothing changed.

function dialog(over: Partial<DeleteAccountFlow> = {}) {
  const flow: DeleteAccountFlow = {
    confirming: true,
    busy: false,
    failure: null,
    remoteCleared: false,
    request: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
    ...over,
  };
  render(
    <DeleteAccountDialog
      flow={flow}
      remoteConnected={false}
      remoteCopiesKept={false}
    />,
  );
}

const reason = () => screen.getByRole("alert").textContent;

describe("DeleteAccountDialog failures", () => {
  it.each([
    ["open-work", false, "settings.deleteAccountFailed"],
    ["remote", false, "settings.deleteAccountRemoteFailed"],
    ["revoke", false, "settings.deleteAccountRevokeFailed"],
    ["local", false, "settings.deleteAccountFailed"],
    ["local", true, "settings.deleteAccountLocalFailed"],
  ] as const)(
    "names what happened when %s stopped (Remote Storage cleared: %s)",
    (failure, remoteCleared, copy) => {
      dialog({ failure, remoteCleared });
      expect(reason()).toBe(copy);
    },
  );
});
