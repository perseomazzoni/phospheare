// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pins the writing surface's chosen durations and colours in the stylesheet
// text, because jsdom does not run CSS. `styles/reducedMotion.test.ts` covers
// whether motion is quieted; these rows cover what the values are.

import { describe, expect, it } from "vitest";
import { EDITOR_CSS } from "./editorSheets.fixture";
import SHARED_PAINT_CSS from "../theme/themes/shared.css?raw";
import MATTE_OWN_CSS from "../theme/themes/matte/theme.css?raw";
import { NARROW_AT, PANEL_W, RAIL_GUTTER } from "./useNarrow";
import { DOCK_CELL, MIN_DOCK_W } from "./components/Dock";
import { FRAME_GEOMETRY } from "../theme/editor";
import { MARGIN_MIN_W } from "./comments/domain/limits";
import { CARD_MAX, INSET } from "./comments/presentation/Margin";

// Matte as the page wears it: the paint every theme shares, then its own,
// with no layer around either (`theme/themes/sharedPaint.ts`).
const MATTE_CSS = `${SHARED_PAINT_CSS}\n${MATTE_OWN_CSS}`;

// ── The plane's arithmetic ───────────────────────────────────────────────────
//
// `NARROW_AT` is the sum of the five widths that stand between the window's
// edges and the measure, so the width at which three columns stop fitting
// names itself. That holds only while the five numbers in `useNarrow.ts` are
// the five tokens in this stylesheet, and a token can be nudged 8px with no
// thought of a breakpoint. The constants are TypeScript and the tokens are
// CSS, so no compiler sees both.

/**
 * The stylesheet as one line, with its comments removed.
 *
 * Collapsing whitespace pins the rule rather than its wrapping, which
 * Prettier owns. Dropping comments does the same for prose: the stylesheet
 * comments inside declarations, and a pin that broke on every explanation
 * would train the next person to delete it.
 */
const FLAT = EDITOR_CSS.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");

/** Matte's sheet as one line: the paint the frame's rules are worn with. */
const MATTE_FLAT = MATTE_CSS.replace(/\/\*[\s\S]*?\*\//g, " ").replace(
  /\s+/g,
  " ",
);

/**
 * A rule as Matte wears it: the frame's block, which lays it out, then
 * Matte's block for the same selector, which paints it.
 */
function matteRule(rule: RegExp): string {
  return [rule.exec(FLAT)?.[0], rule.exec(MATTE_FLAT)?.[0]]
    .filter(Boolean)
    .join(" ");
}

/** The same, read from the stylesheets as written rather than as one line. */
function matteRuleRaw(rule: RegExp): string {
  return [EDITOR_CSS.match(rule)?.[0], MATTE_CSS.match(rule)?.[0]]
    .filter(Boolean)
    .join(" ");
}

describe("the plane's arithmetic matches the stylesheet's tokens", () => {
  /** The number a `--token: 123px;` declaration carries, found by name. */
  const token = (name: string): number => {
    const at = EDITOR_CSS.indexOf("--" + name + ":");
    if (at < 0) throw new Error("no --" + name + " in editor.css");
    const value = parseFloat(EDITOR_CSS.slice(at + name.length + 3, at + 64));
    if (Number.isNaN(value)) throw new Error("--" + name + " is not a length");
    return value;
  };

  it("derives the narrow plane from the tokens it names", () => {
    // The surface's right padding is a token, because the command bar
    // centres on the prose by the same arithmetic, so it is looked up
    // like the rest, and the surface is held to wearing it.
    expect(EDITOR_CSS).toContain(
      "padding: var(--text-top) var(--desk-right) 80px;",
    );
    expect(
      token("panel-left") +
        token("panel-w") +
        token("panel-gutter") +
        token("editor-width") +
        token("desk-right"),
    ).toBe(NARROW_AT);
  });

  // The page's sheet stands on the panel's own inset, and the bar's band at
  // its top is the seat and the bar, as the frame's geometry says.
  // The one place the measure gives way to something beside it: comments set
  // as notes are part of the page, so the text pays for their column, down
  // to a floor below which they go to their ‸ and the text keeps its measure.
  it("narrows the text for the notes' column, between 480 and the measure", () => {
    const { gap, column } = FRAME_GEOMETRY.notes;
    const flat = FLAT.replace(/\s+/g, "");
    expect(flat).toContain(
      `--notes-room:calc(var(--shift-room)-var(--dock-cover,0px)-${gap + column}px);`,
    );
    expect(token("editor-width")).toBe(FRAME_GEOMETRY.measure);
  });

  it("stands the sheet and the bar's band where the frame's geometry does", () => {
    expect(FLAT).toContain("--sheet-gap: var(--panel-left);");
    expect(FRAME_GEOMETRY.sheet.gap).toBe(token("panel-left"));
    expect(token("bar-seat")).toBe(FRAME_GEOMETRY.sheet.barSeat);
    expect(FLAT).toContain(
      `:root:is([data-under-bar="cut"], [data-under-bar="sheet"]) { --bar-seat: ${FRAME_GEOMETRY.sheet.cutSeat}px; }`,
    );
    expect(token("bar-h")).toBe(FRAME_GEOMETRY.sheet.bar);
  });

  // The rail's width is not in this stylesheet: `EditorRoute` emits
  // `--panel-w` inline for every state, and an inline custom property beats a
  // rule. A `--panel-w` in the rail block would be overridden silently, the
  // panel looking right and the token stating a wrong width.
  it("leaves the rail's width to the shell, and keeps the token as the default", () => {
    // Against the constant, never a literal: a third copy of 248 here would
    // itself be the drift these rows guard against.
    expect(token("panel-w")).toBe(PANEL_W);
  });

  it("gives the dock's arithmetic the stylesheet's one gutter, folded or open", () => {
    // `dockRoom` reserves a folded panel at the rail's gutter; a
    // gutter that differed from the stylesheet's would cap the dock and
    // place its detent a few pixels from where the prose is.
    expect(token("panel-gutter")).toBe(RAIL_GUTTER);
  });

  // The dock's floor and the dock's token are the same number written twice,
  // in two languages no compiler reads together: the constant is TypeScript,
  // the fallback is CSS.
  it("opens the dock at its floor, under the track's design width", () => {
    expect(token("dock-w")).toBe(MIN_DOCK_W);

    // The head does not fit at its design size and is not meant to: the tabs
    // compress and the close does not. Everything the head spends before
    // them, at the floor:
    const spent =
      2 + // the dock's own border, a hair under 1px a side
      20 + // `.dock-head`'s 10px of side padding
      8 + // `.dock-head`'s one gap, between the track and the close
      19 + // `.dock-close`, which never shrinks
      4; // the seated track's own 2px trough, a side
    // The track's design width is the ceiling, never the floor.
    expect(DOCK_CELL).toBeGreaterThan((MIN_DOCK_W - spent) / 4);
  });

  // ── The phone plane, in the stylesheet ─────────────────────────────────────
  //
  // A test browser has no retracting URL bar, so `vh` and `dvh` measure the
  // same there, and the prose's margin is a token the panel shares. Both are
  // held in the stylesheet's text.

  it("measures the feed in dvh, so a retracted URL bar is not the promise", () => {
    // `vh` on a phone is the tallest the viewport ever gets, so a `vh` feed
    // is short of the room it promises for most of a session.
    expect(EDITOR_CSS).toContain("min-height: calc(100dvh - var(--text-top))");
    expect(EDITOR_CSS).not.toContain("100vh");
  });
});

describe("the writing surface rules (fixes.md #7, #14, #13)", () => {
  it("fades typed characters in on the fade-in’s own token", () => {
    // The wrap mechanism lives in `EditorCore` and is pinned by the view
    // contract; this rule makes it visible. It is the one animation in the
    // writing column that stays visible, so it has a token of its own
    // (`--t-char-fade`, 300ms) rather than the generic settle, at whose
    // duration the effect reads as gone.
    const rule = matteRuleRaw(/\.char-fade-in\s*\{[^}]*\}/);
    expect(rule).toMatch(
      /animation:\s*charFadeIn\s+var\(--t-char-fade\)\s+forwards/,
    );
    expect(rule).not.toMatch(/--t-tap/);
    // The keyframes exist too: a bare duration with no `@keyframes` animates
    // nothing.
    expect(EDITOR_CSS).toMatch(
      /@keyframes\s+charFadeIn\s*\{[^}]*from[^}]*opacity:\s*0[^}]*\}/,
    );
  });

  it("draws the caret in the theme primary colour", () => {
    const rule = matteRuleRaw(/\.fake-cursor\s*\{[^}]*\}/);
    expect(rule).toMatch(/background:\s*var\(--accent\)/);
  });

  it("blinks the caret with the original pulse once movement stops", () => {
    // The pulse is solid for 40% of a 2s ease-in-out cycle, gone by 78%, and
    // back for the next.
    const rule = matteRuleRaw(/\.fake-cursor\.blinking\s*\{[^}]*\}/);
    expect(rule).toMatch(
      /animation:\s*fakeCaret\s+2s\s+ease-in-out\s+infinite/,
    );
    // The keyframes use their own nested braces, so `[^}]*` cannot span them;
    // the pulse's two landmarks are asserted directly in the stylesheet.
    expect(EDITOR_CSS).toMatch(
      /@keyframes\s+fakeCaret\s*\{\s*0%\s*\{\s*opacity:\s*1/,
    );
    expect(EDITOR_CSS).toMatch(/40%\s*\{\s*opacity:\s*1;/);
    expect(EDITOR_CSS).toMatch(/78%\s*\{\s*opacity:\s*0;/);
  });

  it("springs the caret ahead with the bounce token on a typed character", () => {
    // The core sets `.caret-bounce` for the length of one spring each time a
    // character lands; the class turns the caret's `left` change into the
    // bounce. It uses the overshoot token, because a caret that eased forward
    // would lag behind.
    const rule = matteRuleRaw(/\.fake-cursor\.caret-bounce\s*\{[^}]*\}/);
    expect(rule).toMatch(/transition:\s*left\s+var\(--t-bounce\)/);
  });

  it("opens no fold on bare :hover, only on the latch or focus", () => {
    // A fold widening on `:hover` overflows the bar, folds the save chip,
    // slides out from under the pointer and shuts, every frame.
    expect(EDITOR_CSS).not.toMatch(/\.ed-fold[a-z-]*:hover/);
  });

  it("draws a scrolling bar's scrollbar thin", () => {
    // The first `.bar-stack .ui-bar` rule sets the bar's own tokens; this is
    // the second, the scrollport rule that carries `overflow-x`.
    const rule = matteRuleRaw(
      /\.bar-stack\s*\.ui-bar\s*\{[^}]*overflow-x[^}]*\}/,
    );
    expect(rule).toMatch(/scrollbar-width:\s*thin/);
  });

  it("leaves the tight save chip its glyph, and quiets only the clean state", () => {
    // What is left when the word goes is the glyph, drawn on every plane
    // rather than swapped in here. A shared `::after` dot would make "still
    // typing", "on its way out" and "did not land" one ember circle on the
    // plane with no word beside it. The tight form leaves the glyph
    // alone and quiets only the state with nothing to report.
    expect(EDITOR_CSS).not.toMatch(/\.ed-save::after/);
    expect(EDITOR_CSS).toMatch(
      /\.bar-stack\s*\.ui-bar\[data-save-tight="1"\]\s*\.ed-save\[data-state="clean"\]\s*\{\s*opacity:\s*0\.28/,
    );
  });

  it("spins the pushing glyph, which is the stylesheet's one deliberate loop", () => {
    // Nothing loops except a real wait, and this is that exception: the words
    // are written here and on their way somewhere else. Static means pending
    // and spinning means transferring now, and the chip's word is "Pushing to
    // remote", the second.
    expect(EDITOR_CSS).toMatch(/@keyframes\s+edPush/);
    expect(EDITOR_CSS).toMatch(
      /animation:\s*edPush\s+1\.8s\s+linear\s+infinite/,
    );
    // The other loops are the caret's blink, a platform convention rather
    // than a wait, and those listed below. The chrome's register is
    // stillness, and a loop is the loudest thing a stylesheet can do, so a
    // new one fails here until it is listed.
    const loops = [
      ...EDITOR_CSS.matchAll(/animation:\s*([\w-]+)[^;]*infinite/g),
    ];
    //
    // Stop's rainbow edge and its counterclockwise spark run only while the
    // writer waits on an answer, a real wait like `edPush`'s; the spark's
    // flicker rides the same declaration as the spark.
    //
    // The Ask tab's spark steps through Stop's rainbow while a chat answers
    // and the writer is elsewhere: the same wait, seen from another face of
    // the dock.
    expect(loops.map((m) => m[1]).sort()).toEqual([
      "aiSparkRainbow",
      "aiStopRainbow",
      "aiStopSpark",
      "edPush",
      "fakeCaret",
      "fakeCaret",
    ]);
  });

  // ── Where the bar stands ───────────────────────────────────────────────────
  //
  // One clamped `translate` on the stack: the prose's centre at rest, the pin
  // while engaged, never past the panel's left edge and never past the
  // window. No measured state re-centres the bar on the window when
  // it outgrows the desk.
  const stackRule = () =>
    matteRuleRaw(/\n\.bar-stack\s*\{[^}]*translate:[^}]*\}/);

  it("makes the bar's row the container its `cqw` resolves against", () => {
    // The row spans the window, so a `cqw` that fell back to the viewport
    // would measure the same in a test and differ only where it matters.
    const row = matteRuleRaw(/\n\.bar-row\s*\{[^}]*\}/);
    expect(row).toMatch(/container-type:\s*inline-size/);
  });

  // ── Where the measure stands ───────────────────────────────────────────────
  //
  // With comments to show, the measure moves to make room for a card column.
  // The column's widths are the numbers `Margin` places the cards with,
  // written again in CSS, so each is read against its constant.
  const ruleFor = (selector: string) => {
    const at = FLAT.indexOf(`} ${selector} {`) + 2;
    return at < 2 ? "" : FLAT.slice(at, FLAT.indexOf("}", at) + 1);
  };
  const flat = (text: string) => text.replace(/\s+/g, "");

  // The comment brought forward, the one with its actions open, wears the
  // accent on its hair, so it can be found at once.
  it("draws the comment brought forward on the active card's hair", () => {
    expect(FLAT).toContain(
      '.cm-card[data-active="1"] { border-style: solid; }',
    );
    expect(MATTE_FLAT).toContain(
      '.cm-card[data-active="1"] { border-color: var(--card-active); }',
    );
    // Solid on a ghost too, whose dashed edge would otherwise win.
    expect(FLAT).toContain(
      '.cm-card[data-state="proposed"][data-active="1"] { border-style: solid; }',
    );
  });

  it("sizes the card column the measure moves for by the margin's constants", () => {
    const margin = flat(
      ruleFor('.editor-shell[data-margin="1"]:not([data-narrow="1"])'),
    );
    // A card's least width with its inset either side, the least room the
    // margin draws cards in, and a card at its widest after its inset.
    expect(margin).toContain(`--margin-need:${MARGIN_MIN_W + 2 * INSET}px;`);
    expect(margin).toContain(`--margin-least:${MARGIN_MIN_W}px;`);
    expect(margin).toContain(`--margin-column:${INSET + CARD_MAX}px;`);
  });

  it("eases the Desk and the measure as they move", () => {
    expect(FLAT).toMatch(
      /\.editor, \.desk \{ translate: [^;]+; transition: translate var\(--t\); \}/,
    );
  });

  it("eases the bar home", () => {
    expect(stackRule()).toMatch(/transition:\s*translate var\(--t\)/);
  });

  it("keeps the prose's centre where the bar's arithmetic puts it, scrolling or not", () => {
    // The bar's target is window arithmetic, and the prose's centre is the
    // surface's content box, which a trailing scrollbar would narrow at one
    // end only. Symmetric, always-reserved gutters keep the two the same.
    const surface = matteRuleRaw(/\n\.editor-surface\s*\{[^}]*\}/);
    expect(surface).toMatch(/scrollbar-gutter:\s*stable both-edges/);
  });
});

// The head has no add command; the labels under the tree take its place, so
// no head seat aligns with the row menus. The row's own `.dt-more`
// box keeps its 24px width, pinned by the actions tests.

describe("the structure panel's face swap", () => {
  it("keeps the panel's find a token override rather than a second control", () => {
    // No sigil block, no morph width, no killed native cancel button here:
    // `base.css` owns all of it. What is left is the four numbers that make
    // it this panel's.
    expect(FLAT).not.toContain(".dt-find-sigil");
    expect(FLAT).not.toContain(".dt-find input::-webkit-search-cancel-button");
    const block = matteRuleRaw(/\.dt-find\s*\{[^}]*\}/);
    // The field does not size itself: it fills the row, so the row's
    // `flex-grow` is the only thing animating and the box cannot finish
    // collapsing before the shape finishes sliding, as a percentage of a row
    // shrinking on the same clock would.
    expect(block).not.toContain("--bar-find-w:");
    expect(block).toContain("flex: 1 1 0");
    // Both states, because the base rules size the open one at one class
    // plus one pseudo-class, and either half left alone keeps the base
    // sizing.
    expect(block).toContain("width: auto");
    expect(FLAT).toContain(
      '.dt-find:focus-within, .dt-find[data-query="1"] { width: auto; }',
    );
  });
});

// ── The assistant surface ────────────────────────────────────────────────────
//
// These rows check that the stylesheet says what the markup expects. They
// guard the three hand-enumerated blocks at the end of `editor.css`: the
// coarse-pointer floors, the 720px two-size scale, and the reduced-motion
// quiet list. Each names its classes by hand, so a class removed from the
// markup lives on in them silently.
describe("the assistant surface's rules", () => {
  it("sets the waiting line in the machine's face", () => {
    const line = matteRule(/\.ai-activity \{[^}]*\}/);
    // Mono, at the size the quote and the turn's facts are read at: this is a
    // fact about the machine, not the answer beginning.
    expect(line).toContain("font-family: var(--f-meta)");
    expect(line).toContain("color: var(--ink-3)");
  });

  it("gives the live line's clock its gap only after words", () => {
    // The clock's gap from the words exists only where there are words:
    // without them it would stack on the row's own gap and leave a
    // word-shaped hole.
    const clock = matteRule(/\.ai-elapsed \{[^}]*\}/);
    expect(clock).not.toContain("margin-inline-start");
    expect(FLAT).toMatch(
      /\.ai-activity-label \+ \.ai-elapsed \{[^}]*margin-inline-start: 6px/,
    );
  });

  it("shows a question's row on a touch screen by the app's one keeper", () => {
    // `(hover: none)` is the condition the rest of the app reveals hover
    // controls by, so a question's row follows it rather than the pointer's
    // size.
    expect(FLAT).toMatch(
      /@media \(hover: none\) \{ \.msg-you-actions \{ opacity: 1; \} \}/,
    );
    expect(FLAT).not.toMatch(
      /@media \(pointer: coarse\) \{ \.msg-you-actions \{/,
    );
    expect(FLAT).not.toContain(".msg-you .ai-turn-meta");
  });

  it("draws a citation as the prose's own words, not a chip", () => {
    const cite = matteRule(/\.ai-cite \{[^}]*\}/);
    expect(cite).toContain("font-size: inherit");
    expect(cite).toContain("font-family: inherit");
    expect(cite).toContain("color: var(--ink)");
    expect(cite).toContain("background: none");
    expect(cite).toContain("box-shadow: inset 0 -1px 0 var(--hair-firm)");
    expect(MATTE_FLAT).toMatch(/\.ai-cite:focus-visible \{[^}]*--focus-ring/);
  });

  it("keeps the reference reader's own heading sizes", () => {
    // The chat sizes an answer's headings in its own rules, not by changing
    // the shared class.
    const shared = matteRule(/\.dock-read h1 \{[^}]*\}/);
    expect(shared).toContain("font-size: 15px");
  });

  it("separates only an answer's list items", () => {
    // In a reference template the items are a form's fields and the gaps
    // come from the question rule, so the separation is chat-scoped.
    // The lookbehind, because the scoped rule contains the unscoped selector
    // as a substring; this asserts there is no second, unscoped one.
    expect(FLAT).not.toMatch(/(?<!\.msg-assistant )\.dock-read li \+ li \{/);
  });

  it("sends the two buttons that decide HOW to the end of the bar", () => {
    // `margin-inline-start: auto` on the end group rather than
    // `justify-content` on the bar: the group keeps the trailing end whatever
    // the bar holds before it, and the logical side follows a right-to-left
    // writer.
    const end = matteRule(/\.ai-chatbar-end \{[^}]*\}/);
    expect(end).toContain("margin-inline-start: auto");
    expect(end).not.toContain("margin-left: auto");
    const bar = matteRule(/\.ai-chatbar \{[^}]*\}/);
    expect(bar).not.toContain("justify-content");
    expect(MATTE_FLAT).toContain(".ai-model-button:focus-visible");
  });

  it("paints the asking stack in the theme's frost", () => {
    // The bare rule, not a compound selector that ends in `.ai-asking`.
    const asking = matteRule(/\} \.ai-asking \{[^}]*\}/);
    // The theme's frost and the glass's edge, tinted with the sunk paper at
    // 84% so the field on it reads as raised: tokens, never literals.
    expect(asking).toContain(
      "background: color-mix(in srgb, var(--paper-sunk) 84%, transparent)",
    );
    expect(asking).toContain("box-shadow: var(--glass-edge)");
    expect(asking).toContain("backdrop-filter: var(--frost)");
  });

  it("fades the transcript's head, and clears the stack before it is measured", () => {
    const messages = matteRule(/\.ai-messages \{[^}]*\}/);
    // The head end fades rather than shearing a line in half. A mask on the
    // scroller, not an overlay: an overlay needs a solid colour to fade from,
    // and this panel sits on `--paper` on one side of the dock's glass and
    // `--paper-raised` on the other. Both spellings, because the unprefixed
    // property is not everywhere.
    expect(messages).toContain(
      "mask-image: linear-gradient(to bottom, transparent 0, #000 18px)",
    );
    expect(messages).toContain("-webkit-mask-image");
    // A resting fallback, because the property is written by a
    // `ResizeObserver` the panel guards for jsdom, and first paint happens
    // before it runs.
    expect(messages).toContain("--ai-asking-h, 96px");
  });

  it("draws an answer's quotation in the book's face and the prose's ink", () => {
    // A quoted passage is the writer's words, so it wears the page's ink and
    // weight; the reference reader's slate aside would make it read as the
    // assistant's.
    const quote = matteRule(/\.msg-assistant \.dock-read blockquote \{[^}]*\}/);
    expect(quote).toContain("font-family: var(--f-prose)");
    expect(quote).toContain("color: var(--prose-ink)");
    expect(quote).toContain("font-weight: var(--matte-prose-weight)");
  });

  it("raises the writer's field off the sunk tray, in the theme's own terms", () => {
    // `--field` is the page's colour, darker than the pane, and reads as
    // disabled here. The field is the raised paper with a card's edge and
    // lift, and keeps the lift under its focus ring. Tokens only, so every
    // theme gets the relation, not a white box.
    const field = matteRule(/\.composer \{[^}]*\}/);
    expect(field).toContain("background: var(--paper-raised)");
    expect(field).toContain("border-color: var(--hair-firm)");
    expect(field).toContain("box-shadow: var(--shadow-card)");
    expect(field).not.toContain("var(--field)");
    const focused = matteRule(/\.composer:focus-within \{[^}]*\}/);
    expect(focused).toContain("var(--shadow-card)");
  });

  it("rounds the jump button with the theme's radius", () => {
    const jump = matteRule(/\.ai-jump \{[^}]*\}/);
    expect(jump).toContain("border-radius: var(--r-round)");
  });

  it("floors the jump button in BOTH axes under a thumb", () => {
    // In both the min-height and the min-width lists: a 28px circle floored
    // to 44px tall alone is a 28x44 capsule.
    const coarse = FLAT.slice(FLAT.indexOf("@media (pointer: coarse)"));
    /** Every selector list in the coarse block that sets this one property. */
    const flooring = (property: string) =>
      [...coarse.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
        .filter((rule) => (rule[2] ?? "").includes(property))
        .map((rule) => rule[1] ?? "")
        .join(" ");
    expect(flooring("min-height: var(--tap)")).toContain(".ai-jump");
    expect(flooring("min-width: var(--tap)")).toContain(".ai-jump");
  });

  it("sends a user bubble to the writer's side by the logical edge", () => {
    // The bare selector at a rule's start, so the touch rule's
    // `.msg.msg-you .msg-body` is not read as this one.
    const bubble = matteRule(/(?:^|\} )\.msg-you \.msg-body \{[^}]*\}/);
    // The logical property, not `margin-left`: the editor's own text
    // direction decides which edge is the writer's side, and a hard `left`
    // would put an RTL writer's questions on the wrong one.
    expect(bubble).toContain("margin-inline-start: auto");
    expect(bubble).not.toContain("margin-left: auto");
  });

  it("keeps the bubble on the writer's side under a thumb, the pencil before it", () => {
    // Under a coarse pointer the turn is a row ending at the logical end, so
    // the bubble's auto margin is dropped rather than pushing the pencil
    // to the far edge.
    const coarse = FLAT.slice(FLAT.indexOf("@media (pointer: coarse)"));
    expect(coarse).toMatch(
      /\.msg-you \{[^}]*display: flex;[^}]*justify-content: flex-end;/,
    );
    expect(coarse).toMatch(
      /\.msg\.msg-you \.msg-body \{[^}]*margin-inline-start: 0;/,
    );
    expect(coarse).toMatch(/\.msg-you-actions \{[^}]*order: -1;/);
  });

  it("holds the footer's space at rest and only moves its opacity", () => {
    // A transcript that reflows as the pointer crosses it moves while it is
    // being read, and this scroller follows a streaming answer, so the
    // shifting would compound down the whole conversation.
    const row = matteRule(/\.ai-turn-meta \{[^}]*\}/);
    expect(row).toContain("opacity: 0");
    expect(row).not.toContain("display: none");
    expect(row).not.toContain("visibility");
  });

  it("draws the caret rather than letting the platform draw it", () => {
    // Both halves of removing the native triangle (Firefox reads
    // `list-style`, WebKit needs its own pseudo-element), so the glyph can be
    // the app's own chevron and turn with the disclosure.
    const summary = matteRule(/\.ai-turn-meta > summary \{[^}]*\}/);
    expect(summary).toContain("list-style: none");
    expect(FLAT).toContain(".ai-turn-meta > summary::-webkit-details-marker");
    const mark = matteRule(/\.ai-turn-caret \{[^}]*\}/);
    expect(mark).toContain("rotate(-90deg)");
  });

  it("floors the chatbar's second button under a thumb", () => {
    const coarse = FLAT.slice(FLAT.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain(".ai-persona");
  });

  it("gives the writer's field the app's field shape, once, for every pointer", () => {
    // `.ui-input` and `.ui-select` are `var(--r)` everywhere else in the
    // estate, so a writer crossing from a settings dialog into this box sees
    // the same field, and the shape of a field does not depend on what is
    // pointing at it.
    const pill = matteRule(/\.composer \{[^}]*\}/);
    expect(pill).toContain("border-radius: var(--r)");
  });

  it("leaves the rename field to the kit", () => {
    // The rename field is the kit `Input`, so its shape is the kit's and no
    // rule here styles it.
    expect(FLAT).not.toMatch(/\.ai-rename input/);
  });

  it("draws a persona's face with the theme's radius and nothing else", () => {
    // `50%` is a radius written in a way a square theme can never reach, and
    // a radius is the theme's call. The rest is what the face does not have:
    // `.app-avatar` wears no ring and no plate, and an opacity here would read
    // as the `:disabled` chip, which a face never says.
    const face = matteRule(/\.ai-face \{[^}]*\}/);
    expect(face).toContain("border-radius: var(--r-round)");
    expect(face).toContain("object-fit: cover");
    expect(face).not.toContain("50%");
    for (const never of ["border:", "box-shadow", "opacity", "background"])
      expect(face).not.toContain(never);
  });

  it("draws the new-chat button in the dock's one add shape", () => {
    // The `+` wears the dock's one add-pill, the same borderless
    // icon-and-word the notes table and every reference card use, so the
    // gesture has one shape.
    expect(FLAT).toMatch(/\.snap-add,\s*\.ref-card-add,\s*\.ai-new-chat \{/);
    // The lookbehind, because the recipe's own selector list ends with this
    // name; without it this reads the shared rule and asserts nothing about
    // the one rule the Ask face owns.
    const button = matteRule(/(?<!, )\.ai-new-chat \{[^}]*\}/);
    // Placement only: everything it looks like comes from the recipe above,
    // so a border or a padding here would drift away from that shape.
    expect(button).not.toContain("border");
    expect(button).not.toContain("padding");
  });

  it("draws the chat title as a button", () => {
    // A bare word with a hover tint is a caption that happens to be
    // clickable. The hairline and the chevron say the name can be exchanged
    // for another.
    // The lookbehind, because the shared height rule's selector list ends
    // with this name and comes first in the sheet.
    const title = matteRule(/(?<!, )\.ai-chat-title \{[^}]*\}/);
    expect(title).toContain("border: 1px solid;");
    expect(title).toContain("border-color: var(--hair)");
    expect(title).toContain("display: inline-flex");
  });

  it("draws no second rule around the composer under the chat bar", () => {
    // Below the composer the bar has `.dock-foot`'s hairline right under it,
    // and two rules 30px apart would draw a box nobody meant.
    const bar = matteRule(/\.ai-chatbar \{[^}]*\}/);
    expect(bar).not.toContain("border");
    expect(bar).toContain("padding: 0 14px 10px");
  });
});

describe("a /verify answer's stylesheet", () => {
  /**
   * The body of the rule whose whole selector is `selector` as Matte wears
   * it, the frame's declarations then Matte's, or null.
   */
  const rule = (selector: string): string | null => {
    const head = `} ${selector} {`;
    const found = [FLAT, MATTE_FLAT].flatMap((flat) => {
      const at = flat.indexOf(head);
      return at < 0
        ? []
        : [flat.slice(at + head.length, flat.indexOf("}", at + head.length))];
    });
    return found.length ? found.join("") : null;
  };

  it("colours each mark by the degree it draws, the cut ring slate", () => {
    expect(rule(".ai-mark.is-full")).toContain("color: var(--accent)");
    expect(MATTE_FLAT).toMatch(
      /\.ai-mark\.is-partly, \.ai-mark\.is-none \{ color: var\(--attention\); \}/,
    );
    expect(rule(".ai-mark.is-unsettled")).toContain("color: var(--ink-3)");
    expect(rule(".ai-mark")).toContain("flex-shrink: 0");
  });

  it("lays the verdict out with the map key's own recipe", () => {
    expect(FLAT).toMatch(
      /\.ai-map-row \.ai-finding-head, \.ai-verdict \{ display: flex; align-items: center; gap: 6px; \}/,
    );
    expect(rule(".ai-verdict > strong")).toContain(
      "font-weight: var(--bold-weight)",
    );
  });
});

// ── No list scrolls sideways ─────────────────────────────────────────────────
//
// The kit row is `width: 100%`, and beside the row's `more` button that is
// wider than the list. The chat row gives way to its button, and the scroll
// area refuses a horizontal scrollbar besides.
describe("the dialog lists scroll one way", () => {
  it("never gives the kit's scroll area a horizontal scrollbar", async () => {
    const { default: BASE } = await import("../styles/base.css?raw");
    const flat = BASE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");
    const rule = /\.ui-scroll \{[^}]*\}/.exec(flat)?.[0] ?? "";
    expect(rule).toContain("overflow-x: hidden");
    expect(rule).toContain("overflow-y: auto");
  });
});

describe("an answer's table", () => {
  it("rules every cell and reads each row from its top line", () => {
    const cells = matteRule(
      /\.msg-assistant \.dock-read th, \.msg-assistant \.dock-read td \{[^}]*\}/,
    );
    expect(cells).toContain("border: 1px solid;");
    expect(cells).toContain("border-color: var(--hair)");
    expect(cells).toContain("vertical-align: top");
    expect(FLAT).toMatch(
      /\.msg-assistant \.dock-read table \{[^}]*border-collapse: collapse/,
    );
  });
});

describe("the frame's options, each drawn once here", () => {
  it("marks a note's passage with a ‸ and draws the note with no card", () => {
    expect(FLAT).toContain(
      ':root[data-comments="notes"] .cm-marker[data-at="end"]::after { content: "‸" / "";',
    );
    expect(MATTE_FLAT).toMatch(
      /:root\[data-comments="notes"\] :is\(\.cm-layer\[data-mode="notes"\], \.cm-float\) :is\(\.cm-card[^{]*\{ background: none; box-shadow: none; \}/,
    );
  });

  it("tints a note's passage only under the hand, in the theme's comment ground", () => {
    // Cards tint every passage; notes none at rest, and the hovered one in
    // the same ground, so the words a note is about are one hover away.
    expect(MATTE_FLAT).toContain(
      "::highlight(comment) { background-color: var(--mark-comment); }",
    );
    expect(MATTE_FLAT).toContain(
      ':root[data-comments="notes"] ::highlight(comment) { background-color: transparent; }',
    );
    expect(MATTE_FLAT).toContain(
      ':root[data-comments="notes"] ::highlight(comment-hover) { background-color: var(--mark-comment); }',
    );
  });
});
