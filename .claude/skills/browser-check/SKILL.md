---
name: browser-check
description: Open the running app in the Claude Code browser pane and check a change that a writer can see. Check desktop and phone widths and both colour schemes. Use after a change to layout, text, themes or interaction.
argument-hint: "[route or screen]"
---

# Check a change in the browser

This skill uses the browser tools of the Claude Code desktop app. On another
host, use the Playwright specs instead (the `verify` skill).

## 1. Start the app

Start a server by name from `.claude/launch.json` with `preview_start`:

| Name | Serves | Build first |
| --- | --- | --- |
| `web` | the dev server on port 5173 | nothing |
| `web-e2e-build` | the end-to-end build on port 4180 | `npm --prefix web run build:e2e` |
| `web-build-preview` | the production build on port 4181 | `npm --prefix web run build` |
| `web-demo-preview` | the demo site on port 4182 | `npm --prefix web run build:demo` |

Use `web` unless the change concerns the build, the content security policy or
the demo site.

## 2. Open the screen

- The demo editor opens at `/app/editor/demo`. It needs no writer account and
  no folder. It holds a sample novel in memory.
- Google sign-in does not complete in the pane. Use the demo editor or the
  writer account without Google for everything else.
- The pane keeps its storage in memory. After about ten idle minutes, its
  origin-private file system loses the bytes of every file. If files are gone
  but folders remain, rebuild the fixture before you report a bug.

## 3. Check

1. Read the page with `read_page` or `get_page_text`. Confirm the text and the
   structure.
2. Do the interaction with `computer` or `form_input`. Read the page again.
3. Read `read_console_messages` and `read_network_requests` for errors.
4. Resize to the phone widths of the Playwright projects
   (`web/playwright.config.ts`): 375 × 667, 393 × 660 and 412 × 839. Check
   the phone layout.
5. Switch to the other colour scheme with `resize_window` and `colorScheme`.
6. Use `javascript_tool` only to read computed styles or state, never to
   change the page.
7. Reset the size with the `desktop` preset when you finish.

## 4. Report

Give one screenshot for each visible result, with a one-line caption. List
the console errors, or say that there are none. Say which widths and schemes
you checked.
