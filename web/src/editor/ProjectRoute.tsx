// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// `/app/project/:projectId`: a signed-in writer's project, found by its id in
// the account's library and opened where it lives, with the account's
// services (`services/account.ts`). The editor itself comes through the
// barrel, so its stylesheet loads with it.

import { useMemo } from "react";
import { Navigate, useParams } from "react-router";
import { EditorSkeleton } from "../ui";
import { useAuth } from "../auth/AuthContext";
import { providerFor } from "../project/sync/resolve";
import { EditorScreen } from ".";
import { EditorServicesProvider } from "./services/context";
import { accountServices } from "./services/account";
import { useProjectRef } from "./useProjectRef";
import { useProjectStore } from "./useProjectStore";

export default function ProjectRoute() {
  const { projectId } = useParams();
  const { user } = useAuth();

  // The URL names a book, not a place, so the first question is which place.
  // `undefined` while the mirror is consulted, and pulled if cold; `null`
  // when this account has no project by that id.
  const ref = useProjectRef(projectId, user?.id);

  // The project's destination, resolved once before anything is decorated,
  // and the working copy that follows from it. `undefined` while the
  // lookup is in flight; `null` when this project has no remote.
  const store = useProjectStore(ref?.providerId, ref?.key, projectId);

  // Memoized so a project keeps one provider identity across re-renders:
  // `ProjectContext`'s effects key off it, and a fresh `mirror()` object each
  // render would look like the project changing.
  const provider = useMemo(
    () =>
      ref && projectId && store !== undefined
        ? providerFor(ref, { store, projectId })
        : null,
    [ref, store, projectId],
  );

  if (!user) return <Navigate to="/app" replace />;
  // Held at the skeleton, as the open pipeline holds, rather than redirected:
  // not looked up yet is a moment, not a missing project.
  if (ref === undefined) return <EditorSkeleton />;
  // An id no project of this account carries. The writer lands on the shelf,
  // where their books are, and it says what happened to the link.
  //
  // Checked before the store's hold. With no ref there is no
  // destination to look up, so `useProjectStore` stays `undefined`, and a
  // dead link would hold at the skeleton for the rest of the session.
  if (ref === null)
    return <Navigate to="/app" replace state={{ unknownProject: true }} />;
  // The destination has not been looked up yet: the same hold.
  if (store === undefined) return <EditorSkeleton />;
  if (!provider) return <Navigate to="/app" replace />;

  // Keyed by the project, never by the provider object: another project gets
  // a fresh editor, engine and provider, while a rebuilt provider for the same
  // project keeps the open buffers.
  return (
    <EditorServicesProvider value={accountServices}>
      <EditorScreen
        key={`${ref.providerId}/${ref.key}`}
        provider={provider}
        projectKey={ref.key}
      />
    </EditorServicesProvider>
  );
}
