// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { Link } from "react-router";
import type { ProjectStatus } from "../ProjectContext";
import type { ProjectRef } from "../../storage";
import type { StructureError } from "../../project/types";
import { Button, Dots } from "../../ui";

/**
 * The face the panel shows instead of the tree, or null when the tree can
 * draw: an unsupported browser, a project still loading, a folder waiting
 * for its permission, or a folder refused.
 */
export function stateFace({
  isSupported,
  status,
  pendingRef,
  validation,
  reconnect,
  reload,
  t,
}: {
  isSupported: boolean;
  status: ProjectStatus;
  pendingRef: ProjectRef | null;
  validation: readonly StructureError[];
  reconnect: () => Promise<unknown>;
  reload: () => Promise<unknown>;
  t: TFunction;
}): ReactNode {
  if (!isSupported) {
    return (
      <State
        title={t("tree.unsupportedTitle")}
        hint={t("tree.unsupportedBrowser")}
      />
    );
  }

  if (status === "loading") {
    return (
      <div className="dt-state">
        <Dots label={t("tree.loading")} />
      </div>
    );
  }

  if (pendingRef) {
    return (
      <State title={pendingRef.name} hint={t("tree.reconnectHint")}>
        <Button variant="soft" onClick={() => void reconnect()}>
          {t("tree.reconnect")}
        </Button>
      </State>
    );
  }

  if (status === "invalid") {
    // Two failures, two faces. A folder with no properties file is not a
    // project, and the only recovery is to leave: "Try again" would re-read
    // the same bytes to the same verdict. A damaged project, whose
    // properties parse but fail validation, keeps the exact diagnostics and
    // Try again, because fixing the file on disk and re-reading heals it.
    const emptyFolder = validation.every(
      (problem) => problem.code === "missingProperties",
    );
    return (
      <div className="dt-state dt-invalid">
        <p className="dt-state-title">{t("tree.cannotOpen")}</p>
        {emptyFolder ? (
          <p className="dt-problem-line">{t("structure.notAProject")}</p>
        ) : (
          <ul className="dt-problems">
            {validation.map((problem, i) => (
              <li key={i}>{describe(t, problem)}</li>
            ))}
          </ul>
        )}
        {emptyFolder ? (
          <Link to="/app" className="ui-btn ui-btn-soft">
            {t("titlebar.backToLibrary")}
          </Link>
        ) : (
          <Button variant="soft" onClick={() => void reload()}>
            {t("tree.tryAgain")}
          </Button>
        )}
      </div>
    );
  }
  return null;
}

/** A validation failure in the writer's language, with its line if known. */
function describe(t: TFunction, problem: StructureError): string {
  const text = t(`structure.${problem.code}`, problem.values ?? {});
  return problem.line
    ? t("structure.atLine", { line: problem.line, detail: text })
    : text;
}

function State({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="dt-state">
      <p className="dt-state-title">{title}</p>
      <p className="dt-state-hint">{hint}</p>
      {children}
    </div>
  );
}
