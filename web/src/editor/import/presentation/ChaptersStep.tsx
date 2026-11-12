// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Icon,
  Input,
  motionIsStill,
  Select,
  Tick,
  Tip,
} from "../../../ui";
import {
  layout,
  unitsOf,
  unitWords,
  type NodeKind,
  type Unit,
} from "../application/draft";
import {
  canBe,
  rename,
  setKind,
  splitAt,
  toggleInclude,
  toggleStart,
  type SceneMarks,
} from "../application/edits";
import type { Loss } from "../application/losses";
import type { PreparedBook } from "../application/prepare";
import type { ImportPlan, PlanEntry, RuleId } from "../domain/plan";
import { DROPPED_MATTER, type MatterKind } from "../domain/source";
import type { TitleWords } from "../ports";
import RowDialog, { type Piece } from "./RowDialog";

// Step 2, where the chapters start: every row the detection found, on one
// line of beads, drawn as the tree it will become (a Part in bold, what it
// holds stepped in under it), with what the writer can do to each:
//
//   - its bead, which is its tick: filled, the row is imported; empty, it
//     is left out. A page the app would make for itself (a title page, the
//     contents) is listed like any other and starts empty; nothing leaves
//     the manuscript unseen. A row the detection left out says why beside
//     its title ("Title page · left out"), since an empty bead the writer
//     never emptied is a choice they did not see made. A row left out
//     offers nothing else.
//   - the seam between two beads: pressed, the row becomes the end of the
//     one above's text, so a stray bold line read as a title costs one click
//     and loses nothing.
//   - its title, renamed where it stands (`TitleField`), only on a row that
//     will be a Part or a Section.
//   - "Make a Part" or "Make a Section", and "Split", which opens the row
//     whole (`RowDialog`): on the row under the pointer, and only when the
//     tree allows it.
//
// A group of joined rows is drawn as the one Section it will be: one bead
// and one count at the group's middle, the first row's title at its size,
// and the joined rows smaller under it, as lines of its text, not names.
// Every bead is a Section the project will hold, and all are one size: a
// group with two beads would read as two Sections, and a bead the group's
// height as weightier than a row alone.
//
// A join is shown happening: the beads slide together and the joined row
// tucks up under the name (`fuse` draws the stand-in bead). With reduced
// motion every part of it is there.
//
// One warning, and only when something will not come across: what the
// project cannot hold (footnotes, pictures, text boxes).

export interface ChaptersStepProps {
  plan: ImportPlan;
  book: PreparedBook;
  words: TitleWords;
  losses: readonly Loss[];
  rule: RuleId | "auto";
  separator: string;
  onRule: (rule: RuleId | "auto") => void;
  onSeparator: (text: string) => void;
  onEdit: (edit: (plan: ImportPlan) => ImportPlan) => void;
  /**
   * The changes the last change of way undid; 0 when there is nothing to
   * undo.
   */
  undone: number;
  onUndo: () => void;
  /** What the scenes tick offers; null when the book has no scene breaks. */
  scenes: SceneMarks | null;
  scenesOn: boolean;
  onScenes: (on: boolean) => void;
  /** Underlined runs in the file; the tick shows only when there are some. */
  underlined: number;
  underlineItalic: boolean;
  onUnderline: () => void;
  /**
   * Comments in the file, replies included; the tick shows only when there
   * are some.
   */
  commented: number;
  keepComments: boolean;
  onComments: () => void;
}

export default function ChaptersStep({
  plan,
  book,
  words,
  losses,
  rule,
  separator,
  onRule,
  onSeparator,
  onEdit,
  undone,
  onUndo,
  scenes,
  scenesOn,
  onScenes,
  underlined,
  underlineItalic,
  onUnderline,
  commented,
  keepComments,
  onComments,
}: ChaptersStepProps) {
  const { t } = useTranslation();
  // The row that is open.
  const [open, setOpen] = useState<string | null>(null);
  const units = unitsOf(plan, words);
  // Each starting row's own words: its text and that of every row joined to
  // it, which is what its Section will hold.
  const wordsOf = new Map(
    units.map((unit) => [unit.entry.key, unitWords(book, unit)]),
  );
  const shown = plan.entries;
  const rows = rowsOf(plan, units, words);
  // A join or a separation slides the counts and the beads from where they
  // stood to where they stand now. Only those two move them: a change of rule
  // or a tick redraws the list, and a list of counts sliding about at once
  // would say something moved that did not.
  const list = useRef<HTMLOListElement>(null);
  const motion = useRef<Motion | null>(null);
  useLayoutEffect(() => {
    const root = list.current;
    const move = motion.current;
    motion.current = null;
    if (!root || !move) return;
    const placeOf = placer(root);
    for (const [key, el] of moversIn(root)) {
      const now = placeOf(el);
      // A bead parted from a group sets out from where the group's stood.
      const was =
        move.before.get(key) ??
        (!move.joining && key === `bead:${move.key}`
          ? move.before.get(`bead:${move.head}`)
          : undefined);
      if (was && moved(was, now)) slideFrom(el, was.x - now.x, was.y - now.y);
    }
    if (move.joining) fuse(root, move.key, move.before);
  });
  // Each seam spans the whole gap between its two beads, wherever they stand:
  // a group's bead sits at its middle, so the gap above or below one is
  // longer than a row's. Measured again whenever an item changes height:
  // a join tucks its line up over a beat, and the seams below follow it.
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    drawSeams(root);
    if (typeof ResizeObserver !== "function") return;
    const watch = new ResizeObserver(() => drawSeams(root));
    for (const item of root.children) watch.observe(item);
    return () => watch.disconnect();
  });
  // The row just separated from the one above, which grows back to a row.
  const [unjoined, setUnjoined] = useState<string | null>(null);
  const join = (row: Row) => {
    motion.current = {
      key: row.entry.key,
      head: row.head.key,
      joining: !row.joined,
      before: list.current ? placesIn(list.current) : new Map(),
    };
    setUnjoined(row.joined ? row.entry.key : null);
    onEdit((p) => toggleStart(p, row.entry.key));
  };
  const opened = rows.find((row) => row.entry.key === open);
  const current = rule === "auto" ? plan.rule : rule;
  // Whether the writer's line is anywhere in the text: the separator rule is
  // offered even when it finds nothing, so its candidate says which it is.
  const separatorFound = plan.candidates.some(
    (c) => c.rule === "separator" && c.available,
  );
  // Choosing "A line I choose" is asking to type one: the field takes the
  // caret, so the next keystroke lands where the label says it goes.
  const separatorField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (current === "separator") separatorField.current?.focus();
  }, [current]);
  const scenesNote = useId();
  const ruleOptions = plan.candidates
    // The separator rule is the writer's own line, so it is always offered.
    .filter((c) => c.available || c.rule === "separator")
    .map((c) => ({ value: c.rule, label: t(`import.rule.${c.rule}`) }));

  return (
    <>
      {/* One line, so the list below keeps the height: "Split by: [▾]".
          Under the control, what the chosen way does to the prose: an
          option's name ("Headings") says what it looks at, not where the text
          is cut or what becomes of the line it is cut at. */}
      <div className="import-split">
        <Select
          inline
          label={t("import.splitLabel")}
          value={current}
          options={ruleOptions}
          onChange={onRule}
          note={t(`import.ruleNote.${current}`)}
        />
        {/* The writer's own line, under the way that asks for it, with its
            label on show: beside the dropdown, a "###" box with no visible
            name reads as part of the control, not as a field waiting for
            the writer, and nothing says "type here". */}
        {current === "separator" && (
          <Input
            ref={separatorField}
            label={t("import.separatorLabel")}
            placeholder={t("import.separatorPlaceholder")}
            autoComplete="off"
            value={separator}
            onChange={(event) => onSeparator(event.target.value)}
          />
        )}
        {/* What a change of way undid, with the way back: a line, not a
            question asked before, since the change is the writer's, and so is
            the choice to have their edits again. */}
        {undone > 0 && (
          <p className="import-undone" role="status">
            {t("import.undone", { count: undone })}{" "}
            <Button variant="link" onClick={onUndo}>
              {t("import.undo")}
            </Button>
          </p>
        )}
        {/* The book's choices, each offered only when the file gives it
            something to do, and each saying what it found. */}
        {(scenes || underlined > 0 || commented > 0) && (
          <div className="ui-ticks import-choices">
            {scenes && (
              <div className="import-choice">
                <Tick
                  checked={scenesOn}
                  onToggle={() => onScenes(!scenesOn)}
                  aria-describedby={scenesNote}
                  note={
                    scenes.mark
                      ? t("import.scenesByMark", {
                          count: scenes.count,
                          mark: scenes.mark,
                        })
                      : t("import.scenesByBlank", { count: scenes.count })
                  }
                >
                  {t("import.scenes")}
                </Tick>
                {/* What the tick does to the list, as the way of splitting
                    says what it does to the prose. */}
                <p id={scenesNote} className="ui-input-note">
                  {t("import.scenesNote")}
                </p>
              </div>
            )}
            {underlined > 0 && (
              <Tick
                checked={underlineItalic}
                onToggle={onUnderline}
                note={underlined.toLocaleString()}
              >
                {t("import.underline")}
              </Tick>
            )}
            {/* Ticked, because they are the file's: an editor's remarks are
                part of what the writer brought. Unticked, the book comes
                in with a clean margin: the writer's call, said here,
                before anything is written, rather than found in the margin
                after. */}
            {commented > 0 && (
              <Tick
                checked={keepComments}
                onToggle={onComments}
                note={commented.toLocaleString()}
              >
                {t("import.comments")}
              </Tick>
            )}
          </div>
        )}
      </div>

      {/* Only what the project cannot hold. What the writer leaves out with a
          tick is their own choice, made in this list and visible in it, so it
          is not news to report back (a count of the blank lines it takes
          would read as a fault the writer had caused). */}
      {losses.length > 0 && (
        <p className="import-warning" role="note">
          {t("import.losses", {
            list: losses
              .map((loss) =>
                t(`import.loss.${loss.key}`, { count: loss.count }),
              )
              .join(", "),
          })}
        </p>
      )}

      {shown.length > 1 ? (
        <>
          <ol
            ref={list}
            className="import-outline"
            aria-label={t("import.listLabel")}
            // The list scrolls, and would clip a last row's tip.
            data-tips-out=""
          >
            {/* One item per Section: a group of joined rows is one entry of the
              list, and lights as one under the pointer. The item is the grid
              its rows' cells stand in, a line each, so one bead and one count
              can stand for the whole group. */}
            {groupsOf(rows).map((group) => (
              <li
                key={group[0].entry.key}
                className="import-group"
                data-kind={group[0].kind}
                data-joined={group.length > 1 ? "1" : "0"}
                style={
                  {
                    "--depth": group[0].depth,
                    "--lines": group.length,
                  } as React.CSSProperties
                }
              >
                {group.map((row, line) => {
                  const { entry } = row;
                  const count = row.head.included
                    ? (wordsOf.get(row.head.key) ?? 0)
                    : 0;
                  return (
                    <div
                      key={entry.key}
                      className="import-row"
                      data-key={entry.key}
                      data-kind={row.kind}
                      data-included={entry.included ? "1" : "0"}
                      data-joined={row.joined ? "1" : "0"}
                      data-unjoined={
                        unjoined === entry.key && !row.joined ? "1" : undefined
                      }
                      style={{ "--line": line + 1 } as React.CSSProperties}
                      onAnimationEnd={(event) => {
                        if (event.animationName === "import-untuck")
                          setUnjoined(null);
                      }}
                    >
                      {/* The seam above a row that starts its own Section:
                          the dashes between the two beads, and on them the
                          one control that joins the row to the one above.
                          A joined line is separated from the line itself
                          instead. */}
                      {row.joinable && !row.joined && (
                        <span className="import-seam">
                          <Button
                            variant="icon"
                            className="import-join"
                            aria-label={t("import.joinLabel", {
                              title: entry.title,
                            })}
                            data-tip=""
                            onClick={() => join(row)}
                          >
                            {/* Its word, then its glyph on the seam: the
                                glyph alone, small in a gap, is a mark to
                                learn. */}
                            <span
                              className="import-join-word"
                              aria-hidden="true"
                            >
                              {t("import.merge")}
                            </span>
                            {/* Drawn heavier than the set, to hold its shape
                                at the size of a gap between two beads. */}
                            <Icon
                              name="join"
                              size={16}
                              strokeWidth={2.25}
                              aria-hidden="true"
                            />
                            <Tip label={t("import.join")} />
                          </Button>
                        </span>
                      )}
                      {/* The group's one bead: a joined line has none of
                          its own, so the beads down the list are the
                          Sections the project will hold, one each. */}
                      {!row.joined && (
                        <Tick
                          bead
                          checked={entry.included}
                          aria-label={t("import.includeLabel", {
                            title: entry.title,
                          })}
                          onToggle={() =>
                            onEdit((p) => toggleInclude(p, entry.key))
                          }
                        />
                      )}
                      {row.named ? (
                        <TitleField
                          title={entry.title}
                          label={t("import.renameLabel", {
                            title: entry.title,
                          })}
                          onRename={(typed) =>
                            onEdit((p) => rename(p, entry.key, typed))
                          }
                        />
                      ) : row.leftOut ? (
                        <span className="import-row-name">
                          <span className="import-row-title">
                            {entry.title}
                          </span>
                          <span className="import-row-tag">
                            {leftOutTag(row.leftOut, entry, t)}
                          </span>
                        </span>
                      ) : (
                        <span className="import-row-title">{entry.title}</span>
                      )}
                      {row.named && row.becomes && (
                        <KindButton
                          title={entry.title}
                          kind={row.becomes}
                          onClick={() => {
                            const kind = row.becomes as NodeKind;
                            onEdit((p) => setKind(p, entry.key, kind, words));
                          }}
                        />
                      )}
                      {row.joined && (
                        <Button
                          variant="quiet"
                          className="import-act import-separate"
                          aria-label={t("import.separateLabel", {
                            title: entry.title,
                          })}
                          onClick={() => join(row)}
                        >
                          {t("import.separate")}
                        </Button>
                      )}
                      {/* Every row holds the same places on its right (the
                          split, the count) whether it has them or not, so
                          "Make a Part" and "Split" stand in one column down
                          the list, even on a row whose count sits on the row
                          below. A row with no text to split, or
                          left out, keeps the button's word, unseen, as its
                          seat. */}
                      {entry.included && entry.end > entry.start ? (
                        <Button
                          variant="quiet"
                          className="import-act import-open"
                          aria-label={t("import.openLabel", {
                            title: entry.title,
                          })}
                          aria-haspopup="dialog"
                          onClick={() => setOpen(entry.key)}
                        >
                          <Icon name="split" size={13} aria-hidden="true" />
                          {t("import.open")}
                        </Button>
                      ) : (
                        <span
                          className="ui-btn ui-btn-quiet import-act import-open import-seat"
                          aria-hidden="true"
                        >
                          <Icon name="split" size={13} aria-hidden="true" />
                          {t("import.open")}
                        </span>
                      )}
                      {/* The group's one count, level with its one bead. A
                          row with none (a Part heading straight above its
                          first chapter) shows no count: its chapters hold
                          the text, and "0 words" beside a Part reads as an
                          empty one. */}
                      {!row.joined &&
                        (count > 0 ? (
                          <span
                            className="import-row-words"
                            data-count-for={row.head.key}
                          >
                            {t("import.words", {
                              count,
                              formatted: count.toLocaleString(),
                            })}
                          </span>
                        ) : (
                          <span
                            className="import-row-count-seat"
                            aria-hidden="true"
                          />
                        ))}
                    </div>
                  );
                })}
              </li>
            ))}
          </ol>
          {/* What the beads, the gaps between them, the titles and the
            scissors do, said once under the list: controls with no words of
            their own on them. */}
          <p className="import-outline-help">{t("import.beadsHelp")}</p>
        </>
      ) : (
        // The list's place, kept when there is nothing to list: the window
        // must not lose its preview the moment a way finds no division,
        // least of all the writer's own line, which lists nothing until it
        // is typed.
        <p className="import-outline-empty" role="status">
          {current === "separator" && !separator.trim()
            ? t("import.outlineEmpty.type")
            : current === "separator" && !separatorFound
              ? t("import.outlineEmpty.noMatch", { text: separator.trim() })
              : t("import.outlineEmpty.whole")}
        </p>
      )}
      {opened && (
        <RowDialog
          title={opened.entry.title}
          book={book}
          pieces={piecesOf(shown, opened.entry)}
          onCut={(key, at) => onEdit((p) => splitAt(p, key, at, words))}
          onJoin={(key) => onEdit((p) => toggleStart(p, key))}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/**
 * What a row can become instead of what it is, on the row: hidden until the
 * pointer is over the row's Section or the keyboard is in it, so a list of
 * sixty rows does not read as sixty buttons. Its glyph is the tree's own for
 * what it makes.
 */
function KindButton({
  title,
  kind,
  onClick,
}: {
  title: string;
  kind: NodeKind;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="quiet"
      className="import-act import-kind"
      aria-label={t(`import.makeLabel.${kind}`, { title })}
      onClick={onClick}
    >
      <Icon name={kind} size={13} aria-hidden="true" />
      {t(`import.make.${kind}`)}
    </Button>
  );
}

/**
 * A row's name, typed over where it stands: text until it is clicked, a
 * field while it is typed in. Enter or leaving it keeps what was typed;
 * nothing typed keeps the old name. Enter is the wizard's "next" everywhere
 * else in the window, so here it is held back: it ends the naming, no more.
 */
function TitleField({
  title,
  label,
  onRename,
}: {
  title: string;
  label: string;
  onRename: (typed: string) => void;
}) {
  const [text, setText] = useState(title);
  // A name changed from elsewhere (a made-up one, renamed in the book's
  // language) replaces what the field shows.
  const [shownFor, setShownFor] = useState(title);
  if (shownFor !== title) {
    setShownFor(title);
    setText(title);
  }
  return (
    <input
      className="import-row-title"
      aria-label={label}
      value={text}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text.trim() && text !== title) onRename(text);
        else setText(title);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
    />
  );
}

/** Where a count or a bead stands in the list's content. */
interface Place {
  x: number;
  y: number;
}

interface Row {
  entry: PlanEntry;
  /** The row whose Section this one's text goes into: itself, unless joined. */
  head: PlanEntry;
  /** Whether a seam is offered above it: both it and the row above come in. */
  joinable: boolean;
  /** Joined to the row above. */
  joined: boolean;
  /** It will be a Part or a Section of its own, with a name to change. */
  named: boolean;
  kind: NodeKind;
  /** The other kind, when the tree lets the row be it; null when not. */
  becomes: NodeKind | null;
  depth: number;
  /** Why it is left out, while it stays out; null when it comes in. */
  leftOut: LeftOut | null;
}

/**
 * A page the project makes itself, an EPUB's extra off its reading order, or
 * the writer's own choice, which needs no reason given.
 */
type LeftOut = MatterKind | "offSpine" | "writer";

/**
 * The row's tag: what the page is and that it stays out. A title that is
 * already the kind says it, so the kind is not said twice: one made up from
 * it, in the book's language, which may not be the window's ("Frontespizio"
 * beside "Title page"), or one the book gave that reads as it ("Contents").
 */
function leftOutTag(
  why: LeftOut,
  entry: PlanEntry,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (why === "writer") return t("import.tag.alone");
  const kind = t(
    why === "offSpine" ? "import.tag.offSpine" : `import.title.matter.${why}`,
  );
  const said =
    (why !== "offSpine" && entry.titleSource === "generated") ||
    kind.trim().toLowerCase() === entry.title.trim().toLowerCase();
  return said ? t("import.tag.alone") : t("import.tag.kind", { kind });
}

/**
 * Each row as the list draws it. A join reaches the row directly above, and
 * only when both come in (`unitsOf` reads the plan the same way), so the line
 * between two beads is never drawn through a row that is left out; a scene
 * joins only a scene, never the chapter it belongs to. A row's kind and
 * depth are the tree's (`layout`): a joined row stands where its group's
 * first row stands, so the line between them is straight, and a row left
 * out stands where it would if it came in. What else a row may become is
 * asked of the tree too (`canBe`), so the list never offers a change the
 * tree would refuse.
 */
function rowsOf(
  plan: ImportPlan,
  units: readonly Unit[],
  words: TitleWords,
): Row[] {
  const entries = plan.entries;
  const placed = new Map(layout(units).map((node) => [node.entry.key, node]));
  const whole = new Map(
    layout(
      entries.map((entry) => ({
        entry: { ...entry, included: true, starts: true },
        body: [],
      })),
    ).map((node) => [node.entry.key, node]),
  );
  const rows: Row[] = [];
  entries.forEach((entry, index) => {
    const above = rows[index - 1];
    const joinable =
      entry.included &&
      !!above?.entry.included &&
      (entry.level !== "scene" || above.entry.level === "scene");
    const joined = joinable && !entry.starts;
    const node = placed.get(entry.key) ?? whole.get(entry.key);
    const kind = joined ? above.kind : (node?.kind ?? "section");
    const other = kind === "part" ? "section" : "part";
    rows.push({
      entry,
      head: joined ? above.head : entry,
      joinable,
      joined,
      named: entry.included && !joined,
      kind,
      becomes:
        entry.included && !joined && canBe(plan, entry.key, other, words)
          ? other
          : null,
      depth: joined ? above.depth : (node?.depth ?? 0),
      leftOut: entry.included
        ? null
        : entry.matter && DROPPED_MATTER.has(entry.matter)
          ? entry.matter
          : entry.offSpine
            ? "offSpine"
            : "writer",
    });
  });
  return rows;
}

/**
 * A row and the rows cut from it, which the open row shows as one text with
 * its cuts drawn in: a cut's row is named after the row it was cut from.
 */
function piecesOf(entries: readonly PlanEntry[], entry: PlanEntry): Piece[] {
  const at = entries.indexOf(entry);
  const pieces: Piece[] = [];
  for (let i = at; i < entries.length; i++) {
    const e = entries[i];
    if (i > at && !e.key.startsWith(`${entry.key}/`)) break;
    pieces.push({
      key: e.key,
      title: e.title,
      start: e.start,
      end: e.end,
      cut: i > at && e.starts,
    });
  }
  return pieces;
}

/**
 * Starts a count where it stood and lets it slide to where it stands, the
 * `FLIP` way: set back by the distance with no transition, then released to
 * the stylesheet's, which reduced motion turns off.
 */
function slideFrom(count: HTMLElement, dx: number, dy: number) {
  count.style.transition = "none";
  count.style.transform = `translate(${dx}px, ${dy}px)`;
  // Reads a layout value, so the set-back is drawn before it is let go.
  void count.offsetHeight;
  count.style.transition = "";
  count.style.transform = "";
}

/** A join or a separation the writer just made, for the list to show. */
interface Motion {
  /** The row joined, or separated. */
  key: string;
  /** The row whose group it was in, before. */
  head: string;
  joining: boolean;
  /**
   * Where the counts and beads stood as the writer pressed: what the eye
   * last saw, read at the press. Read after the render before it instead,
   * they would be read as a join's line begins to tuck up, still a row tall,
   * and the next join's beads would jump by half that before they slide.
   */
  before: Map<string, Place>;
}

/**
 * What slides on a join: each count, and each bead (the tick of a row that
 * starts its group), known by that row.
 */
function moversIn(root: HTMLElement): [string, HTMLElement][] {
  const movers: [string, HTMLElement][] = [];
  for (const count of root.querySelectorAll<HTMLElement>("[data-count-for]"))
    movers.push([`count:${count.dataset.countFor ?? ""}`, count]);
  for (const row of root.querySelectorAll<HTMLElement>(".import-row")) {
    const tick = row.querySelector<HTMLElement>(":scope > .ui-tick");
    if (tick) movers.push([`bead:${row.dataset.key ?? ""}`, tick]);
  }
  return movers;
}

/**
 * Where an element stands, measured against the list's content, not the
 * window, so a scroll between two renders is not read as everything moving;
 * and by the right edge, the one counts are aligned on, so a total with
 * another number of digits slides straight rather than sideways.
 */
function placer(root: HTMLElement) {
  const box = root.getBoundingClientRect();
  return (el: Element): Place => {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.right - box.left,
      y: rect.top - box.top + root.scrollTop,
    };
  };
}

const placesIn = (root: HTMLElement) => {
  const placeOf = placer(root);
  return new Map(moversIn(root).map(([key, el]) => [key, placeOf(el)]));
};

const moved = (was: Place, now: Place) =>
  Math.abs(was.x - now.x) > 1 || Math.abs(was.y - now.y) > 1;

/**
 * Two beads becoming one: the joined row's bead is gone from the list the
 * moment the plan changes, so a stand-in for it sets out from where it stood
 * while the group's own bead slides to the group's middle; where they meet
 * the stand-in goes, and one bead is left. A stand-in is drawn only where
 * the list is moving at all: never with reduced motion, and never where
 * nothing moved.
 *
 * The stand-in rides inside the group's own tick, set off from it by as far
 * as the two beads stood apart before the join, and slides to nothing on the
 * same beat as the tick's own slide. So it lands on the bead wherever the
 * bead lands, and the bead keeps moving after its slide is measured, as the
 * joined line tucks up under the name. Aimed at a point in the item instead,
 * it would aim at where the bead was set back to, not where it goes, and
 * slide past it and vanish.
 */
function fuse(root: HTMLElement, key: string, before: Map<string, Place>) {
  if (motionIsStill()) return;
  const row = [...root.querySelectorAll<HTMLElement>(".import-row")].find(
    (r) => r.dataset.key === key,
  );
  const head = row
    ?.closest<HTMLElement>(".import-group")
    ?.querySelector<HTMLElement>(":scope > .import-row:first-child");
  const tick = head?.querySelector<HTMLElement>(":scope > .ui-tick");
  const bead = tick?.querySelector<HTMLElement>(".ui-tick-bead");
  // Where the joined row's bead and the group's stood before the join.
  const was = before.get(`bead:${key}`);
  const from = before.get(`bead:${head?.dataset.key ?? ""}`);
  if (!tick || !bead || !was || !from || !moved(was, from)) return;
  const ghost = document.createElement("span");
  ghost.className = "import-bead-ghost";
  ghost.style.left = `${bead.offsetLeft}px`;
  ghost.style.top = `${bead.offsetTop}px`;
  tick.append(ghost);
  slideFrom(ghost, was.x - from.x, was.y - from.y);
  const land = () => ghost.remove();
  ghost.addEventListener("transitionend", land, { once: true });
  // Should the slide never end (the tab hidden mid-way), it goes anyway.
  window.setTimeout(land, 600);
}

/**
 * Places each item's seam from the bottom of the bead above to the top of its
 * own, so its dashes touch both and its join stands half way between them;
 * three dashes in the middle of a long gap would join nothing to anything.
 * Read from layout offsets, which a bead's slide (a
 * transform) does not move: the seam goes where the beads are going.
 */
function drawSeams(root: HTMLElement) {
  for (const item of root.children) {
    const seam = item.querySelector<HTMLElement>(
      ":scope > .import-row > .import-seam",
    );
    const above = item.previousElementSibling;
    if (!seam || !(item instanceof HTMLElement)) continue;
    if (!(above instanceof HTMLElement)) continue;
    const own = beadOf(item);
    const up = beadOf(above);
    if (!own || !up) continue;
    // Both in the item's own terms: the bead above is in its item's, which
    // stands this far above.
    const top = up.centre + above.offsetTop - item.offsetTop + up.size / 2;
    const bottom = own.centre - own.size / 2;
    seam.style.top = `${top}px`;
    seam.style.height = `${Math.max(0, bottom - top)}px`;
  }
}

/** Where an item's bead stands in the item, and its size. */
function beadOf(item: HTMLElement) {
  const tick = item.querySelector<HTMLElement>(
    ":scope > .import-row:first-child > .ui-tick",
  );
  const bead = tick?.querySelector<HTMLElement>(".ui-tick-bead");
  if (!tick || !bead) return null;
  // The bead is centred in its tick.
  return {
    centre: tick.offsetTop + tick.offsetHeight / 2,
    size: bead.offsetHeight,
  };
}

/** The rows in runs: a row and every row joined below it, one Section each. */
function groupsOf(rows: readonly Row[]): Row[][] {
  const groups: Row[][] = [];
  for (const row of rows) {
    if (row.joined) groups[groups.length - 1].push(row);
    else groups.push([row]);
  }
  return groups;
}
