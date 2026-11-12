---
name: tech-docs
description: Write or revise technical documentation in the Simplified Technical English form of this project. Check every command, path and link against the code. Use for docs/, CONTRIBUTING.md, AGENTS.md, CLAUDE.md, the files under .claude/ and every README except the root one.
argument-hint: "[file]"
---

# Write technical documentation

If the file is the root `README.md`, stop. Say that this skill does not apply
to it. The root README speaks to writers first and keeps its own voice.

The rules are in `CONTRIBUTING.md`, "Writing documentation". Read them first.
This skill gives the procedure. `references/checklist.md` asks the rules as
yes or no questions.

## 1. Read before you write

1. Read the page and the pages that it links to. The same thing must keep the
   same name across them.
2. Read the code that the page describes. Every command, path, flag and claim
   must be true today.
3. Read `GLOSSARY.md` for the names of things.

## 2. Write

1. Write only what a reader needs to act or to avoid a mistake. Delete what
   the code or another doc already says, and link to it instead.
2. Put the result first, then the details.
3. Write steps as a numbered list and parallel items as a bulleted list.
4. Keep a change to a doc as small as the change to the code that it
   describes.

## 3. Check

1. Check the text against `references/checklist.md`. Fix each "no".
2. Open each link. Confirm that each linked heading exists.
3. Confirm that each path exists.
4. Run each command that is fast and safe (help, list, a single test file, a
   check). Do not run a build, an end-to-end suite or a command that writes,
   deletes, publishes or signs in. Report those as not run.
5. If a check fails because of a local file that git ignores, say so. That is
   not a fault of the page.

## 4. Report

Report what changed, in one line per file. Then list each command, link or
claim that you could not verify, and say why.
