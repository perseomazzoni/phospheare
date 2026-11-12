// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { prefetchSheets, useTheme } from "../../../theme";
import { SegmentedControl } from "../../../ui";
import ThemeTile from "../../shared/ThemeTile";
import { shown, useInView } from "./useInView";

// ── The page in another light ────────────────────────────────────────────────
//
// The closing reveal: theme tiles and the switch between once dark and
// still dark. Both use the app's theme choice, so its screens change with
// the page.

/** Every theme as a tile drawn in its own tokens, and the variant beneath. */
export function ThemePicker() {
  const { t } = useTranslation();
  const { theme, families, setFamily, setScheme } = useTheme();
  // The other themes' sheets are fetched as the tiles come near, so a
  // choice goes on at once and a visitor who never gets here fetches none.
  const [ref, near] = useInView<HTMLDivElement>({ margin: "600px 0px" });
  const [revealRef, seen] = useInView<HTMLDivElement>();
  useEffect(() => {
    if (near) prefetchSheets();
  }, [near]);

  const family = families.find((one) => one.id === theme.family);
  const variants = (["light", "dark"] as const).flatMap((scheme) => {
    const variant = family?.[scheme];
    return variant ? [{ value: scheme, label: variant.label }] : [];
  });

  return (
    <div ref={ref}>
      <div
        ref={revealRef}
        className="landing-theme-picker landing-reveal"
        {...shown(seen)}
      >
        <div className="themes landing-themes">
          {families.map((one) => {
            const drawn = one[theme.scheme] ?? one.light ?? one.dark;
            return drawn ? (
              <ThemeTile
                key={one.id}
                theme={drawn}
                name={one.label}
                on={one.id === theme.family}
                onChoose={() => setFamily(one.id)}
              />
            ) : null;
          })}
        </div>
        <SegmentedControl
          label={t("settings.themeVariant")}
          options={variants}
          value={theme.scheme}
          onChange={setScheme}
          className="themes-variant"
        />
      </div>
    </div>
  );
}
