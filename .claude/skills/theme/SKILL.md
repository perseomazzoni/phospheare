---
name: theme
description: Change a theme or add a new one. Follow the token contract and the rule that a theme sheet only paints. Use for any change under web/src/theme or to the look of a control.
argument-hint: "[theme] [what changes]"
---

# Change or add a theme

The rules are in `CONTRIBUTING.md`: "A theme hides nothing", "A feature's
layout lives beside it" and the theme sheets under "Reviews and merging". Also
read `docs/architecture.md`, "Patterns".

## Where things are

- `web/src/theme/domain/tokens.ts`: `THEME_TOKENS`, the contract. Every theme
  states every token.
- `web/src/theme/domain/family.ts`: `defineFamily`. It throws when a contract
  token is missing or blank.
- `web/src/theme/index.ts`: registers each family. The first one is the
  default.
- `web/src/theme/themes/<family>/`: `palette.ts` (a light and a dark set),
  `roles.ts` (derived tokens), `theme.css` (the paint) and `index.ts`.
- `web/src/theme/themes/shared.css`: the paint that all themes share. A theme
  sheet restates a shared rule only where the theme departs.
- `web/src/theme/themes/sheets.test.ts`: a theme sheet paints. It never sizes,
  places, hides or moves. `PLACED` lists the few selectors that a theme may
  place.

## Change a theme

1. Decide where the change goes. Layout goes beside the feature or in
   `editor.css`. Paint common to all themes goes in `shared.css`. Paint of one
   theme goes in its `theme.css`.
2. Use the tokens of the contract. Declare a new token in the contract only if
   code outside the sheet reads it.

## Add a theme

1. Create `web/src/theme/themes/<family>/palette.ts` with `palette(scheme)` for
   `light` and `dark`.
2. Create `roles.ts` and `theme.css` (paint only).
3. Create `index.ts` with `defineFamily({ ... })`. State every contract token
   across the palette and the shared values, and set `frame` and
   `decorations`.
4. Import it and call `registerFamily` in `web/src/theme/index.ts`. The
   settings picker reads the registry, so no other list changes.
5. If the sheet must place a selector, add it to `PLACED[<family>]` in
   `sheets.test.ts`, and say why in the pull request.
6. Copy the shape of the Playwright specs of an existing theme
   (`web/e2e/radiant-*.spec.ts`, `web/e2e/vision-*.spec.ts`) for the new one.

## Verify

1. Run the theme tests: `npm --prefix web test -- src/theme` (contract,
   contrast for both variants, sheets, registry).
2. If you moved rules out of `editor.css`, run the order check from the
   repository root. List the sheets in the order that
   `web/src/editor/frame.css` imports them:

   ```bash
   node tools/check-css-order.mjs --before HEAD:web/src/editor/editor.css --after web/src/editor/editor.css <feature sheet>
   ```

   The check can miss a change on an element with two classes. Compare the
   computed styles in the browser too (the `browser-check` skill).
3. Run `npm --prefix web run test:e2e -- --project=desktop e2e/theme-system.spec.ts`
   and the specs of the theme.
4. Check both schemes and a phone width in the browser.
