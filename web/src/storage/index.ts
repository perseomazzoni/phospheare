// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef, StorageProvider } from "./types";
import { localProvider } from "./localProvider";
import { driveProvider } from "./driveProvider";
import { memoryProvider } from "./memoryProvider";

// The provider registry. Adding a backend means writing one file and
// registering it here; nothing else in the app changes.
//
// It is lookup only, with no `allProviders()` to iterate: every screen that
// offers a choice names its providers directly, because each gets its own
// copy, affordances and empty state.
//
// Connections are the one exception: `useConnections()` iterates the
// providers' connection objects, because connection rows share one anatomy.

const providers = new Map<string, StorageProvider>();

export function register(provider: StorageProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): StorageProvider | null {
  return providers.get(id) ?? null;
}

/**
 * Whether this ref names a project on a network backend. Ask this, never
 * `providerId === driveProvider.id`, which only agrees while Drive is the one
 * remote. An unknown provider reads as not remote: this build cannot
 * reach a backend it does not have.
 */
export function isRemoteRef(ref: Pick<ProjectRef, "providerId">): boolean {
  return getProvider(ref.providerId)?.kind === "remote";
}

register(localProvider);
register(driveProvider);
register(memoryProvider);

export * from "./types";
export { localProvider, driveProvider, memoryProvider };
export { listLocalProjects, createLocalProject } from "./localProvider";
export {
  createDriveProject,
  listDriveProjects,
  renameDriveProject,
} from "./driveProvider";
export { projectsFolderId } from "./driveLayout";
export { forgetDriveToken } from "./driveToken";
export {
  connectionFor,
  useConnections,
  type Connections,
  type ConnectionState,
  type ConnectionVerbs,
  type DisconnectOptions,
  type ProviderConnection,
  type ReconnectOutcome,
} from "./connections";
export {
  dropDriveConnection,
  revokeDriveGrant,
  useDriveConnection,
} from "./useDriveConnection";
