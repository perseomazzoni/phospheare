---
name: security-check
description: Review a change for security against the trust boundaries, controls and scanners of this project. Report numbered findings by their impact on the writer. Use when a change crosses a trust boundary, or before a release.
argument-hint: "[working | branch <base> | commit <sha> | pr <number>]"
context: fork
---

# Check a change for security

If the host has no `context: fork`, run this skill as
`.claude/references/delegation.md` describes.

## 1. Collect and map

1. Collect the change as `.claude/references/change-inventory.md` describes.
2. Read `.claude/references/boundaries.md`. Map each changed file to the rows
   that it touches. If no row applies, say so and check only the general
   points in step 2.
3. Read the doc sections that the matching rows link to.

## 2. Check

Apply the checks of each matching row. Then check these general points:

- **TypeScript and React:** a new fetch target and its `connect-src` entry; any
  HTML sink outside `trustedHtml.ts`; a parser without a size cap; a new
  browser storage key that spells a product name or holds a credential; a
  secret or a writer's text in a URL, a log or an error message.
- **Go:** input bounds and `MaxBytesReader`; the cross-site guard and the Host
  check on a new route; cookie attributes; timeouts; a secret, a token or an
  email in a log; a data race (`go test -race`).
- **Dependencies:** a new package, its licence and its advisories.

## 3. Run the scanners

Run the local scanners that `boundaries.md` lists and that are installed. Say
which ran and which did not, and why. actionlint, zizmor and CodeQL run in CI
only.

The scanners read the files on disk. If the target is a past commit, say that
the scan describes the checked-out tree. Name the files that differ.

## 4. Report

Number each finding. Set its severity by the impact on the writer: critical,
high, medium or low. Order the findings by kind:

- **security:** someone can read, change or destroy what is not theirs;
- **resilience:** a failure or a hostile input costs the writer work or a
  writer session;
- **correctness:** the code does not do what its contract says;
- **hygiene:** nothing fails today, but a later change can make it fail.

A problem that the change did not cause, in code that the change rewrote, is
in scope. Mark it "pre-existing".

Give each finding:

- the file and line;
- the failure path in one or two sentences: who or what causes it, and what
  the writer loses;
- the existing control that should have stopped it, with its doc link;
- the fix, in one or two lines.

End every report with the rows and the scanners that you checked. Zero
findings is a valid result. Report it as "No findings".

Do not fix anything in this skill. After the report, offer to fix the
findings one at a time. Fix only after the developer says yes.

Claude Code also has a built-in `/security-review`. It is generic. Use it as a
second pass, not as a replacement for this skill.
