// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EditorEngine } from "../engine";
import type { Hunk } from "../../engine";
import { getParagraphs } from "../writing/dom";

// ── The diff Accept layer ────────────────────────────────────────────────────
//
// One hover-revealed Accept tag per hunk of the snapshot comparison, sitting
// flush under the hunk's tint with its right edge at the tint's tail.
//
// The tags are a sibling layer, not children of the prose: `patchDocument`
// rebuilds changed paragraphs, so a button inside a `<p>` would be rebuilt
// between pointerdown and mouseup and the accept would never fire. The layer
// finds its surface and editor from the DOM, so it never depends on refs that
// fill after the first paint.
//
// The 80ms hover intent is tracked in JS because the tint and the tag live in
// different subtrees. Nothing over the marks captures the pointer, so
// drag-selection across the diff keeps working.
//
// The rail's walk never shows an Accept, because accepting there would fork
// history, and the Selected-to-Adopted reading is a pure comparison with no
// Accept.

/**
 * The wrap's layout width. The wrap pins the tag's right edge to the tint's
 * tail, so the tag grows leftward whatever the label's width.
 */
const BUTTON_W = 58;
/**
 * Half the prose's inter-line gap, in pixels: how far the hover region
 * reaches above and below each of the hunk's line fragments. Without it a
 * pointer between two lines of a multiline hunk disarms it.
 */
const HUNK_HIT_PAD = 9;

interface PlacedHunk {
  hunk: Hunk;
  /** Content coordinates (relative to the scroller's content origin). */
  left: number;
  top: number;
}

export default function DiffAcceptLayer({ engine }: { engine: EditorEngine }) {
  const { t } = useTranslation();
  const layerRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedHunk[]>([]);
  const [armedId, setArmedId] = useState<number | null>(null);
  const intentRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The hover effect reads the placed set without re-binding, so the freshest
  // copy is kept here; the effect itself depends only on the engine.
  const placedRef = useRef<PlacedHunk[]>([]);
  placedRef.current = placed;

  // ── Measuring the hunk set ─────────────────────────────────────────────────
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const surface = layer.parentElement;
    const editor = surface?.querySelector<HTMLElement>(".editor") ?? null;
    // `observe` throws on a null target.
    if (!surface || !editor) return;

    const measure = () => {
      // The session notifies `doc` on a direction switch, so the buttons
      // follow the lens.
      if (
        !editor ||
        !surface ||
        !engine.inSnapshotDiff ||
        engine.diffDirection === "selectedWithAdopted"
      ) {
        // Keep the empty list already drawn: a fresh one would redraw the
        // layer on every keystroke outside a comparison, to place nothing.
        setPlaced((now) => (now.length === 0 ? now : []));
        setArmedId(null);
        return;
      }
      const surfaceRect = surface.getBoundingClientRect();
      const originY = surfaceRect.top - surface.scrollTop;
      // X comes from the layer, not the surface's border box: the layer sits
      // in the padding box, past the left scrollbar gutter
      // (`scrollbar-gutter: stable both-edges`). `clientLeft` names the
      // gutter too, but rounded to a whole pixel.
      const originX = layer.getBoundingClientRect().left;

      // Raw `editor.children` indexing desyncs from `hunk.para` as soon as a
      // non-block element sits among the paragraphs.
      const paragraphs = getParagraphs(editor);
      const next: PlacedHunk[] = [];
      for (const hunk of engine.diffHunks) {
        const paraEl = paragraphs[hunk.para];
        if (!(paraEl instanceof HTMLElement)) continue;
        // A textless block hunk (a page break) has no wrapper, so the
        // paragraph stands in for the anchor.
        const span = paraEl.querySelector<HTMLElement>(
          `.df-hunk[data-hunk-id="${hunk.id}"]`,
        );
        const anchor = span ?? paraEl;
        // The tag extends from the last line fragment, never the bounding
        // box, whose right edge is the longest line's. jsdom returns no
        // fragments, so the plain rect stands in there and the e2e suite
        // checks the position.
        const fragments = anchor.getClientRects();
        const tail =
          fragments.length > 0
            ? fragments[fragments.length - 1]
            : anchor.getBoundingClientRect();
        // Never in the margin lane, where the dock's sheet floats over it.
        next.push({
          hunk,
          left: tail.right - originX - BUTTON_W,
          top: tail.bottom - originY,
        });
      }
      setPlaced(next);
      setArmedId((id) =>
        id !== null && next.some((p) => p.hunk.id === id) ? id : null,
      );
    };

    const off = engine.subscribe((reason) => {
      if (reason !== "selection") measure();
    });
    const remeasure = () => measure();
    surface?.addEventListener("scroll", remeasure, { passive: true });
    window.addEventListener("resize", remeasure);
    // The marks paint in `EditorCore`, which the layer cannot await, so a
    // measure can run before the `.df-hunk` spans exist. The layer
    // re-measures whenever the editor's structure changes.
    const observer = new MutationObserver(() => {
      remeasure();
      // A recalc rebuilds the hunk spans and strips `data-armed` with them;
      // re-mirroring keeps a surviving tag's tint lit.
      mirrorRef.current(editor);
    });
    observer.observe(editor, { childList: true, subtree: true });
    measure();
    // The editor's first paint lands in a parent effect, which runs after
    // this one, so a macrotask measures again after the commit. jsdom drives
    // no rAF, so a frame callback would never arrive under test.
    const settle = setTimeout(() => measure(), 0);
    return () => {
      clearTimeout(settle);
      observer.disconnect();
      off();
      surface?.removeEventListener("scroll", remeasure);
      window.removeEventListener("resize", remeasure);
      if (intentRef.current) clearTimeout(intentRef.current);
    };
  }, [engine]);

  // ── Hover intent ───────────────────────────────────────────────────────────
  useEffect(() => {
    const layer = layerRef.current;
    const surface = layer?.parentElement;
    if (!layer || !surface) return;
    const arm = (id: number | null) => {
      if (intentRef.current) clearTimeout(intentRef.current);
      if (id === null) {
        intentRef.current = null;
        setArmedId(null);
        return;
      }
      // A pointer crossing a hunk on its way somewhere must not grow a
      // button. The CSS transition delay carries the same 80ms.
      intentRef.current = setTimeout(() => setArmedId(id), 80);
    };
    const onPointerMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const owner = el?.closest<HTMLElement>(".df-hunk, .df-accept");
      if (owner?.dataset.hunkId) {
        arm(Number(owner.dataset.hunkId));
        return;
      }
      // In the gaps between a multiline tint's lines `elementFromPoint` finds
      // the plain paragraph, so the line fragments are hit-tested, padded.
      const editor = surface.querySelector<HTMLElement>(".editor");
      const paragraphs = editor ? getParagraphs(editor) : [];
      for (const p of placedRef.current) {
        const paraEl = paragraphs[p.hunk.para];
        const span = paraEl?.querySelector<HTMLElement>(
          `.df-hunk[data-hunk-id="${p.hunk.id}"]`,
        );
        const anchor = span ?? paraEl;
        if (!anchor) continue;
        for (const r of anchor.getClientRects()) {
          if (
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top - HUNK_HIT_PAD &&
            e.clientY <= r.bottom + HUNK_HIT_PAD
          ) {
            arm(p.hunk.id);
            return;
          }
        }
      }
      arm(null);
    };
    const onPointerLeave = () => arm(null);
    surface.addEventListener("pointermove", onPointerMove, { passive: true });
    surface.addEventListener("pointerleave", onPointerLeave);
    return () => {
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [engine]);

  // ── The armed mirror ───────────────────────────────────────────────────────
  // CSS cannot keep the tint lit once the pointer has moved to the tag, a
  // different subtree, so the armed id is mirrored onto the anchor as
  // `data-armed`. The ref gives the measure effect's observer the freshest
  // closure.
  const mirrorRef = useRef<(editor: HTMLElement) => void>(() => {});
  mirrorRef.current = (editor) => {
    editor
      .querySelectorAll<HTMLElement>(".df-hunk[data-armed], p[data-armed]")
      .forEach((el) => delete el.dataset.armed);
    if (armedId !== null) {
      // A textless block hunk or an unwrappable range has the paragraph as
      // its anchor.
      const para = engine.diffHunks.find((h) => h.id === armedId)?.para;
      const paraEl =
        para === undefined ? null : (getParagraphs(editor)[para] ?? null);
      const span = paraEl?.querySelector<HTMLElement>(
        `.df-hunk[data-hunk-id="${armedId}"]`,
      );
      const anchor = (span ?? paraEl) as HTMLElement | null;
      if (anchor) anchor.dataset.armed = "1";
    }
  };
  useEffect(() => {
    const layer = layerRef.current;
    const editor = layer?.parentElement?.querySelector<HTMLElement>(".editor");
    if (!editor) return;
    mirrorRef.current(editor);
  }, [armedId]);

  // The layer div always renders: the measure effect locates its surface
  // through `layerRef`. The empty div is inert.
  return (
    <div ref={layerRef} className="df-accept-layer">
      {placed.map((p) => (
        <span
          key={p.hunk.id}
          className="df-accept-wrap"
          style={{ left: p.left, top: p.top, width: BUTTON_W }}
        >
          <button
            type="button"
            className={
              armedId === p.hunk.id ? "df-accept revealed" : "df-accept"
            }
            data-hunk-id={p.hunk.id}
            // A replacement hunk takes the addition's colour, because the
            // action adopts the new text.
            data-kind={p.hunk.kind}
            onClick={() =>
              engine.acceptHunk(p.hunk, t("snapshots.acceptChange"))
            }
            aria-label={t("snapshots.acceptChange")}
          >
            {t("snapshots.accept")}
          </button>
        </span>
      ))}
    </div>
  );
}
