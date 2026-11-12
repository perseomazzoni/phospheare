// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import {
  createLoginSpark,
  IGNITE_MS,
  KINDLE_MS,
  AWAKEN_MS,
  SEARCH_MS,
  FLASH_PEAK_MS,
  REVEAL_FADE_MS,
  RETURN_MS,
  CHARGE_MS,
} from "./loginSpark";
import { PRODUCT } from "../../product";
import { BrandMark } from "../../brand/BrandMark";
import { motionIsStill } from "../../ui";

// Search is the variable-length act. The ending has a fixed photographic
// charge/flash, followed by the shared slow reveal fade.
const MIN_WAIT_MS = IGNITE_MS + KINDLE_MS + AWAKEN_MS + SEARCH_MS;

interface Props {
  /**
   * Called once, at the flash's peak and once `dataReady` holds: the instant
   * `Library` starts any one-shot entrance animation (the greeting), so the
   * writer sees it begin rather than finished behind the light.
   */
  onReveal: () => void;
  /** Called once the fade-out has finished playing. */
  onFinished: () => void;
  /** Whether `Library`'s data verdict (`SessionGateContext`) is in. */
  dataReady: boolean;
}

/**
 * The fresh-login ceremony, never the ordinary reload loader. The brand
 * figure stands dark; a turquoise spark lights in its chest, leaves to search
 * until the shelf is ready, and returns. While it gathers its light the
 * emblem and the name fade in around the figure, then a full-screen bloom
 * swallows them all. The greeting starts at the white peak, so it is still
 * arriving when the light fades away.
 */
export default function LoginSplash({
  onReveal,
  onFinished,
  dataReady,
}: Props) {
  const [resolving, setResolving] = useState(false);
  const [charging, setCharging] = useState(false);
  const [exploding, setExploding] = useState(false);
  const [searchElapsed, setSearchElapsed] = useState(false);
  const [floorElapsed, setFloorElapsed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [reduced, setReduced] = useState(() => motionIsStill());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chestRef = useRef<HTMLSpanElement>(null);
  const resolutionStarted = useRef<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () => setSearchElapsed(true),
      reduced ? 0 : MIN_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [reduced]);

  // Keep searching while the shelf settles. A slow login must not strand the
  // writer behind a frozen white frame; commit to the ending only when ready.
  useEffect(() => {
    if (!searchElapsed || !dataReady || resolving) return;
    resolutionStarted.current = performance.now();
    setResolving(true);
  }, [searchElapsed, dataReady, resolving]);

  // Mirrored, as in `AppBoot`: fresh `onReveal` and `onFinished` closures
  // restart neither timer, and each fires once, at its own point in the
  // sequence.
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  // The emblem arrives as the spark settles back into the chest. The figure
  // and emblem start growing when the charge peaks, and the bloom breaks out
  // after the hold.
  useEffect(() => {
    if (!resolving) return;
    const charge = setTimeout(() => setCharging(true), reduced ? 0 : RETURN_MS);
    const bloom = setTimeout(
      () => setExploding(true),
      reduced ? 0 : RETURN_MS + CHARGE_MS,
    );
    return () => {
      clearTimeout(charge);
      clearTimeout(bloom);
    };
  }, [resolving, reduced]);

  useEffect(() => {
    if (!resolving) return;
    const timer = setTimeout(
      () => setFloorElapsed(true),
      reduced ? 0 : FLASH_PEAK_MS,
    );
    return () => clearTimeout(timer);
  }, [resolving, reduced]);

  // Either order, as in `AppBoot`: `onReveal` must still fire once.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || !floorElapsed || !dataReady) return;
    firedRef.current = true;
    onRevealRef.current();
    setRevealing(true);
  }, [floorElapsed, dataReady]);

  useEffect(() => {
    if (!revealing) return;
    const timer = setTimeout(() => onFinishedRef.current(), REVEAL_FADE_MS);
    return () => clearTimeout(timer);
  }, [revealing]);

  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(motionIsStill());
    motion?.addEventListener("change", changed);
    return () => motion?.removeEventListener("change", changed);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    const prepared = canvas.getContext("2d");
    if (!prepared) return;
    const context = prepared;
    const paint = createLoginSpark();
    const born = performance.now();
    let frame = 0;
    let width = 0;
    let height = 0;
    let home = { x: 0, y: 0 };
    let disposed = false;

    function draw(now: number) {
      const start = resolutionStarted.current;
      paint(
        context,
        now - born,
        start === null ? null : now - start,
        reduced,
        width,
        height,
        home,
      );
    }
    function tick(now: number) {
      if (disposed || document.hidden) return;
      draw(now);
      frame = requestAnimationFrame(tick);
    }
    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const chest = chestRef.current?.getBoundingClientRect();
      home = chest
        ? { x: chest.left - rect.left, y: chest.top - rect.top }
        : { x: width / 2, y: height / 2 };
      // Caps GPU memory on very large or high-density displays; CSS size stays.
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(4_000_000 / Math.max(1, width * height)),
      );
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(performance.now());
      canvas.dataset.ready = "";
    }
    function visibility() {
      cancelAnimationFrame(frame);
      if (document.hidden) return;
      if (reduced) draw(performance.now());
      else frame = requestAnimationFrame(tick);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", visibility);
    resize();
    visibility();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [reduced]);

  const phase =
    (resolving ? " login-splash-resolving" : "") +
    (charging ? " login-splash-charging" : "") +
    (exploding ? " login-splash-exploding" : "") +
    (revealing ? " login-splash-revealing" : "") +
    (reduced ? " login-splash-still" : "");

  // The canvas paints above the stage, so the spark sits on the figure and
  // the bloom covers the emblem and the name.
  return (
    <div className={`login-splash${phase}`} role="status">
      <div className="login-splash-stage">
        <img
          className="login-splash-emblem"
          src="/brand/emblem.webp"
          alt=""
          aria-hidden="true"
        />
        <div className="login-splash-figure" aria-hidden="true">
          <BrandMark spark={false} />
          <span className="login-splash-chest" ref={chestRef} />
        </div>
        <div className="login-splash-mark">
          <div className="login-splash-name">{PRODUCT.name}</div>
        </div>
      </div>
      <canvas
        className="login-splash-canvas"
        ref={canvasRef}
        aria-hidden="true"
      />
      <div className="login-splash-flash" aria-hidden="true" />
    </div>
  );
}
