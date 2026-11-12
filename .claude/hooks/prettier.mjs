#!/usr/bin/env node
// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Formats a file under web/ with Prettier after Claude Code edits it.
//
// Runs as a PostToolUse hook on Edit and Write (see .claude/settings.json). It
// reads the hook event as JSON on stdin and never blocks the edit: every path
// ends with exit code 0, because a formatting failure must not undo a change.
// The format gate in CI (`npm --prefix web run format:check`) still catches
// what this hook misses.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const FORMATTED = /\.(ts|tsx|js|mjs|css|json|md)$/;

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input.replace(/^﻿/, ""));
    const file = event?.tool_input?.file_path;
    const root = process.env.CLAUDE_PROJECT_DIR ?? event?.cwd ?? process.cwd();
    if (typeof file !== "string" || !FORMATTED.test(file)) return;
    const web = resolve(root, "web");
    const inWeb = relative(web, resolve(file));
    // A path on another drive comes back absolute, not with "..".
    if (isAbsolute(inWeb) || inWeb.startsWith("..")) return;
    if (inWeb.split(sep)[0] === "node_modules") return;
    // Prettier's own script runs through Node with an argument array. No
    // shell reads the path, so `%VAR%` or `$VAR` in a file name stays text.
    const require = createRequire(join(web, "package.json"));
    const manifest = require.resolve("prettier/package.json");
    const bin = join(dirname(manifest), require(manifest).bin);
    const args = [bin, "--write", "--log-level", "warn", "--", inWeb];
    spawnSync(process.execPath, args, {
      cwd: web,
      stdio: "ignore",
      timeout: 30_000,
    });
  } catch {
    // A malformed event or a missing Prettier leaves the file as written.
  }
});
