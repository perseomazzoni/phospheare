// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef } from "react";
import { Button } from "../../ui";
import { BrandMark } from "../../brand/BrandMark";
import { somethingBroke, type Fault } from "../domain/fault";
import { faultT } from "./faultCopy";

// The page a failure leaves the writer on: what happened in their language,
// and a way forward. It uses the plain page shell every theme already paints
// (`.page`, `.page-title`, `.page-hint`), so it needs no look of its own.
//
// The brand's figure heads it. Where something broke, its spark goes out and
// leaves a hole in the chest; a newer build or a wrong address breaks
// nothing, and the spark stays lit.
//
// It never renders the thrown value. A message or a stack is English
// internals, and it can name a path, a project id or a fragment of a request.
// The console has the error; the page has the kind.

export interface FaultScreenProps {
  fault: Fault;
  /**
   * Where the way back leads: the Library for a signed-in writer, the home
   * page otherwise, or when nothing is known about who is here.
   */
  home: "library" | "landing";
  onReload: () => void;
  /** Called while the page is on screen; the returned function is its end. */
  onShown?: () => () => void;
}

export default function FaultScreen({
  fault,
  home,
  onReload,
  onShown,
}: FaultScreenProps) {
  const title = useRef<HTMLHeadingElement>(null);

  // The page replaces whatever the writer was looking at, and focus would
  // stay on a removed node. The title takes it, and a screen reader starts
  // from what happened.
  useEffect(() => title.current?.focus(), []);
  useEffect(() => onShown?.(), [onShown]);

  const back =
    home === "library"
      ? { href: "/app", label: faultT("fault.backToLibrary") }
      : { href: "/", label: faultT("fault.backHome") };

  return (
    <div className="page fault-page" data-fault={fault.kind}>
      <div className="page-inner narrow">
        <BrandMark size={56} out={somethingBroke(fault.kind)} />
        <h1 className="page-title" ref={title} tabIndex={-1}>
          {faultT(`fault.${fault.kind}.title`)}
        </h1>
        <p className="page-hint">{faultT(`fault.${fault.kind}.hint`)}</p>
        <div className="page-actions">
          {fault.kind === "not-found" ? (
            <a className="ui-btn ui-btn-primary" href={back.href}>
              {back.label}
            </a>
          ) : (
            <>
              <Button variant="primary" onClick={onReload}>
                {faultT("fault.reload")}
              </Button>
              <a className="ui-text-link ui-text-link-row" href={back.href}>
                {back.label}
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
