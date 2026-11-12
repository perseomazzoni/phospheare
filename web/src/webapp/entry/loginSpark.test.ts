// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import {
  IGNITE_MS,
  KINDLE_MS,
  AWAKEN_MS,
  SEARCH_MS,
  FLASH_PEAK_MS,
  RETURN_MS,
  createLoginSpark,
} from "./loginSpark";

/** A context that records the nucleus pose: its translation and heading. */
function posingContext(poses: { x: number; y: number; angle: number }[]) {
  type Matrix = [number, number, number, number, number, number];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  return {
    save() {
      stack.push([...matrix]);
    },
    restore() {
      matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    },
    translate(x: number, y: number) {
      matrix[4] += matrix[0] * x + matrix[2] * y;
      matrix[5] += matrix[1] * x + matrix[3] * y;
    },
    scale(x: number, y: number) {
      matrix[0] *= x;
      matrix[1] *= x;
      matrix[2] *= y;
      matrix[3] *= y;
    },
    rotate(angle: number) {
      const [a, b, c, d, e, f] = matrix;
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      matrix = [
        a * cos + c * sin,
        b * cos + d * sin,
        c * cos - a * sin,
        d * cos - b * sin,
        e,
        f,
      ];
    },
    ellipse() {
      poses.push({
        x: matrix[4],
        y: matrix[5],
        angle: Math.atan2(matrix[1], matrix[0]),
      });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    quadraticCurveTo() {},
    fillRect() {},
    clearRect() {},
    fill() {},
    arc() {},
    createRadialGradient: () => ({ addColorStop() {} }),
  } as unknown as CanvasRenderingContext2D;
}

describe("the turquoise login creature", () => {
  it("ties turning to visible travel and keeps the charging head's orientation fixed", () => {
    const poses: { x: number; y: number; angle: number }[] = [];
    const context = posingContext(poses);
    // Starting left exposes a stationary head swivelling to catch its tangent.
    const random = vi.spyOn(Math, "random").mockReturnValue(0.2);
    try {
      const paint = createLoginSpark();
      for (let time = 0; time <= 5400; time += 20)
        paint(context, time, null, false, 1200, 800);
      for (let time = 0; time <= 850; time += 2)
        paint(context, 5400 + time, time, false, 1200, 800);
      for (let i = 1; i < poses.length; i++) {
        const before = poses[i - 1],
          after = poses[i];
        const distance = Math.hypot(after.x - before.x, after.y - before.y);
        const turn = Math.abs(
          Math.atan2(
            Math.sin(after.angle - before.angle),
            Math.cos(after.angle - before.angle),
          ),
        );
        expect(turn).toBeLessThanOrEqual(distance / 18 + 1e-9);
      }
      const direction = poses[poses.length - 1].angle;
      poses.length = 0;
      for (let time = 852; time < 1800; time += 20)
        paint(context, 5400 + time, time, false, 1200, 800);
      expect(
        poses.every((pose) => Math.abs(pose.angle - direction) < 1e-9),
      ).toBe(true);
    } finally {
      random.mockRestore();
    }
  });
  it("holds the chest while it kindles, with failed catches before it holds", () => {
    const poses: { x: number; y: number; angle: number }[] = [];
    const context = posingContext(poses);
    const home = { x: 610, y: 260 };
    const paint = createLoginSpark();
    const light: number[] = [];
    for (let time = IGNITE_MS; time <= IGNITE_MS + KINDLE_MS; time += 10) {
      paint(context, time, null, false, 1200, 800, home);
      light.push(context.globalAlpha);
    }
    const falls = light.filter((v, i) => i > 0 && v < light[i - 1] - 0.1);
    expect(falls.length).toBeGreaterThanOrEqual(3);
    expect(light[light.length - 1]).toBeGreaterThan(0.8);
    for (const pose of poses) {
      expect(pose.x).toBeCloseTo(home.x, 6);
      expect(pose.y).toBeCloseTo(home.y, 6);
    }
  });

  it("stays dark until ignition, then returns to the home it is given", () => {
    const poses: { x: number; y: number; angle: number }[] = [];
    const context = posingContext(poses);
    const home = { x: 610, y: 260 };
    const paint = createLoginSpark();
    paint(context, IGNITE_MS - 20, null, false, 1200, 800, home);
    expect(context.globalAlpha).toBe(0);
    for (let time = IGNITE_MS; time <= 8000; time += 20)
      paint(context, time, null, false, 1200, 800, home);
    expect(context.globalAlpha).toBeGreaterThan(0);
    for (let time = 0; time <= RETURN_MS; time += 10)
      paint(context, 8000 + time, time, false, 1200, 800, home);
    const landed = poses[poses.length - 1];
    expect(landed.x).toBeCloseTo(home.x, 6);
    expect(landed.y).toBeCloseTo(home.y, 6);
  });

  it("reserves at least five whole seconds for search after awakening", () => {
    expect(AWAKEN_MS).toBeGreaterThanOrEqual(0);
    expect(SEARCH_MS).toBeGreaterThanOrEqual(5000);
  });

  it("draws bounded, finite light in both particle colors, then covers the stage in white", () => {
    let draws = 0;
    let finite = true;
    const colors = new Set<string>();
    const point = (...values: number[]) => {
      finite &&= values.every(Number.isFinite);
      draws++;
    };
    const context = {
      save() {},
      restore() {},
      translate: point,
      rotate: point,
      scale: point,
      beginPath() {},
      moveTo: point,
      lineTo: point,
      stroke() {},
      quadraticCurveTo: point,
      fillRect: point,
      clearRect: point,
      fill() {},
      arc: point,
      ellipse: point,
      fillStyle: "",
      createRadialGradient: (...values: number[]) => {
        point(...values);
        return {
          addColorStop: (offset: number, color: string) => {
            point(offset);
            colors.add(color);
          },
        };
      },
    } as unknown as CanvasRenderingContext2D;
    const paint = createLoginSpark();
    for (let time = 0; time < 30_000; time += 40)
      paint(context, time, null, false, 1440, 900);
    expect([...colors].some((color) => color.includes("42,218,231"))).toBe(
      true,
    );
    expect([...colors].some((color) => color.includes("255,185,145"))).toBe(
      true,
    );
    draws = 0;
    for (let time = 30_000; time < 32_000; time += 40)
      paint(context, time, null, false, 1440, 900);
    expect(draws).toBeLessThan(60_000);
    for (let time = 0; time <= 2000; time += 20)
      paint(context, 32_000 + time, time, false, 1440, 900);
    paint(context, 34_000, FLASH_PEAK_MS, false, 1440, 900);
    expect(context.fillStyle).toBe("rgba(255,255,255,1)");
    expect(finite).toBe(true);
  });

  it("does not draw moving particles or a flash in reduced motion", () => {
    const colors: string[] = [];
    let rectangles = 0;
    const context = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      beginPath() {},
      clearRect() {},
      fill() {},
      arc() {},
      ellipse() {},
      fillRect() {
        rectangles++;
      },
      createRadialGradient: () => ({
        addColorStop: (_: number, color: string) => colors.push(color),
      }),
    } as unknown as CanvasRenderingContext2D;
    const paint = createLoginSpark();
    paint(context, 500, null, true, 375, 667);
    const first = [...colors];
    const firstCount = rectangles;
    colors.length = 0;
    rectangles = 0;
    paint(context, 9000, FLASH_PEAK_MS, true, 375, 667);
    expect(colors).toEqual(first);
    expect(rectangles).toBe(firstCount);
  });
});
