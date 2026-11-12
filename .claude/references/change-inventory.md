# Change inventory: collect the whole change

A review that sees only part of a change gives a false result. `git diff`
alone omits staged changes, untracked files and committed work. Collect the
change in one of the modes below before any review starts.

## Modes

**working** (the default when the skill gets no argument):

1. Run `git status --porcelain=v1 -uall` to get the inventory.
2. Run `git diff HEAD` to get the tracked changes, staged and unstaged
   together.
3. Read the full content of every untracked file. New files are often the
   largest part of a change.

**branch `<base>`** (for work that is committed on a branch):

1. Run `git diff <base>...HEAD` to get the committed changes.
2. Also run the working mode, so that uncommitted work is not missed.
3. In the report, say which files come from commits and which come from the
   working tree.

**commit `<sha>`** (for one past commit):

1. Run `git show --stat <sha>` to get the inventory.
2. Run `git show <sha>` to get the diff. Do not add the working mode.

**pr `<number>`** (for a pull request on GitHub):

1. Run `gh pr diff <number> --name-only` to get the inventory. Do not use
   `gh pr view --json files`, which lists 100 paths at most.
2. Run `gh pr diff <number>` to get the diff.
3. If the pull request branch is checked out, also run the working mode.

## Exclusions

- Skip `package-lock.json`, `dist/`, `coverage/` and generated images in the
  review. Count them in the inventory.
- If the developer names a path as out of scope, leave it out and say so.
- Git does not show a path that `.gitignore` or `.git/info/exclude` hides. If
  the change touches such a path (for example `harness/`), list its files from
  the disk and mark them "not tracked".

## First lines of the report

Start the report with the inventory. In the working and branch modes:

```
Inventory (<mode>): <n> committed, <n> staged, <n> unstaged, <n> untracked
<path> (<state>)
...
```

In the commit and pr modes, write `Inventory (<mode>): <n> files, <base>..<head>`
and then the paths.

If the inventory has more than 20 paths, give one line per folder with its
count. A folder is the first two parts of the path, or the first three under
`web/src/`. List each path only in a folder that the review comments on.

If the inventory is empty, stop and report "Nothing to review". Do not review
an empty change.
