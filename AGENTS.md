# AGENTS.md

This file gives directions to coding agents in this repository. Claude Code,
Codex and OpenCode read it. People read `CONTRIBUTING.md`. This file points to
it and repeats only what an agent needs in every session.

## What this is

Phospheare is a writing tool. It has three parts:

- `web/`: the single-page app, React and TypeScript.
- `desktop/`: the desktop program in Go. It serves the app and supervises the
  identity service.
- `identity/`: the identity service in Go. It handles Google sign-in and seals
  the credentials that it keeps into cookies.

Read these before you change code:

| For | Read |
| --- | --- |
| The rules, the gates and the repository map | `CONTRIBUTING.md` |
| The shape, the ports and the security posture | `docs/architecture.md` |
| The contracts that the code cannot state | `docs/internals.md` |
| The names of things | `GLOSSARY.md` |
| What the app does | `docs/features.md` |
| The AI providers and the key | `docs/ai.md` |

Read only the sections that apply to the task.

## How to work here

- For a change larger than a small fix, run the `suggest` skill. Then wait for
  the developer to approve the approach before you change code.
- Build one step at a time. Run the gates of that step. Stop for review.
- Do not commit, push, merge or open a pull request unless the developer asks.
  Leave the changes in the working tree for review.
- Put a fix on the branch in use. Do not make a new branch for it.
- A commit subject is one Conventional Commit line. See `CONTRIBUTING.md`,
  "Pull request titles". Add no AI attribution lines.
- If a change is right and a rule is what must change, edit the rule in the
  same pull request. Say why under "Review notes" in
  `.github/PULL_REQUEST_TEMPLATE.md`. The maintainer decides.
- Do not add a plan, a study, a decision record, a tracker ID, a phase number
  or the history of a change. See `CONTRIBUTING.md`, "Writing documentation".
- Check a visible change in a browser yourself. The demo editor at
  `/app/editor/demo` needs no writer account. Do not ask the developer to
  check for you.
- Report each check with its evidence label (`CONTRIBUTING.md`, "Tests and
  gates"). Say what passed, what failed and what did not run.

`CONTRIBUTING.md`, "Rules the gates cannot fully check", holds the rules that
cost most when an agent misses them. Three of them are no migrations, tests
that change with their behaviour and the product name.

## Words

- "Phospheare" is the working name. See `CONTRIBUTING.md`, "The product
  name".
- Interface text says "Remote Storage" and "Local Storage".
- Interface text is in English and Italian. Write it with the `ui-text` skill.
- Technical docs follow `CONTRIBUTING.md`, "Writing documentation".

## Commands

Run from the repository root.

```bash
npm ci
npm run dev                                            # the app on port 5173
npm run dev:wizard                                     # setup page, fake services
npm --prefix web test -- src/path/file.test.ts -t "name"
npm --prefix web run build                             # typecheck and build
npm --prefix web run lint
npm --prefix web run format:check
npm --prefix web run test:e2e -- --project=desktop
go -C identity test -race ./...
go -C desktop test -race ./...
```

The full list, the Go checks in Docker and the Windows notes are in
`CONTRIBUTING.md`, "Tests and gates".

## Environment

- The maintainer works on Windows with PowerShell.
- Node comes from `.nvmrc`. Go is 1.26, or the `golang:1.26` Docker image.
- In development, the identity service runs with `npm run dev:full`, or with
  `npm run dev:identity` beside `npm run dev`. It needs a Google client in
  `.env`. Without it, sign-in features are off. That is not a bug.

## Skills

The skills are in `.claude/skills/<name>/SKILL.md`. Claude Code and OpenCode
load them by name. In Codex, read the file when its row applies.

| Skill | Use when |
| --- | --- |
| `suggest` | You plan a change larger than a small fix. |
| `plan-check` | A planned change is built. It checks each point of the plan. |
| `rules-review` | A change or a pull request needs a check against the rules. |
| `verify` | You are about to report a change as done. |
| `browser-check` | A writer can see the change (Claude Code only). |
| `ui-text` | You add or change interface text. |
| `theme` | You change a theme or the look of a control. |
| `ai-prompt` | You add or change an assistant prompt file. |
| `tech-docs` | You write or revise technical documentation. |
| `threat-model` | The developer asks for a threat model. |
| `security-check` | A change crosses a trust boundary in `.claude/references/boundaries.md`. |

The usual order for a change:

1. `suggest` before the build.
2. `verify` after the build, then `plan-check` (offered) and `rules-review`.
3. `security-check` before you report done, if the change crosses a trust
   boundary.
