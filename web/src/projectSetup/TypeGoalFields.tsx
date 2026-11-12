// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { Input, Select, type SelectOption } from "../ui";
import {
  DOCUMENT_TYPE_OPTIONS,
  OTHER_DOCUMENT_TYPE,
  documentTypeGuideKey,
  documentTypeLabel,
} from "../project/types";

// The type and the goal as fields, shared like `GenreFields` by the create
// wizard's Type step and the Library's Properties window, so the rules
// cannot drift:
//
// - The type is a named option, or Other, which stores only the text the
//   writer typed, never the word "Other".
// - The goal is required and a safe positive integer: the spine is measured
//   against it, and a number that cannot be stored is refused, not dropped.
//
// Each home handles a type change its own way. The wizard prefills the goal
// from the type until the writer types one; the Properties window
// never does, because a stored goal is already the writer's.

/** The longest custom type kept: a label, not a sentence. */
const CUSTOM_TYPE_MAX = 60;

export interface TypeGoalValue {
  /** The select's value: a named option, or `OTHER_DOCUMENT_TYPE`. */
  type: string;
  /** The text typed for Other. */
  customType: string;
  goalText: string;
}

/** What the fields say, read the same way in both homes. */
interface TypeGoalReading {
  /** The type as stored: the named option, or the custom text for Other. */
  stored: string;
  /** The goal as stored, or `null` while there is none that can be stored. */
  goal: number | null;
  /** Empty where a goal is required. */
  goalEmpty: boolean;
  goalUnusable: boolean;
  otherNeedsText: boolean;
  /** Every rule holds: the step may advance, the window may save. */
  ready: boolean;
}

/**
 * Reads the fields. `goalOptional` is for a book with no goal stored, such as
 * a hand-edited file: the writer need not invent a number to change the
 * genre, so an empty goal keeps the book without one. A typed goal is still
 * held to the integer rule.
 */
export function readTypeGoal(
  value: TypeGoalValue,
  { goalOptional = false }: { goalOptional?: boolean } = {},
): TypeGoalReading {
  const raw = value.goalText.trim();
  const parsed = raw ? Number(raw) : NaN;
  const goal = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  const goalEmpty = raw === "" && !goalOptional;
  const goalUnusable = raw !== "" && goal === null;
  const other = value.type === OTHER_DOCUMENT_TYPE;
  const otherNeedsText = other && !value.customType.trim();
  return {
    stored: other ? value.customType.trim() : value.type,
    goal,
    goalEmpty,
    goalUnusable,
    otherNeedsText,
    ready: !otherNeedsText && !goalEmpty && !goalUnusable,
  };
}

/**
 * The fields' value for a type already stored: a named option is itself,
 * anything else was typed for Other and goes back into Other's field.
 */
export function typeGoalFor(type: string, goal: number | null): TypeGoalValue {
  const named = (DOCUMENT_TYPE_OPTIONS as readonly string[]).includes(type);
  return {
    type: named ? type : OTHER_DOCUMENT_TYPE,
    customType: named ? "" : type,
    goalText: goal === null ? "" : String(goal),
  };
}

interface Props {
  value: TypeGoalValue;
  /**
   * `readTypeGoal(value)`, read once by the caller, which gates its Continue
   * or Save on it, so the fields and the gate answer from one reading.
   */
  reading: TypeGoalReading;
  onType: (type: string) => void;
  onCustomType: (text: string) => void;
  onGoal: (text: string) => void;
  /**
   * Whether Other's field has been touched. Its refusal waits for a touch:
   * choosing Other is not yet a mistake, and the placeholder names what is
   * wanted. A gated press counts as the touch.
   */
  customTouched: boolean;
  onCustomTouched: () => void;
  typeRef?: Ref<HTMLSelectElement>;
  goalRef?: Ref<HTMLInputElement>;
  customRef?: Ref<HTMLInputElement>;
}

export default function TypeGoalFields({
  value,
  reading,
  onType,
  onCustomType,
  onGoal,
  customTouched,
  onCustomTouched,
  typeRef,
  goalRef,
  customRef,
}: Props) {
  const { t } = useTranslation();

  const types: SelectOption<string>[] = useMemo(
    () =>
      [...DOCUMENT_TYPE_OPTIONS, OTHER_DOCUMENT_TYPE].map((option) => ({
        value: option,
        // Stored in English, shown in the writer's language.
        label: documentTypeLabel(option, t),
      })),
    [t],
  );

  // Other has no guidance: its range is whatever the writer means by it.
  const guide = documentTypeGuideKey(value.type);

  return (
    <>
      <div className="create-grid">
        <Select
          ref={typeRef}
          label={t("create.typeLabel")}
          options={types}
          value={value.type}
          onChange={onType}
          note={guide ? t(guide) : undefined}
        />
        <Input
          ref={goalRef}
          label={t("create.goalLabel")}
          placeholder={t("create.goalPlaceholder")}
          type="number"
          min={1}
          step={1}
          autoComplete="off"
          value={value.goalText}
          onChange={(event) => onGoal(event.target.value)}
          evidence={t("create.goalHint")}
          // A goal that cannot be stored is refused aloud: the field keeps
          // the text and the problem line says why.
          problem={
            reading.goalUnusable
              ? t("create.goalInvalid")
              : reading.goalEmpty
                ? t("create.goalRequired")
                : null
          }
        />
      </div>
      {value.type === OTHER_DOCUMENT_TYPE && (
        <Input
          ref={customRef}
          label={t("create.customTypeLabel")}
          placeholder={t("create.customTypePlaceholder")}
          autoComplete="off"
          maxLength={CUSTOM_TYPE_MAX}
          value={value.customType}
          onChange={(event) => {
            onCustomTouched();
            onCustomType(event.target.value);
          }}
          onBlur={onCustomTouched}
          problem={
            reading.otherNeedsText && customTouched
              ? t("create.customTypeRequired")
              : null
          }
        />
      )}
    </>
  );
}
