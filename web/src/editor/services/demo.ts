// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getI18n } from "react-i18next";
import {
  DEMO_MODEL,
  DemoModelProvider,
  type DemoModelCopy,
} from "../../ai/adapters/demo";
import { inertServices } from "./context";
import type { AssistantWiring, EditorFace, EditorServices } from "./port";

/** The demo model's words, read per answer so a language switch lands on the next one. */
function demoModelCopy(): DemoModelCopy {
  const i18n = getI18n();
  return {
    replies: [1, 2, 3, 4, 5].map((n) => i18n.t(`dock.demoModel.reply${n}`)),
    disclaimer: i18n.t("dock.demoModel.disclaimer"),
  };
}

// Every chat starts on the static demo model and nothing else answers: no
// device model, no remote provider, no key and no search.
const demoWiring: AssistantWiring = {
  createModel: () => new DemoModelProvider(demoModelCopy),
  defaultModel: DEMO_MODEL,
};

/** What a program that has accounts lends the demo route. */
export interface DemoHost {
  /** The signed-in writer's face; the demo acts for no account either way. */
  useFace?(): EditorFace | null;
  /** The sign-out's hold on unsaved work, so a sign-out writes the buffer. */
  holdOpenWork?(write: () => Promise<unknown>): () => void;
}

/**
 * The demo editor's services: the way back leads home, the Assistant answers
 * from the demo model, and the in-memory project has no queue and no
 * connection to restore.
 */
export function demoEditorServices(host: DemoHost = {}): EditorServices {
  return {
    ...inertServices,
    exit: "landing",
    useFace: host.useFace ?? inertServices.useFace,
    useAssistantWiring: () => demoWiring,
    holdOpenWork: host.holdOpenWork ?? inertServices.holdOpenWork,
  };
}
