// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { appIcons } from "./appIcons";
import { useTipWarmth } from "./useTipWarmth";

// The command bar: one floating control surface. The container carries the
// whole shape and the segments carry none of their own, with hairlines between
// them; segments with borders would make it a toolbar.
//
// The bar knows shape and motion and nothing about projects, storage or
// documents; callers compose its contents. Each glyph carries its name as
// `data-icon`, so a test can tell which one is drawn.

export const CommandBar = forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode;
    /** A segment is showing a panel; dividers step back while one is open. */
    open?: boolean;
    className?: string;
    // The Library's bar is a plain container; the editor's is a
    // `role="toolbar"` that also tells the stylesheet which segment has the
    // writer's attention. Any other attribute lands on the element.
  } & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">
>(function CommandBar({ children, open = false, className, ...rest }, ref) {
  // The bar is the tooltip group: the first tip pays the delay and the rest of
  // the row is instant. `useTipWarmth` tracks it; the stylesheet reads
  // `data-tips`.
  const tips = useTipWarmth();
  return (
    <div
      ref={ref}
      className={["ui-bar", className ?? ""].filter(Boolean).join(" ")}
      data-open={open ? "1" : "0"}
      {...rest}
      data-tips={tips.warm ? "warm" : undefined}
      onPointerEnter={tips.onPointerEnter}
      onPointerLeave={tips.onPointerLeave}
    >
      {children}
    </div>
  );
});

/**
 * One region of the bar; anything inside is the caller's. It is `relative`,
 * so a segment that opens a panel anchors it to its own box and grows from
 * there rather than dropping a menu below itself.
 */
export const CommandBarSegment = forwardRef<
  HTMLDivElement,
  { children: React.ReactNode; className?: string } & Omit<
    React.HTMLAttributes<HTMLDivElement>,
    "className" | "children"
  >
>(function CommandBarSegment({ children, className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={["ui-bar-seg", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
});

/**
 * An action at one end of the bar. `tone="solid"` is the primary: one per
 * bar, anchoring the leading end, and it takes `labelled`, so the button that
 * makes a new project is not a guess. Corners come from `--r` either way: a
 * capsule inside the bar's rounded corners would clash.
 */
export const CommandBarAction = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    icon: Parameters<typeof Icon>[0]["name"];
    tone?: "solid" | "quiet";
    /** Draw the label as text. Otherwise it is the accessible name alone. */
    labelled?: boolean;
    /**
     * An action in a bar beside the writing, such as the editor's walk
     * through its comments. Like every toggle there it does not take the
     * caret, and its name is drawn as their tip rather than as a `title`, so
     * one row does not speak in two kinds of tooltip.
     */
    keepsCaret?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }
>(function CommandBarAction(
  {
    label,
    icon,
    tone = "quiet",
    labelled = false,
    keepsCaret = false,
    disabled,
    onClick,
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={[
        "ui-bar-act",
        `ui-bar-act-${tone}`,
        labelled ? "ui-bar-act-labelled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // The accessible name even when the text is drawn: the drawn words are
      // hidden from assistive technology, so a screen reader hears them once.
      aria-label={label}
      title={labelled || keepsCaret ? undefined : label}
      data-tip={keepsCaret ? "" : undefined}
      disabled={disabled}
      onMouseDown={keepsCaret ? (event) => event.preventDefault() : undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={keepsCaret ? 15 : 16} data-icon={icon} />
      {labelled && <span aria-hidden>{label}</span>}
      {keepsCaret && <Tip label={label} />}
    </button>
  );
});

/**
 * An action that stays pressed, with `aria-pressed` and a tooltip; `Button`
 * does not carry them.
 *
 * The name is drawn as a `.ui-tip` rather than a `title`, because the shortcut
 * belongs in a `<kbd>` and `title` can render it only as parenthetical text.
 */
export const CommandBarToggle = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    icon?: Parameters<typeof Icon>[0]["name"];
    /** Drawn instead of an icon, for two-glyph labels such as `Àé`. */
    text?: string;
    pressed: boolean;
    disabled?: boolean;
    /** The keyboard shortcut, drawn beside the label in the tip. */
    shortcut?: string;
    /**
     * Something behind this toggle waits on the writer, such as a web search
     * to approve. Drawn only while the toggle is not pressed: once pressed,
     * what waits is in front of the writer. The caller says it in the label
     * too, because colour is never the only signal.
     */
    attention?: boolean;
    onClick: () => void;
  }
>(function CommandBarToggle(
  { label, icon, text, pressed, disabled, shortcut, attention, onClick },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className="ui-bar-act ui-bar-act-quiet"
      aria-label={label}
      aria-pressed={pressed}
      data-attention={attention && !pressed ? "1" : undefined}
      disabled={disabled}
      data-tip=""
      // A toolbar button must not take the caret with it: every formatting
      // control in the editor acts on the current selection.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={15} data-icon={icon} /> : null}
      {text ? <span aria-hidden>{text}</span> : null}
      <Tip label={label} shortcut={shortcut} />
    </button>
  );
});

/**
 * A row of cells with one thumb travelling under the chosen one.
 *
 * The Library's density toggle and the editor's alignment row are the same
 * control at two widths, so the cell width is a parameter. `--track-at`
 * carries the chosen index and the stylesheet multiplies, so a fifth cell
 * needs no new CSS.
 */
export function CommandBarTrack<T extends string>({
  label,
  options,
  value,
  cell = 34,
  seat,
  fit,
  disabled,
  unavailable,
  onChange,
  className,
}: {
  label: string;
  options: readonly {
    value: T;
    icon?: Parameters<typeof Icon>[0]["name"];
    text?: string;
    label: string;
    shortcut?: string;
    /**
     * Something behind this cell waits on the writer; drawn only while the
     * cell is not the chosen one (`CommandBarToggle`'s `attention`).
     */
    attention?: boolean;
    /**
     * Something behind this cell is at work while the writer looks elsewhere
     * (the dock's Ask tab while a chat answers); drawn only while the cell is
     * not the chosen one, like `attention`. The stylesheet draws it.
     */
    busy?: boolean;
  }[];
  value: T;
  /** Cell width in px; the rest of the geometry follows from it. */
  cell?: number;
  /**
   * `'sunk'` draws it as a physical switch, a trough with the chosen cell
   * raised out of it, rather than a tinted thumb under a row of glyphs. For a
   * track that tops a panel rather than a region of a bar.
   */
  seat?: "sunk";
  /**
   * Each cell is its own label's width plus an equal share of the spare
   * width, and the thumb is measured onto the chosen cell instead of
   * multiplied across. For a track whose labels differ too much for equal
   * cells to hold the longest with room around it: the dock's tabs, where
   * "Enlighten!" and its spark are 73px, "Notes" is 33, and four equal cells
   * at the panel's floor are 72 each.
   */
  fit?: boolean;
  /** The whole row is inert, as when a read-only mode owns the document. */
  disabled?: boolean;
  /**
   * Offered here but not honoured here. `disabled` fires no click, so a
   * control that has something to say cannot be disabled; this one stays
   * pressable and dimmed, and the caller points `onChange` at whatever says
   * it.
   */
  unavailable?: boolean;
  onChange: (value: T) => void;
  className?: string;
}) {
  const at = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const track = useRef<HTMLDivElement | null>(null);
  // A fitted thumb is measured, not computed: the cells are as wide as their
  // words. A layout effect puts the thumb under the new cell in the same frame
  // the colour moves to it. It runs on every render, not keyed on `value`,
  // because a language change moves every cell without changing the choice,
  // and on a resize, because resizing the panel re-shares the spare width.
  useLayoutEffect(() => {
    const row = track.current;
    if (!fit || !row) return;
    const place = () => {
      const chosen = row.querySelector<HTMLElement>(
        'button[aria-pressed="true"]',
      );
      if (!chosen) return;
      // Rectangles, not `offsetLeft`/`offsetWidth`, which round to whole
      // pixels while fitted cells are fractional. The track has no border, so
      // its box edge is the origin the thumb's `left: 0` measures from.
      // Rectangles are what a transform draws, so a panel measured midway
      // through a scaled entrance is divided back out by the track's
      // drawn-to-laid-out ratio.
      const cell = chosen.getBoundingClientRect();
      const origin = row.getBoundingClientRect();
      const scale = origin.width ? row.offsetWidth / origin.width : 1;
      row.style.setProperty(
        "--thumb-x",
        `${(cell.left - origin.left) * scale}px`,
      );
      row.style.setProperty("--thumb-w", `${cell.width * scale}px`);
    };
    place();
    // The thumb's travel is animated only once it has been placed. Reading
    // the layout resolves the thumb's style before the measurement lands, so
    // without this the first placement would grow the thumb from nothing on
    // every mount. The flag is set a frame later, so the switch to animating
    // and the first value are not one style change.
    const glide =
      row.dataset.placed === "1"
        ? 0
        : requestAnimationFrame(() => {
            row.dataset.placed = "1";
          });
    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(glide);
    }
    const watch = new ResizeObserver(place);
    watch.observe(row);
    return () => {
      cancelAnimationFrame(glide);
      watch.disconnect();
    };
  });
  return (
    <div
      ref={track}
      className={["ui-bar-track", className ?? ""].filter(Boolean).join(" ")}
      data-seat={seat}
      data-fit={fit ? "1" : undefined}
      role="group"
      aria-label={label}
      data-unavailable={unavailable ? "1" : undefined}
      style={
        {
          "--track-w": `${cell}px`,
          "--track-at": at,
          // The cell count, for stylesheets that size something as a
          // fraction of the track rather than as a fixed cell: a track
          // fitting a narrow panel shrinks its cells, and a thumb measured in
          // `--track-w` would miss them.
          "--track-n": options.length,
        } as React.CSSProperties
      }
    >
      <span className="ui-bar-track-thumb" aria-hidden />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={option.value === value}
          data-attention={
            option.attention && option.value !== value ? "1" : undefined
          }
          data-busy={option.busy && option.value !== value ? "1" : undefined}
          disabled={disabled}
          aria-disabled={unavailable || undefined}
          data-tip=""
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? (
            <Icon name={option.icon} size={15} data-icon={option.icon} />
          ) : null}
          {option.text ? <span aria-hidden>{option.text}</span> : null}
          <Tip label={option.label} shortcut={option.shortcut} />
        </button>
      ))}
    </div>
  );
}

/**
 * A control's tooltip. It is a child of the control, where `:hover` and
 * `:focus-visible` drive it with no script, unless the control sits in a
 * scrollport. A scrollport clips whatever hangs below its box, which is where
 * a tip is, and the editor's bar scrolls horizontally in a narrow window. So
 * a tip whose trigger is inside `.bar-stack` (the editor bar), or inside any
 * scrollport marked `data-tips-out` (such as the import's chapter list), is
 * portaled to `document.body`, pinned to the viewport, and follows its
 * trigger across scrolls.
 *
 * The portaled path keeps the stylesheet's contract in script: the delay
 * token `--d-tip`, and the bar's `data-tips="warm"` group warmth, under which
 * tips arrive instantly.
 */
export function Tip({ label, shortcut }: { label: string; shortcut?: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [portaled, setPortaled] = useState(false);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const openRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trigger = anchorRef.current?.parentElement;
    if (!trigger || !trigger.closest(".bar-stack, [data-tips-out]")) return;
    setPortaled(true);

    const delayMs = () => {
      if (trigger.closest(".ui-bar")?.getAttribute("data-tips") === "warm")
        return 0;
      const raw = getComputedStyle(trigger).getPropertyValue("--d-tip");
      const ms = parseFloat(raw);
      return Number.isFinite(ms) ? ms : 460;
    };
    const measure = () => {
      const rect = trigger.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 9 });
    };
    const show = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      measure();
      openRef.current = true;
      setOpen(true);
      timer.current = setTimeout(() => setShown(true), delayMs());
    };
    const hide = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      setShown(false);
      openRef.current = false;
      // Keep it mounted for one fade, then drop it.
      timer.current = setTimeout(() => setOpen(false), 120);
    };
    const reposition = () => {
      if (openRef.current) measure();
    };

    trigger.addEventListener("pointerenter", show);
    trigger.addEventListener("pointerleave", hide);
    trigger.addEventListener("focusin", show);
    trigger.addEventListener("focusout", hide);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      trigger.removeEventListener("pointerenter", show);
      trigger.removeEventListener("pointerleave", hide);
      trigger.removeEventListener("focusin", show);
      trigger.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [label, shortcut]);

  const content = (
    <>
      {label}
      {shortcut ? <span className="ui-kbd">{shortcut}</span> : null}
    </>
  );

  return (
    <>
      <span ref={anchorRef} className="ui-tip-anchor" aria-hidden />
      {portaled && open && pos
        ? createPortal(
            <span
              className="ui-tip ui-tip-portal"
              role="tooltip"
              data-open={shown ? "1" : "0"}
              style={{ left: pos.x, top: pos.y }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
      {!portaled && (
        <span className="ui-tip" role="tooltip">
          {content}
        </span>
      )}
    </>
  );
}

/**
 * The find field: one box that changes shape. The input stays mounted and is
 * clipped while the box is a circle, so nothing is swapped and the width
 * transition can run.
 *
 * Its open state is CSS: `:focus-within` expands it, so it collapses on blur
 * with no script. `data-query` pins it open while a query narrows the list,
 * because a shortened list whose control has folded away hides why it is
 * short.
 */
export function CommandBarFind({
  label,
  placeholder,
  value,
  onChange,
  count,
  clearLabel,
  busy,
  open,
  inputRef,
  onFocus,
  onBlur,
  onEscape,
  className,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * What the query turned up, drawn inside the field's trailing edge and only
   * while something is typed. A count outside the field would widen the bar
   * on the first keystroke and narrow it on the last.
   *
   * It is always announced, and only sometimes drawn: a caller with no room
   * to paint a number passes one wrapped in `.ui-visually-hidden`, as the
   * structure panel does at 248px, where a painted count would cover the
   * query. A screen-reader user told nothing finds a different list by
   * walking into it.
   */
  count?: React.ReactNode;
  /**
   * The accessible name of the field's clear (✕) command, drawn beside the
   * count while something is typed. Clicking it empties the field.
   * `preventDefault` on mousedown keeps the caret in the field, so clearing
   * never moves focus mid-typing.
   */
  clearLabel?: string;
  /**
   * The caller is still gathering what it needs to answer this query, drawn
   * in the clear command's slot instead of it. Busy replaces clear, never
   * sits beside it: two things in the tail would overlap or widen the field.
   * The field still takes every key, so backspace and select-all still empty
   * it.
   */
  busy?: React.ReactNode;
  /**
   * Held open by the caller, whatever is typed in it. The structure panel's
   * find replaces the panel's body, and a field that folded on blur would
   * leave that face with nothing to close it. Without it the field keeps the
   * two CSS routes.
   *
   * It feeds `data-query`, so the box being open and the face being up are
   * one boolean rather than two that can disagree.
   */
  open?: boolean;
  /** The editor opens find from a shortcut, so it needs the field itself. */
  inputRef?: React.Ref<HTMLInputElement>;
  onFocus?: () => void;
  onBlur?: () => void;
  /**
   * What Escape does with a query typed in the field.
   *
   * Left to the browser, a `type=search` input's Escape-clear is
   * engine-dependent (Blink fires an input event and clears; other engines
   * may do nothing), while the editor's in-document find closes on Escape
   * mid-query. The caller owns the open state, so it owns the key: with a
   * handler, Escape performs it, and clearing the field is that handler's job
   * through the caller's `onChange("")`. Without one, only the empty-field
   * blur applies.
   */
  onEscape?: () => void;
  /**
   * A scoping class on the wrapper, for a caller whose room differs from the
   * bar's. It carries the caller's token overrides (`--bar-act` and the like)
   * and nothing else; the control is the same everywhere. The structure
   * panel's rail rule and one e2e locator aim at it.
   */
  className?: string;
}) {
  const id = useId();
  const typed = value.trim().length > 0;
  // `expanded` is whether the box is a field rather than a circle; `typed` is
  // whether it holds a query. The clear command and the count follow `typed`,
  // since an empty field has nothing to clear or count. The shape and the
  // waiting figure follow `expanded`, because a caller that opens the field to
  // start gathering has something to show before anything is typed.
  const expanded = open === true || typed;

  // A bar too wide for its window scrolls, and focus brings only the resting
  // circle into view: the field then grows past the edge, its query and its
  // clear command off the screen. So while the field is open, each change of
  // its width scrolls the whole of it into view. A box that already shows it
  // whole does not move.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const field = box.current;
    if (!field || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (field.dataset.query !== "1" && !field.matches(":focus-within"))
        return;
      field.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    ro.observe(field);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={box}
      className={`ui-bar-find${className ? ` ${className}` : ""}`}
      data-query={expanded ? "1" : "0"}
    >
      <label className="ui-bar-find-sigil" htmlFor={id}>
        <Icon name={appIcons.search} size={16} data-icon={appIcons.search} />
        <span className="ui-visually-hidden">{label}</span>
      </label>
      <input
        id={id}
        ref={inputRef}
        type="search"
        className="ui-bar-find-input"
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        // The browser's dropdown of past searches is refused. A `type=search`
        // input offers one on focus, and here it lands over the results this
        // control filters, listing queries typed into other projects. It is
        // also not history the writer can manage: it survives sign-out, and
        // the app neither put it there nor can clear it.
        autoComplete="off"
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // With a query set, the key belongs to `onEscape` when the caller
          // passes one.
          if (value.trim().length > 0) {
            if (onEscape) {
              event.preventDefault();
              onEscape();
            }
            return;
          }
          // An empty field folds away: blur is what the CSS watches.
          event.currentTarget.blur();
        }}
      />
      {/* The count and the clear command share one slot at the trailing edge,
          so they never overlap and the field's right padding clears a single
          cluster. Both appear and vanish with the query.

          The slot and its live region stay mounted. A live region inserted
          together with its first content is unreliably announced, so the
          first result count could go unannounced. An empty tail
          paints nothing: it is absolutely positioned and takes no pointer.

          The count keeps its own element and mounts only with a count,
          because its entrance fade is an animation on mount
          (`.ui-bar-find-count` in `base.css`). A fade on the live container
          would run once on nothing and make the number's arrival a cut. */}
      <span className="ui-bar-find-tail">
        <span className="ui-bar-find-live" aria-live="polite">
          {typed && count !== undefined && (
            <span className="ui-bar-find-count">{count}</span>
          )}
        </span>
        {expanded && busy ? (
          <span className="ui-bar-find-busy">{busy}</span>
        ) : (
          typed &&
          clearLabel && (
            <button
              type="button"
              className="ui-bar-find-clear"
              aria-label={clearLabel}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange("")}
            >
              <Icon name={appIcons.close} size={13} />
            </button>
          )
        )}
      </span>
    </div>
  );
}
