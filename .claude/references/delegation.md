# Delegation: run a step in a fresh context

Some skills run a step in a fresh context. A fresh context reads only the
inputs that the skill names. It does not see the conversation, so it does not
inherit the author's assumptions. This file tells you how to start that step on
each host.

## Inputs

Give the fresh context only these items:

- the inputs that the skill names, such as the plan text, the change inventory
  or the approach;
- the paths of the rules and docs that it must read;
- the format of the result that it must return.

Do not give it the conversation, your own conclusion or the result that you
expect. Write the inputs into the prompt. If the inputs are long, write them to
a temporary file outside the repository and give the path.

## Per host

| Host | How to start the fresh context |
| --- | --- |
| Claude Code | If the skill has `context: fork`, the whole skill already runs in a fresh context. Otherwise, use the `Agent` tool with the `general-purpose` agent. |
| OpenCode | Use the `subagent` tool with the `general` agent. A command stub with `subagent: true` runs the whole skill in a child session. |
| Codex | Use a subagent if the installed version has them (`/subagents`). Otherwise, run `codex exec` in a new session with the inputs file as the prompt. |

## When no fresh context is available

If the skill already runs in a fork or a subagent, it is isolated. Add no
line. Otherwise, run the step in the current context and start the report
with this line:

> Not isolated: this step ran in the same context as the work it checks.

The developer can then decide whether the result is good enough.

## Result

Return the result of the fresh context unchanged. Do not soften it, merge it
with your own view or fix what it reports. The developer decides what to do.
