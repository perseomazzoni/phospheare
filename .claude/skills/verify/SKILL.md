---
name: verify
description: Choose and run the gates that apply to a change, and report each result with its evidence label. Use before you report a change as done.
argument-hint: "[working | branch <base> | commit <sha> | pr <number>] [area]"
context: fork
---

# Verify a change

If the host has no `context: fork`, run this skill as
`.claude/references/delegation.md` describes. The gate output then stays out
of the main context.

## 1. Collect the change

Collect the change as `.claude/references/change-inventory.md` describes.

## 2. Choose the gates

Read the table in `CONTRIBUTING.md`, "Tests and gates". Pick the rows that the
changed files match. Use these commands:

| Change | Commands |
| --- | --- |
| Documentation | Check each link, path and command (the `tech-docs` skill). |
| Web code | `npm --prefix web test -- <each affected test file>`, then `npm --prefix web run lint` and `npm --prefix web run build`. |
| Formatting (any web file) | `npm --prefix web run format:check` |
| Layout, themes, browser behaviour | `npm --prefix web run test:e2e -- --project=desktop <spec>`; for phone layouts, add `--project=pixel-7` and `--project=iphone-14-pro` with the `*.mobile.spec.ts` specs. |
| Go code | In each changed module (`identity/`, `desktop/`): `gofmt -l .` (no output), `go vet ./...`, `go test -race ./...`. |
| Tools or workflows | `node --test tools/*.test.mjs` |
| New source file | `npm run headers:check` |
| New dependency | `npm run licenses:check` and `npm run audit:lockfiles` |
| A broad change | The full list under "Tests and gates" in `CONTRIBUTING.md`. |

To run one test by name, add `-t "<name>"` to Vitest or `-g "<title>"` to
Playwright.

## 3. Run them

- On Windows, the tools' tests need Git Bash first on `PATH`. From
  PowerShell: `$env:PATH = "C:\Program Files\Git\bin;$env:PATH"`.
- If `go` is not installed, run the Go checks in the `golang:1.26` image as
  `CONTRIBUTING.md` shows.
- A stale Vitest cache can hide a new file in a folder that
  `import.meta.glob` reads. If a new file is not found, run
  `npx vitest --clearCache` in `web/`.
- If a Playwright screenshot comparison fails, compare the old and the new
  image before you change a baseline. Decide which one is correct, and say so.
  If `harness/tools/diffbox.mjs` exists, run it on the failure folders to box
  the pixels that differ.

## 4. Report

Start with the inventory line. Then give one line for each gate:

```
<command> → passed | failed | not run — <evidence label> — <note>
```

The evidence labels are in `CONTRIBUTING.md`, "Tests and gates". For each gate
that did not run, say why and give the smallest step that would run it. For a
failure, give the first error and the file and line. Do not fix a failure in
this skill.
