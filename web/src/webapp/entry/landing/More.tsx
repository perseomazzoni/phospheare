// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../../ui";
import { motionIsStill } from "../../../ui/motion";

/**
 * A fold the visitor opens. Closed, the start of its content shows through
 * a fade into the page, so there is visibly more, and the toggle under it
 * names what. The clipped rest is inert until the fold opens, so focus and
 * screen readers stop at the toggle instead of inside text half shown.
 *
 * The body grows from the peek to its own height, measured at the toggle,
 * and once there lets go of the height, the clip and the fade: a later
 * resize cannot cut it short, and the cards' shadows inside are not cut at
 * the edge. Closing runs the same way back.
 */
export default function More({
  label,
  className,
  children,
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const body = useRef<HTMLDivElement>(null);

  // `data-settled` is the open body at rest: no height, no clip, no fade.
  const settle = (node: HTMLDivElement) => {
    node.style.maxHeight = "";
    node.dataset.settled = "";
  };

  const toggle = () => {
    const node = body.current;
    if (node) {
      const height = node.scrollHeight;
      delete node.dataset.settled;
      node.style.maxHeight = `${height}px`;
      if (open) {
        // From the open height back to the peek: the start is laid out
        // first, so the stylesheet's peek has a height to run from.
        void node.offsetHeight;
        node.style.maxHeight = "";
      } else if (motionIsStill()) {
        settle(node);
      }
    }
    setOpen(!open);
  };

  return (
    <div
      className={`landing-more${className ? ` ${className}` : ""}`}
      data-open={open ? "" : undefined}
    >
      <div
        ref={body}
        id={bodyId}
        className="landing-more-body"
        inert={!open}
        onTransitionEnd={(event) => {
          if (open && event.target === body.current) settle(body.current);
        }}
      >
        {children}
      </div>
      <button
        type="button"
        className="landing-more-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
      >
        {label}
        <Icon name="chevron" size={18} />
      </button>
    </div>
  );
}
