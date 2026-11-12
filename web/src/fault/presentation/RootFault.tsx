// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Component, type ReactNode } from "react";
import { faults } from "../compose";
import FaultScreen from "./FaultScreen";

interface State {
  failed: boolean;
  error: unknown;
}

/**
 * The last boundary, around everything the route tree's boundary cannot
 * cover: the auth provider, the router itself and the notice column. Without
 * it a failure there unmounts the whole tree and leaves a blank page.
 *
 * Its page offers a reload and the home page only. The router and the session
 * are gone at this depth, so it cannot know who is here or route anywhere,
 * and it never reloads by itself.
 */
export default class RootFault extends Component<
  { children: ReactNode },
  State
> {
  state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <FaultScreen
        fault={faults.read(this.state.error)}
        home="landing"
        onReload={faults.reload}
      />
    );
  }
}
