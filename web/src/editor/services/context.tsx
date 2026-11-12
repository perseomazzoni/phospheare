// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { createContext, useContext } from "react";
import type { EditorServices } from "./port";

const NOTHING: ReadonlySet<string> = new Set();

/**
 * The services of an editor mounted with none: no face, no Assistant, no
 * account work to hold and an empty queue. The test harnesses render the
 * workspace this way; every route supplies its own.
 */
export const inertServices: EditorServices = {
  exit: "library",
  useFace: () => null,
  useAssistantWiring: () => null,
  useRemoteProviders: () => undefined,
  holdOpenWork: () => () => undefined,
  connectionFor: () => null,
  usePendingPaths: () => NOTHING,
  useLostPaths: () => NOTHING,
  readStale: () => false,
  forgetLostAt: async () => undefined,
  pullUnfinished: async () => false,
};

const EditorServicesContext = createContext<EditorServices>(inertServices);

/** Supplies the editor's services; a route passes one object for its life. */
export const EditorServicesProvider = EditorServicesContext.Provider;

/** The services the mounting route supplied. */
export function useEditorServices(): EditorServices {
  return useContext(EditorServicesContext);
}
