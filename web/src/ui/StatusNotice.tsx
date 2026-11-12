// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A standing status, said once, out of the way. Two can be true at once, so
// notices stack in one fixed column owned by `App`, and any notice in either
// half joins it through a portal: two `position: fixed` pills placed by their
// own rules would cover each other.
//
// The portal lets the editor's save state reach that column without lifting
// it to the root, which would drag a piece of the editor's state into the file
// that alone may know both halves exist.

export const NOTICE_STACK_ID = "status-notices";

export default function StatusNotice({
  tone = "attention",
  className,
  children,
  action,
}: {
  /**
   * `attention` is recoverable and self-clearing; `alert` needs the writer;
   * `loss` says something is already gone, in the crimson the column keeps
   * for that.
   *
   * There is no tone for good news: the save chip says what is right, in
   * place.
   */
  tone?: "attention" | "alert" | "loss";
  className?: string;
  children: ReactNode;
  /**
   * A control after the words, for a notice that cannot clear itself, such
   * as a lost change (`loss`).
   */
  action?: ReactNode;
}) {
  // The stack is rendered by `App`, which mounts before either half's routes,
  // but a portal target must exist as a DOM node before `createPortal` is
  // called, and on the first render of a lazily loaded editor it may not be
  // committed yet. Resolving it in an effect keeps that render from throwing,
  // at the cost of one extra pass.
  const [stack, setStack] = useState<HTMLElement | null>(null);
  useEffect(() => setStack(document.getElementById(NOTICE_STACK_ID)), []);

  const notice = (
    // No `role` and no `aria-live` here. `DeviceNotice`'s text carries a count
    // that moves on every save, and a polite region re-announces on every
    // change ("4 files... 2 files...") at a writer mid-sentence.
    //
    // A region cannot sit on the pill either, because a region inserted
    // together with its first content is unreliably announced,
    // and these pills mount and unmount with their condition. So the
    // announcement belongs to permanent regions owned by `App`, which outlive
    // every pill and carry a sentence with no number in it, so they announce
    // once when the condition arrives and stay silent while the count moves.
    //
    // Not a prop: an option would give one component two grammars, a notice
    // that speaks and one that does not, decided by whoever calls it.
    <div
      className={["status-notice", className].filter(Boolean).join(" ")}
      data-tone={tone}
    >
      <span className="status-notice-dot" aria-hidden="true" />
      {children}
      {action}
    </div>
  );

  // Rendered in place, not withheld, while the stack is missing: a notice that
  // waits for its container is a notice the writer does not get, and the CSS
  // positions it correctly either way.
  return stack ? createPortal(notice, stack) : notice;
}
