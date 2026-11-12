// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  Session,
  commonmarkCodec,
  DeltaTimeline,
  regexSearch,
  Emitter,
  htmlRenderer,
  browserClipboardCodec,
  type SessionEvents,
  type Codec,
  type HistoryStore,
  type SearchProvider,
  type EventBus,
  type Renderer,
  type ClipboardCodec,
  type Doc,
  type Paragraph,
} from "../engine";

export type NotificationReason = "doc" | "selection";

/**
 * The editor's composition root: the session with the production adapters
 * wired in, and the Renderer port for the view. The wiring lives here because
 * `engine/` imports nothing outside itself.
 */
export class EditorEngine extends Session {
  constructor(deps: EditorEngineDeps = {}) {
    super({
      codec: deps.codec ?? commonmarkCodec,
      // The snapshot oracle stays behind the same port for the differential
      // tests.
      history: deps.history ?? new DeltaTimeline(),
      search: deps.search ?? regexSearch,
      events: deps.events ?? new Emitter<SessionEvents>(),
      clipboard: deps.clipboard ?? browserClipboardCodec,
    });
    this.renderer = deps.renderer ?? htmlRenderer;
  }

  private readonly renderer: Renderer;

  get html(): string {
    // While a diff mode is up, the view renders the merged comparison; the
    // real doc stays in the session untouched.
    return this.renderer.render(this.displayedDoc);
  }

  /** Some paragraphs of the displayed doc, as the view draws them. */
  htmlOf(paragraphs: readonly Paragraph[]): string {
    return this.renderer.render(paragraphs as Doc);
  }
}

/** An omitted field defaults to the production adapter. */
export interface EditorEngineDeps {
  codec?: Codec;
  history?: HistoryStore;
  search?: SearchProvider;
  events?: EventBus<SessionEvents>;
  renderer?: Renderer;
  clipboard?: ClipboardCodec;
}
