// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The station probe: a development overlay, enabled with `?debug=station`,
// that paints the station, the visible centre and the caret's centre with the
// live delta. jsdom measures every rect as zero, so no unit test can see the
// docked invariant fail in real layout.

import { station as stationMachine, stationY } from "./station";
import { scrollGlideActive } from "./scrollGlide";

export interface ProbePos {
  y: number;
  h: number;
}

const PROBE_CLASS = "station-probe";

export function isStationProbeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "station";
}

/**
 * The vertical centre of the page the writer sees, clear of the floating
 * chrome and the bottom of the window.
 */
function visibleCentre(box: DOMRect): number {
  const el = document.querySelector(".bar-stack");
  const chrome = el ? el.getBoundingClientRect() : null;
  // The chrome floats above the prose on the desk and below it on the phone;
  // the nearest edge wins. This reimplements `chromeFromSpans`'s rule in
  // `station.ts` and is not wired to it; check both when touching either.
  const below = !!chrome && chrome.top > box.top + box.height / 2;
  const visibleTop =
    chrome && !below ? Math.max(box.top, chrome.bottom) : box.top;
  const visibleBottom = Math.min(
    box.bottom,
    window.innerHeight,
    chrome && below ? chrome.top : Number.POSITIVE_INFINITY,
  );
  return visibleTop + (visibleBottom - visibleTop) / 2;
}

let root: HTMLDivElement | null = null;

/** The one overlay, recreated if the test or the page removed it. */
function ensureRoot(): HTMLDivElement {
  if (root && root.isConnected) return root;
  root = document.createElement("div");
  root.className = PROBE_CLASS;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "300",
  });
  document.body.appendChild(root);
  return root;
}

/**
 * Paint the probe. `caret` is a thunk so measuring it costs nothing while the
 * probe is off.
 */
export function paintStationProbe(
  caret: (() => ProbePos | null) | null,
  surface: HTMLElement | null,
): void {
  if (!isStationProbeEnabled()) return;
  const el = ensureRoot();

  const box = surface ? surface.getBoundingClientRect() : null;
  const station = box
    ? stationY({ top: box.top, height: box.height }, stationMachine.chrome)
    : Number.NaN;
  const visible = box ? visibleCentre(box) : Number.NaN;
  const pos = caret ? caret() : null;
  const centre = pos ? pos.y + pos.h / 2 : Number.NaN;
  const delta = centre - station;
  const maxScroll = surface
    ? Math.max(0, surface.scrollHeight - surface.clientHeight)
    : 0;
  const clamp =
    !surface || maxScroll === 0
      ? "—"
      : surface.scrollTop <= 0
        ? "at start"
        : surface.scrollTop >= maxScroll
          ? "at end"
          : "free";

  el.replaceChildren();
  el.style.display = "block";

  const line = document.createElement("div");
  Object.assign(line.style, {
    position: "absolute",
    left: "0",
    right: "0",
    top: `${station}px`,
    borderTop: "1px dashed var(--hair)",
  });
  el.appendChild(line);

  // The gap between this dotted line and the dashed station line is the
  // error, in pixels.
  if (Number.isFinite(visible)) {
    const centreLine = document.createElement("div");
    Object.assign(centreLine.style, {
      position: "absolute",
      left: "0",
      right: "0",
      top: `${visible}px`,
      borderTop: "1px dotted var(--hair)",
    });
    el.appendChild(centreLine);
  }

  if (Number.isFinite(centre)) {
    const tick = document.createElement("div");
    Object.assign(tick.style, {
      position: "absolute",
      top: `${centre}px`,
      left: "calc(50% - 5px)",
      width: "10px",
      borderTop: "2px solid var(--accent)",
    });
    el.appendChild(tick);
  }

  const text = document.createElement("pre");
  Object.assign(text.style, {
    position: "absolute",
    top: "12px",
    right: "12px",
    margin: "0",
    padding: "6px 8px",
    background: "var(--paper)",
    color: "var(--ink)",
    border: "1px solid var(--hair)",
    borderRadius: "6px",
    font: "11px ui-monospace, monospace",
    whiteSpace: "pre",
  });
  text.textContent = [
    `station ${station.toFixed(1)}`,
    `visible ${Number.isFinite(visible) ? visible.toFixed(1) : "—"}`,
    `caret   ${Number.isFinite(centre) ? centre.toFixed(1) : "—"}`,
    `delta   ${Number.isFinite(delta) ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}` : "—"}`,
    `scroll  ${surface ? surface.scrollTop : "—"} / ${maxScroll} ${clamp}`,
    `glide   ${scrollGlideActive() ? "running" : "idle"}`,
  ].join("\n");
  el.appendChild(text);
}
