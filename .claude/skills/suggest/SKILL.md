---
name: suggest
description: Suggest how to make a change in this project, from its docs, its code and outside best practice. Ask the questions that change the design. Use before any change larger than a small fix, or when a contributor asks how to do something.
argument-hint: "[the change or requirement]"
disallowed-tools: Edit, Write, NotebookEdit
---

# Suggest an approach

This skill only reads. Do not edit, create or delete a file in the repository.
The approach goes in the chat or in the plan file of the tool. After the build,
write only the documentation lines that the approach names.

The developer decides. Give one recommendation and its costs. Do not give a
survey of every option.

## 1. Ground the request

Read only the parts that apply to the request:

- the sections of `CONTRIBUTING.md` that apply, found by heading (do not read
  the whole file);
- the pattern in `docs/architecture.md` that the change touches;
- the section of `docs/internals.md` whose heading matches the area, if one
  matches;
- the words in `GLOSSARY.md`;
- the row of the feature in `docs/features.md`;
- the rows of `.claude/references/boundaries.md`, if the change crosses a
  trust boundary.

## 2. Find the precedent

Find how the code does the most similar thing today. Name one or two files.
The approach follows the precedent. If it does not, say why.

## 3. Look outside

Search the web for how others solve the same problem. Prefer the platform
documentation and the standards first (MDN, W3C, WHATWG, the Go
documentation). Then prefer maintained projects of a similar kind. Keep what is
better than the precedent, and name the source with its link. If a page
refuses the fetch, use the search result and mark the source "search only".
Skip this step only for a small fix.

## 4. Ask

Ask four questions or fewer, in one round. Ask only the questions whose
answers change the design. If nothing is unclear, ask nothing. Wait for the
answers before you go to step 5.

## 5. Suggest

Write one approach in 40 lines or fewer:

- where the change goes (files and modules);
- the boundary, port or format that it touches;
- the gates that apply (`CONTRIBUTING.md`, "Tests and gates");
- the documentation lines that change, which are as few as possible;
- what not to do.

Give each design choice three lines. The gates, the documentation lines and
"what not to do" need no lines of their own.

- **Buys:** what the point gives the writer or the code.
- **Why:** why this choice and not the precedent or the alternative.
- **Downside:** what it costs or what it makes harder.

If a serious alternative exists, give it the same three lines and state which
one you prefer.

## 6. Offer the challenge

Some approaches cross a trust boundary, add or change a port, or change the
on-disk format or a written rule. For such an approach, ask the developer once:

> Run a fresh-context challenge of this approach? It costs one extra agent.

If the answer is no, stop. If the answer is yes, run the challenge as
`.claude/references/delegation.md` describes. Give it only the approach, the
paths of the rules from step 1 and the precedent files. Ask it to return five
objections or fewer, ranked by importance.

Each objection has an evidence
pointer (a rule, a doc section or a file) and a simpler alternative, if one
exists. Do not run a second round. Report the objections unchanged and stop.

## 7. Hand over

- For the maintainer, the approach is the plan.
- For a contributor, the approach is the body of the issue that
  `CONTRIBUTING.md` asks for before a larger change.
