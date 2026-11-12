// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

// ── The text field ───────────────────────────────────────────────────────────
//
// A text field with a line underneath that shows what the input will produce
// (`once-dark/` for "Once Dark"), in mono because it is a result. When the
// value is refused, the same line carries the reason: one line, two jobs, no
// layout shift between them.
//
// The fields share the frame around the control (label, flag, note, and the
// ids that tie them to it) and differ in the control alone: `Input` is one
// line, `WrapInput` is one line that wraps, `AreaInput` is several
// lines. Separate components, not a `multiline` boolean, because the
// control's ref and event types differ and a boolean would type both as the
// looser of the two.

interface FrameProps {
  label: string;
  /**
   * The label stays for a screen reader and leaves the screen: a field whose
   * name is already drawn beside it (a query in a row the writer ticks) would
   * say it twice. `Select` does the same.
   */
  labelHidden?: boolean;
  /** What this input will produce. Mono, because it is a result, not prose. */
  evidence?: React.ReactNode;
  /** Why it was refused. Replaces the evidence and marks the field invalid. */
  problem?: string | null;
  /**
   * A fact about what is typed that the writer should weigh before it is
   * used; not a refusal, so no crimson and no invalid state. Drawn between
   * the field and the note, in ink, and only when present. Not live: the
   * caller decides whether and when it is spoken.
   */
  flag?: React.ReactNode;
}

interface FrameIds {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
}

/** The ids the frame gives its control, from the caller's props. */
function useFrame(
  id: string | undefined,
  { evidence, problem, flag }: FrameProps,
  describedBy: string | undefined,
): FrameIds {
  const auto = useId();
  const controlId = id ?? auto;
  const note = problem ?? evidence;
  // Merged, never replaced: a caller's own description (a row's count, a
  // hint elsewhere on the page) and the frame's both describe the field.
  const ids = [
    describedBy,
    flag ? `${controlId}-flag` : undefined,
    note ? `${controlId}-note` : undefined,
  ].filter(Boolean);
  return {
    controlId,
    describedBy: ids.length > 0 ? ids.join(" ") : undefined,
    invalid: !!problem,
  };
}

function Frame({
  label,
  labelHidden,
  evidence,
  problem,
  flag,
  controlId,
  invalid,
  children,
}: FrameProps & FrameIds & { children: React.ReactNode }) {
  const note = problem ?? evidence;
  return (
    <div className="ui-input-field">
      <label
        className={
          labelHidden ? "ui-input-label ui-visually-hidden" : "ui-input-label"
        }
        htmlFor={controlId}
      >
        {label}
      </label>
      {children}
      {flag ? (
        <p
          id={`${controlId}-flag`}
          className="ui-input-note ui-input-note-flag"
        >
          {flag}
        </p>
      ) : null}
      {note && (
        <p
          id={`${controlId}-note`}
          className={`ui-input-note${invalid ? " ui-input-note-bad" : ""}`}
          // A refusal appears while the writer types, so it is announced. The
          // evidence line changes on every keystroke and would be unbearable
          // read aloud.
          aria-live={invalid ? "polite" : undefined}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function fieldClass(invalid: boolean, ...more: Array<string | undefined>) {
  return ["ui-input", ...more, invalid ? "ui-input-bad" : ""]
    .filter(Boolean)
    .join(" ");
}

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    FrameProps {}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    labelHidden,
    evidence,
    problem,
    flag,
    id,
    className,
    "aria-describedby": describedBy,
    ...rest
  },
  ref,
) {
  const frame = { label, labelHidden, evidence, problem, flag };
  const ids = useFrame(id, frame, describedBy);
  return (
    <Frame {...frame} {...ids}>
      <input
        ref={ref}
        id={ids.controlId}
        className={fieldClass(ids.invalid, className)}
        aria-invalid={ids.invalid || undefined}
        aria-describedby={ids.describedBy}
        // A name field answers a folder-naming question, not a prose one: no
        // browser squiggles under what is about to become a directory name.
        spellCheck={false}
        {...rest}
      />
    </Frame>
  );
});

export default Input;

// ── One line that wraps ──────────────────────────────────────────────────────
//
// A single-line value the writer must be able to read whole before it is
// used, such as a search query about to leave for a third party: in a
// 280px column a one-line `input` hides the query's tail, the part a writer
// needs to check. So the field wraps and grows to its content and never
// becomes prose: Enter adds no newline (the caller's `onKeyDown` still hears
// it), and a line break that arrives by paste becomes a space.
//
// Rules about what may be typed, such as a length cap or a normal form, stay
// with the caller, which knows what the value is for. The kit owns the shape.

/**
 * What a paste can leave in the value that would break the line. Only LF: a
 * textarea's value turns CR and CRLF into LF before any handler sees it (the
 * HTML spec's normalisation). U+2028 and U+2029 draw no break in a textarea
 * but are line terminators to everything downstream, so they go too. Each is
 * one code unit, so a replacement keeps every offset.
 */
const BREAKS = /[\n\u2028\u2029]/g;
/** Whether there is one: no `g`, so no `lastIndex` carried between calls. */
const HAS_BREAK = /[\n\u2028\u2029]/;

export interface WrapInputProps
  extends
    Omit<
      React.TextareaHTMLAttributes<HTMLTextAreaElement>,
      "rows" | "value" | "defaultValue" | "children"
    >,
    FrameProps {
  /** Controlled only: the height is measured from it. */
  value: string;
}

export const WrapInput = forwardRef<HTMLTextAreaElement, WrapInputProps>(
  function WrapInput(
    {
      label,
      labelHidden,
      evidence,
      problem,
      flag,
      id,
      className,
      value,
      placeholder,
      onChange,
      onKeyDown,
      "aria-describedby": describedBy,
      ...rest
    },
    ref,
  ) {
    const frame = { label, labelHidden, evidence, problem, flag };
    const ids = useFrame(id, frame, describedBy);
    const field = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(ref, () => field.current as HTMLTextAreaElement, []);
    useAutoGrow(field, value, placeholder);
    return (
      <Frame {...frame} {...ids}>
        <textarea
          ref={field}
          id={ids.controlId}
          className={fieldClass(ids.invalid, "ui-input-wrap", className)}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-invalid={ids.invalid || undefined}
          aria-describedby={ids.describedBy}
          spellCheck={false}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            // An IME's composing Enter belongs to the IME: it commits the
            // candidate and inserts no newline. The app's other Enter
            // handlers (the composer, a turn's edit) leave it alone too.
            if (event.key === "Enter" && !event.nativeEvent.isComposing)
              event.preventDefault();
          }}
          onChange={(event) => {
            const element = event.currentTarget;
            if (HAS_BREAK.test(element.value)) {
              // The caret stays where the paste left it: every break is one
              // code unit and becomes one space, so its offset holds.
              const at = element.selectionStart ?? element.value.length;
              element.value = element.value.replace(BREAKS, " ");
              element.setSelectionRange(at, at);
            }
            onChange?.(event);
          }}
          {...rest}
        />
      </Frame>
    );
  },
);

// ── Several lines ────────────────────────────────────────────────────────────
//
// Text whose lines are its meaning, such as a manuscript's contact block.
// `WrapInput` turns a line break into a space, so this is a third shape of
// the same frame, not a flag on the second.

export interface AreaInputProps
  extends
    Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "children">,
    FrameProps {}

export const AreaInput = forwardRef<HTMLTextAreaElement, AreaInputProps>(
  function AreaInput(
    {
      label,
      labelHidden,
      evidence,
      problem,
      flag,
      id,
      className,
      "aria-describedby": describedBy,
      ...rest
    },
    ref,
  ) {
    const frame = { label, labelHidden, evidence, problem, flag };
    const ids = useFrame(id, frame, describedBy);
    return (
      <Frame {...frame} {...ids}>
        <textarea
          ref={ref}
          id={ids.controlId}
          className={fieldClass(ids.invalid, className)}
          aria-invalid={ids.invalid || undefined}
          aria-describedby={ids.describedBy}
          spellCheck={false}
          {...rest}
        />
      </Frame>
    );
  },
);

/**
 * The field's height follows its content, by the same rules as the
 * composer's measure (`AiComposer.tsx`).
 *
 * - `height = "auto"` first: `scrollHeight` cannot report less than an
 *   explicit height, so a shortened value would keep the tallest box.
 * - A layout effect, so the box is right in the frame of the keystroke.
 * - The placeholder is a dependency: `scrollHeight` counts an empty field's
 *   placeholder, and a language switch changes it with neither the value nor
 *   the width moving.
 * - A `ResizeObserver` for width, which no prop carries: a resized dock
 *   re-wraps the same text. It hears only a change of the box's size; a
 *   webfont landing late re-wraps the text without one and is not measured
 *   for, since the editor's fonts load long before a model run can pose a
 *   query.
 *
 * Plus the 2px of borders: the field is `border-box` and `scrollHeight`
 * counts padding and content only.
 */
function useAutoGrow(
  field: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  placeholder: string | undefined,
) {
  const measure = useCallback(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [field]);
  useLayoutEffect(measure, [measure, value, placeholder]);
  useEffect(() => {
    const element = field.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    // Width only: the measure itself changes the height, and re-measuring on
    // that would loop.
    let width = element.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (element.offsetWidth === width) return;
      width = element.offsetWidth;
      measure();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [field, measure]);
}
