// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProjectState } from "../ProjectContext";
import { memoryProvider } from "../../storage/memoryProvider";
import { useSchemeFlip } from "../../theme/editor";
import { Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import WritingPreferences from "./WritingPreferences";

/**
 * Where the project lives, and how the writer likes to write.
 */
export default function PanelFoot({
  panelRef,
  sheet,
  rail,
}: {
  panelRef: React.RefObject<HTMLElement | null>;
  sheet: boolean;
  rail: boolean;
}) {
  const { t } = useTranslation();
  const { provider } = useProjectState();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const closePrefs = useCallback(() => setPrefsOpen(false), []);
  // Light and dark only: which theme is chosen in Settings. Light or dark is
  // the choice a writer makes mid-sentence as the room changes, so it stays
  // within reach.
  const { label: variant, flip: nextTheme } = useSchemeFlip();
  return (
    <>
      <div className="dt-foot">
        {/* Named, for a theme that draws the place its own way. */}
        <Icon name={provider.icon} size={14} data-icon={provider.icon} />
        <span className="dt-foot-where">{provider.label()}</span>
        {/* Identification, not dispatch: the demo states that its edits
          live in memory and a reload discards them. The id comparison
          names the provider for the hint and decides no behaviour. */}
        {provider.id === memoryProvider.id && (
          <span className="dt-foot-demo-hint">{t("storage.demoIsMemory")}</span>
        )}
        <span className="ui-spacer" />
        <button
          type="button"
          className="dt-foot-act dt-foot-theme"
          aria-label={t("settings.themeVariant")}
          onClick={nextTheme}
        >
          <Icon name={appIcons.look} size={14} />
          <span>{variant}</span>
        </button>
        <button
          type="button"
          className="dt-foot-act"
          aria-label={t("tree.writingPreferences")}
          aria-expanded={prefsOpen}
          ref={gearRef}
          onClick={(e) => {
            e.stopPropagation();
            // The card floats over the prose, so the gear opens it on the
            // rail too; it never widens the structure panel.
            setPrefsOpen((v) => !v);
          }}
        >
          <Icon name={appIcons.settings} size={14} />
        </button>
      </div>
      <WritingPreferences
        open={prefsOpen}
        onClose={closePrefs}
        gearRef={gearRef}
        panelRef={panelRef}
        sheet={sheet}
        rail={rail}
      />
    </>
  );
}
