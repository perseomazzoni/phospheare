// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../auth/AuthContext";
import { Button, Input, Select, Sheet } from "../../ui";
import { PRODUCT } from "../../product";
import { APP_VERSION } from "../../release";
import { appLog } from "../compose";
import {
  atLeast,
  formatLine,
  formatTime,
  header,
  type LogEntry,
  type LogLevel,
} from "../domain/line";
import { matches, queryWords } from "./filter";
import "./frame.css";

// The log, as a sheet over the Library at /app/log: the lines this browser
// keeps, newest first, with a search, a level and an area to narrow them,
// and the download that takes the whole log to a file the writer can send.

/** The most lines drawn at once; the count says how many match. */
export const SHOWN = 500;

/** How long "Copied" stays on the button. */
const COPIED_MS = 1500;

type Floor = "all" | Exclude<LogLevel, "info">;

/**
 * Hands `text` to the browser as a file, through an object URL on a
 * detached `<a download>`, as the export does (`editor/export/adapters/
 * download.ts`); the URL is revoked once the browser has read it.
 */
function save(fileName: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

export default function LogSheet() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [floor, setFloor] = useState<Floor>("all");
  const [area, setArea] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void appLog.read().then((read) => {
      if (live) setEntries(read);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const areas = useMemo(
    () => [...new Set((entries ?? []).map((e) => e.area))].sort(),
    [entries],
  );
  // Each line formatted once, as it is drawn, and in lower case for the search.
  const lines = useMemo(
    () =>
      (entries ?? []).map((entry) => {
        const text = formatLine(entry);
        return { entry, text, lower: text.toLowerCase() };
      }),
    [entries],
  );
  const found = useMemo(() => {
    const words = queryWords(query);
    return lines
      .filter(
        ({ entry, lower }) =>
          (floor === "all" || atLeast(entry.level, floor)) &&
          (area === "" || entry.area === area) &&
          matches(lower, words),
      )
      .reverse();
  }, [lines, floor, area, query]);

  // Opened from About there is history behind; from a link, the shelf.
  const back = (location.state as { fromSettings?: unknown } | null)
    ?.fromSettings;
  const close = () => {
    if (back === true) void navigate(-1);
    else void navigate("/app");
  };

  const download = () => {
    const now = Date.now();
    const day = formatTime(now).slice(0, 10);
    save(
      `${PRODUCT.kebab}-log-${day}.txt`,
      [
        header(PRODUCT.name, APP_VERSION, now),
        ...lines.map((line) => line.text),
        "",
      ].join("\n"),
    );
  };

  const copyId = () => {
    if (!user) return;
    void navigator.clipboard.writeText(user.id).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <Sheet open title={t("log.title")} onClose={close}>
      <div className="log">
        <p className="setting-note">{t("log.note")}</p>
        <div className="setting-row">
          <Button
            variant="outline"
            className="ui-btn-sm"
            disabled={!entries || entries.length === 0}
            onClick={download}
          >
            {t("log.download")}
          </Button>
          {user && (
            <Button variant="outline" className="ui-btn-sm" onClick={copyId}>
              {t(copied ? "log.copied" : "log.copyId")}
            </Button>
          )}
        </div>

        <div className="log-tools">
          <Input
            label={t("log.search")}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select<Floor>
            label={t("log.level")}
            options={[
              { value: "all", label: t("log.levelAll") },
              { value: "warn", label: t("log.levelWarn") },
              { value: "error", label: t("log.levelError") },
            ]}
            value={floor}
            onChange={setFloor}
          />
          <Select
            label={t("log.area")}
            options={[
              { value: "", label: t("log.areaAll") },
              ...areas.map((a) => ({ value: a, label: a })),
            ]}
            value={area}
            onChange={setArea}
          />
        </div>

        {entries !== null && (
          <p className="log-count" aria-live="polite">
            {entries.length === 0
              ? t("log.empty")
              : found.length > SHOWN
                ? t("log.countShown", {
                    found: found.length,
                    shown: SHOWN,
                    total: entries.length,
                  })
                : t("log.count", {
                    count: found.length,
                    total: entries.length,
                  })}
          </p>
        )}
        {entries !== null && found.length > 0 && (
          // A region the keyboard can reach, so its lines scroll sideways
          // without a pointer.
          <pre className="log-lines" tabIndex={0} aria-label={t("log.title")}>
            {found
              .slice(0, SHOWN)
              .map((line) => line.text)
              .join("\n")}
          </pre>
        )}
      </div>
    </Sheet>
  );
}
