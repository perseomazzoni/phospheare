// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The `Platform` port: the one part of the environment the editor chrome
// needs, whether the modifiers are Mac's and how to label them. Injected
// rather than imported so a test or another host can answer differently.
//
// Contract, for every adapter:
//
//   1. The labels derive from the OS branch: mod is ⌘ on Mac, Ctrl elsewhere;
//      ctrl, shift and alt label accordingly.
//   2. Answers are stable: repeated calls agree with the first.
//   3. In an environment with no navigator, the platform is non-Mac.

export interface Platform {
  isMac(): boolean;
  modLabel(): string;
  ctrlLabel(): string;
  shiftLabel(): string;
  altLabel(): string;
}
