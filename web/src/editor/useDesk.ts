// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The Desk's reading, as a hook. The Desk shows what the writer last wrote by
// reading a file that is not open. Pulling it into the engine would open it
// and mark it dirty, and the writer would arrive to an editor claiming unsaved
// work.

import { useEffect, useState } from "react";
import { lastParagraph, openThread, resumeSources } from "./desk";
import type { OpenThread } from "./desk";
import { filePath } from "../project/naming";
import type { DocumentProperties, DocumentStructure } from "../project/types";
import type { ProjectRef, StorageProvider } from "../storage/types";
import type { Paragraph } from "./engine";

export function useDesk(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
  structure: DocumentStructure | null,
  props: DocumentProperties | null,
  activeFile: string | null,
) {
  const [state, setState] = useState<{
    resume: { fileName: string; para: Paragraph } | null;
    thread: OpenThread | null;
  }>({ resume: null, thread: null });

  useEffect(() => {
    // Nothing to read while a file is open: the Desk is not on screen, and the
    // read would run on every keystroke's re-render.
    if (activeFile || !projectRef || !structure) return;
    const sources = resumeSources(props, structure);
    let live = true;
    void (async () => {
      for (const node of sources) {
        const file = node.adopted;
        let text: string;
        try {
          text = await provider.readFile(projectRef, filePath(file));
        } catch {
          // An unreadable candidate is skipped: a vanished file or a
          // hand-edited structure costs one candidate, never the whole Desk.
          continue;
        }
        if (!live) return;
        const last = lastParagraph(text);
        if (!last) continue;
        // The thread carries its file so the Desk names the Section it is in.
        const thread = openThread(text);
        setState({
          resume: { fileName: file, para: last },
          thread: thread ? { ...thread, fileName: file } : null,
        });
        return;
      }
      if (live) setState({ resume: null, thread: null });
    })();
    return () => {
      live = false;
    };
  }, [provider, projectRef, structure, props, activeFile]);

  return state;
}
