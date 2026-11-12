---
name: plan-check
description: After a plan is built, ask the developer. Then have a fresh-context agent check every point of the plan against the code. Use when an implementation is reported done.
argument-hint: "[plan file, or \"the plan above\"]"
disallowed-tools: Edit, Write, NotebookEdit
---

# Check that the plan is built

This skill only reads. Do not edit, create or delete a file.

## 1. Collect the inputs

1. Get the plan text. It is the plan file that the argument names, the plan
   file of the tool or the approach from the `suggest` skill.
2. Collect the change as `.claude/references/change-inventory.md` describes.
   Use the working mode, or the branch mode if the work is committed.
3. If the plan or the inventory is empty, stop and say so.

## 2. Ask

Ask the developer once:

> Launch a fresh-context check of the plan against the code? It costs one
> extra agent.

If the answer is no, stop.

## 3. Run the check

Run the check as `.claude/references/delegation.md` describes. Give the fresh
context the path of the plan, the inventory, the mode and the paths out of
scope. It collects the diff and the untracked files itself. Do not
give it the conversation.

Give it this task:

> Read the code, not a summary of it. For each point of the plan, find the
> evidence in the change. Return one table:
>
> | Plan point | State | Evidence | Note |
>
> A plan point is each step and each sub-point that names a deliverable,
> and each check in the verification part. State is one of: done, partial,
> missing, deviates, not checkable (say why). Evidence is a file and line, or
> the test that proves the point. You may run read-only checks and tests to
> get evidence. After the table, list what the change does that the plan does
> not say.

## 4. Report

Report the table unchanged. Do not soften it and do not fix anything. Stop.
The developer decides what to do next.
