---
name: rules-review
description: Review a change or a pull request against the architecture and the written rules of this project. Each finding offers two options, align the change or change the rule in the same pull request. Never blocks. Use before a pull request is opened or when one arrives.
argument-hint: "[working | branch <base> | commit <sha> | pr <number>]"
disallowed-tools: Edit, Write, NotebookEdit
context: fork
---

# Review a change against the rules

This skill only reads. Do not edit a file. It reports. The developer chooses
what to do with each finding, and the maintainer decides in review.

If the host has no `context: fork`, run this skill as
`.claude/references/delegation.md` describes.

## 1. Collect the change

Collect the change as `.claude/references/change-inventory.md` describes. Use
the mode that the argument names. With no argument, use the working mode.

For a merged pull request or a past commit, judge the change against the
rules on disk. Mark a finding whose rule is newer than the change "rule newer
than the change". Option A then names the follow-up fix.

## 2. Read the rules that apply

Read only the rules that the changed areas touch:

- `CONTRIBUTING.md`: "Rules the gates cannot fully check", "Writing
  documentation", "Code comments", "The product name" and "Pull request
  titles";
- `docs/architecture.md`: the patterns and the boundary rules of the Go
  modules;
- `docs/internals.md`: the contracts of the areas that the change touches;
- `GLOSSARY.md`: the words and the words to avoid;
- `.claude/references/boundaries.md`: the rows that the change crosses;
- `.github/PULL_REQUEST_TEMPLATE.md`: what it asks the author to state under
  "Review notes".

## 3. Report

Report ten findings or fewer. One rule that the change breaks in several places
is one finding, with each place listed. Rank the hard rules first.
Then rank the rules that change what the writer sees or keeps, then the rules
for code and docs. Zero findings is a valid result. Report it as "No findings".

Give each finding four parts:

1. **Rule:** the rule, quoted, with a link to its section.
2. **Change:** what the change does, with file and line.
3. **Option A, align the change:** the fix, in one or two lines.
4. **Option B, change the rule:** the one-line edit to the doc section, made
   in the same pull request. Add one sentence for "Review notes" in the pull
   request that says why the rule moves.

Do not prefer A or B, except for a hard rule. The hard rules are the product
name, no migrations, the licence of a dependency, the licence header and no
secret in a log or a URL. For a hard rule, say that option B needs the
maintainer.

End the report with one line: the number of findings, and the files that you
did not review and why.
