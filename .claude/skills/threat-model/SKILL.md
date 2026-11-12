---
name: threat-model
description: Threat-model a seam, a feature or a path of this project. Use its real trust boundaries and assets, with evidence from the code. Use only when the developer asks for a threat model.
argument-hint: "[seam, feature or path]"
disable-model-invocation: true
---

# Threat-model a part of the project

The trust boundaries, the assets and the existing controls are in
`.claude/references/boundaries.md`. Read it first. Do not restate a control
that a doc already states. Link to it.

## 1. Scope

1. Name the scope from the argument: a seam, a feature or a path.
2. Keep the runtime code in scope. Put tests, CI and examples out of scope,
   unless the argument names them.
3. Read the rows of `boundaries.md` that the scope touches.
4. Read the code of each entry point in those rows.

## 2. Model

1. List the assets in scope and where each one lives.
2. List the entry points, as file and symbol.
3. List what an attacker can do and what an attacker cannot do. Start from
   `SECURITY.md`, which states what is out of scope.
4. List the abuse paths: the steps from an entry point to an asset.
5. Give each abuse path a likelihood (low, medium, high) and an impact on the
   writer (low, medium, high).

## 3. Confirm

Before you write the final text, give the developer the list of assumptions.
Include the deployment, who can reach each entry point and how sensitive each
asset is. Ask the developer to correct them. Wait for the answer.

## 4. Controls

For each abuse path, list:

- the existing controls, each with an evidence anchor (file and symbol, or a
  link to the doc section);
- the recommended controls, if any, each with what it buys and what it costs.

Keep existing and recommended controls apart.

## 5. Write

1. Write the model in the form of `CONTRIBUTING.md`, "Writing
   documentation".
2. Ask the developer where to put it. If `harness/notes/` exists, offer
   `harness/notes/threat-model-<scope>.md`. Do not put a threat model in
   `docs/` or in any other tracked folder. The public docs do not hold threat
   models.
3. If the model changes a trust boundary, propose the one-line change to
   `docs/architecture.md`, "Security posture", and to `boundaries.md`.

End with the abuse paths ranked by likelihood times impact, one line each.
