---
name: ai-prompt
description: Add or change an assistant prompt file: a slash command, a persona, a genre, a craft lens, a reference template or an obsession. The file must pass the loaders and appear in both languages. Use for any change under web/src/ai/domain.
argument-hint: "[kind] [name]"
---

# Add or change an assistant prompt

Prompt files are Markdown in `web/src/ai/domain/`. Each loader reads its folder
when the module loads and throws on a bad file. A bad file therefore fails the
build and the first test that imports it. `docs/ai.md` and the AI part of
`docs/architecture.md` explain the layers. Read the loader of the kind before
you write a file.

All front matter uses flat `key: value` lines (`frontmatter.ts`). A duplicate
key or an empty body throws.

## Kinds

| Kind | Files | Loader | Must have |
| --- | --- | --- | --- |
| Slash command | `skills/<NN>-<name>.md` | `skills.ts` | `guide.en.what`, `.when`, `.how` and the same three for `it`. The body is English only. |
| Persona | `personas/<NN>-<name>[.default].md` and a `.png` | `personas.ts` | `name`, `description`, `color` (`#rrggbb`), `compatibleWith` and one `preset.<id>` for each compatible chat. Exactly one file is `.default`. |
| Genre | `genres/<kebab>.md` | `genres.ts` | `title`, then exactly `## Promise`, `## Conventions`, `## Pitfalls`. |
| Craft lens | `craft/<kebab>.md` | `craft.ts` | `title`. The file name is the id that an obsession names in `lens`. |
| Reference template | `references/*.md` | `referenceCatalogue.ts` | `page` and `name`. A `group.*` line ends `English | Italiano`. A `block.*` line is `entity | English | Italiano`. A `field.*` line is `role[, flags] | container | English | Italiano`. A `note.*` line is English only. |
| Obsession | `obsessions.md` | `obsessions.ts` | `notices`, `asks`, `severity` (craft, clarity or contract). |

## Add a slash command

1. Create `skills/<NN>-<name>.md`. The number sets the order in the registry
   (numeric order). The command is the name without the number.
2. Write the guide in English and in Italian. Use the `ui-text` skill for the
   guide text.
3. If the command is a workflow, add its `WORKFLOWS` entry and its case in
   `actionOf`.
4. Add `dock.commandNote.<command>` to `en.json` and `it.json`. A command that
   takes text also needs `dock.<command>.hint` and
   `dock.<command>.hintDescription`. A question also needs
   `dock.<command>.hintQuoteDescription`.
5. Update the ordered command list that `skills.test.ts` pins.
6. Add the command to the list in `docs/features.md`, "AI assistant".

## Add a persona preset

Add `dock.preset.<id>.name` and `dock.preset.<id>.hint` to
`web/src/locales/en.json` and `it.json`. `locales.test.ts` checks them.

## Add a genre

Add the id to `GENRE_IDS` in `web/src/project/genres.ts`. Add
`genre.name.<id>` to `en.json` and `it.json`.
`editor/assistant/projectFacts.test.ts` checks that the two lists match.

## Verify

1. Run the test of the loader in the table:
   `npm --prefix web test -- src/ai/domain/<loader>.test.ts`.
2. If a new file is not found, see the Vitest cache note in the `verify`
   skill.
3. Run `npm --prefix web test -- src/locales/locales.test.ts` if you added
   locale keys.
4. The live evaluation runners in `web/scripts/` (`fact-eval.mjs`,
   `grouping-eval.mjs`, `layers-eval.mjs`) give evidence, not a gate. They read the key from `PHOSPHEARE_OPENROUTER_KEY`. Run them on
   more than one model, and judge the totals, not one case. `plant-eval.mjs`
   plants defects in a copy of a project and scores the reviews. It calls no
   model.
