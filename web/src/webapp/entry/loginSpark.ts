// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The turquoise 08:33 study, projected onto the login stage. The painter owns
// only ephemeral light: no application state, DOM, timers or network access.
export const IGNITE_MS = 500;
/** The struggling ignition: the spark holds the chest until it is lit. */
export const KINDLE_MS = 1600;
export const AWAKEN_MS = 2000;
export const SEARCH_MS = 5000;
export const REVEAL_FADE_MS = 420;
/** The return to the chest, after which the charge begins in place. */
export const RETURN_MS = 850;
/** The trembling in the chest. */
export const CHARGE_MS = 1050;
/** The full tremble the bloom waits through while the figure grows. */
export const HOLD_MS = 400;
const BLOOM_MS = 700;
/** The bloom is opaque white about 480ms in; the reveal starts at 500. */
export const FLASH_PEAK_MS = RETURN_MS + CHARGE_MS + HOLD_MS + 500;

interface Position {
  x: number;
  y: number;
  depth: number;
}
interface Flight extends Position {
  vx: number;
  vy: number;
  depthVelocity: number;
}
interface Arc {
  ax: number;
  ay: number;
  avx: number;
  avy: number;
  tx: number;
  ty: number;
  endVx: number;
  endVy: number;
  duration: number;
  elapsed: number;
}
interface Trail extends Position {
  t: number;
  dust: boolean;
  jx: number;
  grain: number;
}
interface Particle extends Position {
  vx: number;
  vy: number;
  born: number;
  life: number;
  tone: number;
  radius: number;
  streak: boolean;
}
interface Flare {
  born: number;
  duration: number;
  power: number;
  rise: number;
  reach: number;
  angle: number;
  spikes: {
    angle: number;
    length: number;
    width: number;
    bend: number;
    delay: number;
    peak: number;
  }[];
}
const COLORS = ["42,218,231", "88,174,255", "255,185,145"];
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smooth = (n: number) => {
  const t = clamp(n, 0, 1);
  return t * t * (3 - 2 * t);
};
// Brief catches, as centre and strength in the kindling, before the light
// holds. Each is a short pulse, so the failed starts read as blinks rather
// than noise.
const CATCHES = [
  [0.07, 0.4],
  [0.19, 0.22],
  [0.31, 0.65],
  [0.46, 0.35],
];
function kindle(u: number) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let light = smooth((u - 0.45) / 0.55);
  for (const [at, strength] of CATCHES)
    light = Math.max(light, strength * Math.exp(-(((u - at) / 0.025) ** 2)));
  return light;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const random = (a: number, b: number) => a + Math.random() * (b - a);

export function createLoginSpark() {
  const config = { brake: RETURN_MS, charge: CHARGE_MS, bloom: BLOOM_MS };
  let age = 0,
    previous = 0;
  let x = 0,
    y = 0,
    vx = 0,
    vy = 0,
    maturity = 0,
    nextEmission = 0,
    lastTrail = 0;
  let depth = 1,
    depthVelocity = 0,
    exitDepth = 1;
  let flightPhase = random(0, Math.PI * 2);
  let leg: Arc | null = null;
  let rangeX = 1,
    rangeY = 1;
  let emissionNumber = 0;
  let haloX = 0,
    haloY = 0,
    headingX = 1,
    headingY = 0;
  const haze = Array.from({ length: 56 }, () => ({
    back: random(-0.4, 5.5),
    side: random(-3.2, 3.2),
    size: random(0.04, 0.16),
    alpha: random(0.035, 0.2),
  }));
  let brakeStart: Flight | null = null;
  let charge = 0,
    bloomProgress = 0,
    emissionBudget = 0;
  let trail: Trail[] = [],
    particles: Particle[] = [];
  let exitX = 0,
    exitY = 0;
  let nextFlare = IGNITE_MS + KINDLE_MS + AWAKEN_MS + random(250, 650);
  let flare: Flare | null = null;
  let flareLight = 0,
    flareSpread = 0;

  function arcTo(
    tx: number,
    ty: number,
    endVx: number,
    endVy: number,
    duration: number,
  ): Arc {
    return {
      ax: x,
      ay: y,
      avx: vx,
      avy: vy,
      tx,
      ty,
      endVx,
      endVy,
      duration,
      elapsed: 0,
    };
  }
  function choosePhrase() {
    const side = x > 2 ? -1 : x < -2 ? 1 : Math.random() < 0.5 ? -1 : 1;
    const bend = Math.random() < 0.5 ? -1 : 1;
    // Viewport-relative destinations make the whole night sky the search area.
    // A nonzero arrival tangent carries each broad turn into the next flight.
    leg = arcTo(
      side * random(0.65, 0.95) * rangeX,
      random(-0.8, 0.8) * rangeY,
      0,
      bend * random(0.6, 0.9) * rangeY,
      random(2000, 2700),
    );
  }
  // Hermite arcs carry the arrival velocity into the next curve. A creature
  // commits to one gesture before choosing another; no target swaps mid-flight.
  function glide(dt: number) {
    const seconds = dt / 1000;
    if (!leg) choosePhrase();
    if (!leg) return;
    leg.elapsed += dt;
    const t = clamp(leg.elapsed / leg.duration, 0, 1),
      t2 = t * t,
      t3 = t2 * t,
      duration = leg.duration / 1000;
    const h00 = 2 * t3 - 3 * t2 + 1,
      h10 = t3 - 2 * t2 + t,
      h01 = -2 * t3 + 3 * t2,
      h11 = t3 - t2;
    const d00 = 6 * t2 - 6 * t,
      d10 = 3 * t2 - 4 * t + 1,
      d01 = -6 * t2 + 6 * t,
      d11 = 3 * t2 - 2 * t;
    x =
      h00 * leg.ax +
      h10 * duration * leg.avx +
      h01 * leg.tx +
      h11 * duration * leg.endVx;
    y =
      h00 * leg.ay +
      h10 * duration * leg.avy +
      h01 * leg.ty +
      h11 * duration * leg.endVy;
    vx =
      (d00 * leg.ax +
        d10 * duration * leg.avx +
        d01 * leg.tx +
        d11 * duration * leg.endVx) /
      duration;
    vy =
      (d00 * leg.ay +
        d10 * duration * leg.avy +
        d01 * leg.ty +
        d11 * duration * leg.endVy) /
      duration;
    // A shallow downward arc adds a sense of weight without bouncing at
    // arrival.
    y += 0.42 * Math.sin(Math.PI * t) ** 2;
    vy += (0.42 * Math.PI * Math.sin(2 * Math.PI * t)) / duration;
    flightPhase += seconds * 1.45;
    const targetDepth = 1 + 0.2 * Math.sin(flightPhase * 0.57 - 1.1);
    depthVelocity += ((targetDepth - depth) * 5 - depthVelocity * 4) * seconds;
    depth += depthVelocity * seconds;
    if (t === 1) leg = null;
  }
  function brake(start: Flight, elapsed: number) {
    const u = clamp(elapsed / config.brake, 0, 1),
      seconds = config.brake / 1000;
    // A Hermite return preserves incoming velocity, then arrives at the exact
    // screen centre with zero velocity before the anchored charge begins.
    const h = 2 * u * u * u - 3 * u * u + 1,
      tangent = u * u * u - 2 * u * u + u;
    const dh = 6 * u * u - 6 * u,
      dt = 3 * u * u - 4 * u + 1;
    x = h * start.x + tangent * seconds * start.vx;
    y = h * start.y + tangent * seconds * start.vy;
    vx = (dh * start.x) / seconds + dt * start.vx;
    vy = (dh * start.y) / seconds + dt * start.vy;
    depth = lerp(start.depth, 1, smooth(u));
    depthVelocity = 0;
  }
  function emit(t: number, count: number, energy = 0) {
    for (let i = 0; i < count; i++) {
      const a = random(0, Math.PI * 2),
        speed = random(3, 6) + energy * random(6, 14);
      particles.push({
        x,
        y,
        depth,
        vx: Math.cos(a) * speed + vx * 0.15,
        vy: Math.sin(a) * speed + vy * 0.15,
        born: t,
        life: energy > 0 ? random(300, 650) : random(750, 1100),
        tone: emissionNumber++ % 2 === 0 ? 0 : 2,
        radius: energy > 0 ? random(0.25, 0.48) : random(0.12, 0.3),
        streak: energy > 0.4 && Math.random() < 0.45,
      });
    }
    if (particles.length > 70) particles.splice(0, particles.length - 70);
  }
  function glow(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    radius: number,
    color: string,
    opacity: number,
  ) {
    if (radius <= 0 || opacity <= 0) return;
    const g = ctx.createRadialGradient(px, py, 0, px, py, radius);
    g.addColorStop(0, `rgba(${color},${opacity})`);
    g.addColorStop(0.22, `rgba(${color},${opacity * 0.48})`);
    g.addColorStop(0.6, `rgba(${color},${opacity * 0.12})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
  }
  function cloud(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    rx: number,
    ry: number,
    angle: number,
    color: string,
    opacity: number,
  ) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.scale(rx, ry);
    glow(ctx, 0, 0, 1, color, opacity);
    ctx.restore();
  }
  function drawSpark(
    c: CanvasRenderingContext2D,
    origin: { x: number; y: number; scale: number },
    now: number,
    reduced: boolean,
  ) {
    const s = origin.scale;
    c.save();
    c.translate(origin.x, origin.y);
    c.scale(s, s);
    // Light accumulates through the wisps instead of covering them with flat
    // colored paint. All layers feather to zero alpha, like the photo
    // reference.
    c.globalCompositeOperation = "lighter";
    const wake = kindle(age / KINDLE_MS),
      vanish = 1 - smooth((bloomProgress - 0.34) / 0.24);
    const flicker = reduced
      ? 1
      : 1 + Math.sin(age * 0.037) * 0.06 * (1 - maturity * 0.75);
    c.globalAlpha =
      wake * vanish * (0.86 + 0.14 * clamp((depth - 0.8) / 0.4, 0, 1));
    if (!reduced) {
      for (let i = 1; i < trail.length; i++) {
        const point = trail[i],
          before = trail[i - 1];
        const life = 1 - clamp((now - point.t) / 1050, 0, 1);
        const px = point.x * point.depth,
          py = point.y * point.depth;
        const bx = before.x * before.depth,
          by = before.y * before.depth;
        const length = Math.max(0.001, Math.hypot(px - bx, py - by)),
          nx = -(py - by) / length,
          ny = (px - bx) / length;
        const knot =
          0.22 +
          0.78 *
            (0.5 + 0.5 * Math.sin(point.t * 0.021 + Math.sin(point.t * 0.006)));
        const thread = (0.05 + Math.pow(life, 0.7) * 0.22) * knot * point.depth;
        c.lineCap = "round";
        c.strokeStyle = `rgba(${COLORS[0]},${life * 0.07})`;
        c.lineWidth = thread * 5.5;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(px, py);
        c.stroke();
        c.strokeStyle = `rgba(140,239,255,${life * 0.8})`;
        c.lineWidth = thread;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(px, py);
        c.stroke();
        // Pinches, bright knots and wisps stay attached to the sampled path.
        // They must not regenerate every frame, which reads as electrical
        // noise.
        const fray = Math.sin(point.t * 0.016) * (0.2 + (1 - life) * 0.6);
        c.strokeStyle = `rgba(${COLORS[1]},${life * 0.3})`;
        c.lineWidth = 0.06 * point.depth;
        c.beginPath();
        c.moveTo(bx + nx * fray, by + ny * fray);
        c.quadraticCurveTo(
          (bx + px) / 2 + nx * (fray + 0.35),
          (by + py) / 2 + ny * (fray + 0.35),
          px,
          py,
        );
        c.stroke();
        if (knot > 0.88) glow(c, px, py, thread * 1.6, COLORS[1], life * 0.3);
        if (point.dust) {
          const drift = 1 - life;
          const dx = px + nx * point.jx * (0.3 + drift),
            dy = py + ny * point.jx * (0.3 + drift);
          glow(c, dx, dy, 0.65, COLORS[1], life * 0.18);
          c.fillStyle = `rgba(${COLORS[0]},${life * 0.42})`;
          c.beginPath();
          c.arc(dx, dy, 0.08 + point.grain * 0.11, 0, Math.PI * 2);
          c.fill();
        }
      }
      const tip = trail.find((point) => now - point.t < 790);
      if (tip && Math.hypot(tip.x - x, tip.y - y) > 2.2) {
        const alpha = clamp(1 - (now - tip.t) / 1050, 0, 1);
        const tx = tip.x * tip.depth,
          ty = tip.y * tip.depth;
        glow(c, tx, ty, 1.7, COLORS[0], alpha * 0.8);
        glow(c, tx, ty, 0.6, COLORS[1], alpha);
        c.fillStyle = `rgba(${COLORS[0]},${alpha * 0.9})`;
        c.beginPath();
        c.arc(tx, ty, 0.36, 0, Math.PI * 2);
        c.fill();
      }
      for (const dot of particles) {
        const elapsed = (now - dot.born) / 1000,
          life = 1 - (now - dot.born) / dot.life;
        if (life <= 0) continue;
        const px = (dot.x + dot.vx * elapsed) * dot.depth,
          py = (dot.y + dot.vy * elapsed + 3 * elapsed * elapsed) * dot.depth;
        const opacity = Math.min(1, life * 2.5);
        glow(c, px, py, 1.25 * dot.depth, COLORS[dot.tone], opacity * 0.65);
        c.fillStyle = `rgba(${COLORS[dot.tone]},${opacity * 0.85})`;
        c.beginPath();
        c.arc(px, py, dot.radius * dot.depth, 0, Math.PI * 2);
        c.fill();
        if (dot.streak) {
          c.strokeStyle = `rgba(${COLORS[dot.tone]},${life * 0.7})`;
          c.lineWidth = 0.22;
          c.beginPath();
          c.moveTo(px, py);
          c.lineTo(
            px - dot.vx * 0.045 * dot.depth,
            py - dot.vy * 0.045 * dot.depth,
          );
          c.stroke();
        }
      }
    }
    // Depth changes the projected size; maturity still changes only the halo.
    // Past trail samples keep their own depth instead of zooming as one ribbon.
    c.scale(depth, depth);
    const pulse = reduced ? 1 : 1 + Math.sin(age * 0.0028) * 0.08;
    const lag = Math.hypot(x - haloX, y - haloY),
      angle = Math.atan2(headingY, headingX);
    const stretch = Math.min(1.4, lag),
      width = (3 + maturity * 0.45 + charge) * pulse;
    cloud(
      c,
      haloX - headingX * 0.5,
      haloY - headingY * 0.5,
      4.2 + stretch,
      width,
      angle,
      COLORS[0],
      0.28 + charge * 0.18,
    );
    cloud(
      c,
      haloX - headingX * 1.3 - headingY * 0.35,
      haloY - headingY * 1.3 + headingX * 0.35,
      2.5 + stretch * 0.7,
      width * 0.85,
      angle + 0.18,
      COLORS[1],
      0.2,
    );
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    for (const grain of haze) {
      const gx = -grain.back * (0.7 + stretch * 0.25),
        gy = grain.side;
      glow(c, gx, gy, 0.5, COLORS[0], grain.alpha * 0.28);
      c.fillStyle = `rgba(${COLORS[0]},${grain.alpha})`;
      c.beginPath();
      c.arc(gx, gy, grain.size, 0, Math.PI * 2);
      c.fill();
    }
    // A white-hot, softly feathered nucleus inside diffuse cyan light. Nested
    // gradients have no rim, where a solid ellipse reads as a shiny bead.
    // Each flare ignites quickly in the nucleus, then spreads into a softer
    // cyan cloud. Its envelope is sampled once per frame, not random flicker.
    if (flare && flareLight > 0) {
      glow(
        c,
        -0.3,
        0,
        3.8 + flareSpread * flare.reach,
        COLORS[0],
        flareLight * 0.65,
      );
      cloud(
        c,
        -0.6,
        0.2,
        3 + flareSpread * flare.reach,
        2 + flareSpread * 2,
        flare.angle,
        "184,246,255",
        flareLight * 0.45,
      );
      // Each protrusion keeps its own direction, rise and fall for its entire
      // life. The tip retracts into the nucleus rather than fading at full
      // length, and staggered peaks avoid a regular, spinning star shape.
      const elapsed = (now - flare.born) / flare.duration;
      for (const spike of flare.spikes) {
        const t = clamp((elapsed - spike.delay) / (1 - spike.delay), 0, 1);
        const growth =
          smooth(t / spike.peak) *
          (1 - smooth((t - spike.peak) / (1 - spike.peak)));
        if (growth <= 0) continue;
        const length = 0.65 + spike.length * growth;
        const width = spike.width * (0.35 + 0.65 * growth);
        const bend = spike.bend * growth;
        c.save();
        c.rotate(spike.angle);
        cloud(
          c,
          length * 0.45,
          bend * 0.4,
          length * 0.7,
          width * 3.5,
          0,
          COLORS[0],
          growth * flare.power * 0.25,
        );
        const light = c.createRadialGradient(0, 0, 0, 0, 0, length);
        light.addColorStop(0, `rgba(245,255,255,${growth * flare.power})`);
        light.addColorStop(
          0.45,
          `rgba(182,247,255,${growth * flare.power * 0.85})`,
        );
        light.addColorStop(
          0.85,
          `rgba(80,227,246,${growth * flare.power * 0.6})`,
        );
        light.addColorStop(1, "rgba(42,218,231,0)");
        c.fillStyle = light;
        c.beginPath();
        c.moveTo(0.35, -width);
        c.quadraticCurveTo(length * 0.42, bend - width * 0.25, length, bend);
        c.quadraticCurveTo(length * 0.38, bend + width * 0.3, 0.35, width);
        c.fill();
        c.restore();
      }
    }
    glow(c, -0.35, 0, 4.6 * flicker, COLORS[1], 0.3 + flareLight * 0.2);
    glow(c, -0.2, 0, (3.1 + flareLight * 1.1) * flicker, COLORS[0], 0.8);
    glow(c, 0, 0, 1.9 + flareLight * 0.65, "225,255,255", 1);
    const core = c.createRadialGradient(0, 0, 0, 0, 0, 1.2);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(0.3, "rgba(255,255,255,.98)");
    core.addColorStop(0.65, "rgba(218,255,255,.55)");
    core.addColorStop(1, "rgba(150,246,255,0)");
    c.fillStyle = core;
    c.beginPath();
    c.ellipse(0, 0, 1.2, 1.1, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.restore();
  }
  return function paint(
    context: CanvasRenderingContext2D,
    now: number,
    resolving: number | null,
    reduced: boolean,
    width: number,
    height: number,
    // The figure's chest, in CSS pixels: ignition, return and bloom all
    // happen there.
    home = { x: width / 2, y: height / 2 },
  ) {
    const scale = clamp(Math.min(width, height) / 65, 4, 8);
    rangeX = (width * 0.34) / scale;
    rangeY = (height * 0.28) / scale;
    const dt = clamp(now - previous, 0, 45);
    const beforeX = x * depth;
    const beforeY = y * depth;
    previous = now;
    // The spark is dark until ignition; its clock starts there.
    age = Math.max(0, now - IGNITE_MS);
    if (reduced) {
      // Static light replaces the whole choreography, including the flash.
      age = Math.max(age, KINDLE_MS);
      x = 0;
      y = 0;
      vx = 0;
      vy = 0;
      depth = 1;
      depthVelocity = 0;
      haloX = 0;
      haloY = 0;
      charge = 0;
      bloomProgress = 0;
      trail = [];
      particles = [];
    } else if (resolving === null) {
      maturity = smooth((age - 550) / 5500);
      const flight = age - KINDLE_MS;
      glide(dt * smooth(flight / AWAKEN_MS));
      if (flight >= AWAKEN_MS && now > nextEmission) {
        emit(now, Math.random() < 0.3 ? 2 : 1);
        nextEmission = now + random(210, 340);
      }
    } else {
      if (!brakeStart) brakeStart = { x, y, vx, vy, depth, depthVelocity };
      if (resolving < config.brake) brake(brakeStart, resolving);
      else {
        exitX = 0;
        exitY = 0;
        exitDepth = 1;
        depth = exitDepth;
        depthVelocity = 0;
        const t = clamp((resolving - config.brake) / config.charge, 0, 1);
        charge = t * t;
        const seconds = (resolving - config.brake) / 1000;
        const phase =
          2 *
          Math.PI *
          (5 * seconds + (15 * seconds * seconds) / (config.charge / 1000));
        x = exitX + Math.sin(phase) * charge * 1.05;
        y = exitY + Math.sin(phase * 1.19 + 0.4) * charge * 0.735;
        vx = 0;
        vy = 0;
        bloomProgress = clamp(
          (resolving - config.brake - config.charge - HOLD_MS) / config.bloom,
          0,
          1,
        );
        if (bloomProgress < 0.32) {
          emissionBudget += (dt / 1000) * (4 + 105 * charge);
          const count = Math.floor(emissionBudget);
          if (count > 0) {
            emit(now, count, charge);
            emissionBudget -= count;
          }
        }
      }
    }
    const lagBlend = 1 - Math.exp(-dt / 135);
    haloX = lerp(haloX, x, lagBlend);
    haloY = lerp(haloY, y, lagBlend);
    const dx = (x * depth - beforeX) * scale;
    const dy = (y * depth - beforeY) * scale;
    const distance = Math.hypot(dx, dy);
    if (reduced) {
      flare = null;
      flareLight = 0;
    } else {
      // Local, irregular glints punctuate flight without changing its path or
      // competing with the final charge. Never generate a burst while stopped.
      if (resolving === null && distance > 0.15 && now >= nextFlare) {
        const count = Math.floor(random(2, 6));
        const direction = random(-Math.PI, Math.PI);
        flare = {
          born: now,
          duration: random(380, 850),
          power: random(0.55, 1),
          rise: random(0.12, 0.3),
          reach: random(2.5, 6),
          angle: direction,
          spikes: Array.from({ length: count }, (_, index) => ({
            angle:
              direction + (index * Math.PI * 2) / count + random(-0.5, 0.5),
            length: random(1.4, 4.2),
            width: random(0.12, 0.32),
            bend: random(-0.3, 0.3),
            delay: random(0, 0.2),
            peak: random(0.16, 0.4),
          })),
        };
        nextFlare = now + flare.duration + random(550, 1250);
        emit(now, Math.floor(random(2, 5)), 0.35);
      }
      const progress = flare
        ? clamp((now - flare.born) / flare.duration, 0, 1)
        : 1;
      flareSpread = smooth(progress);
      flareLight = flare
        ? flare.power *
          smooth(progress / flare.rise) *
          (1 - smooth((progress - flare.rise) / (1 - flare.rise)))
        : 0;
      if (progress === 1) flare = null;
    }
    if (
      !reduced &&
      distance > 0 &&
      (resolving === null || resolving < config.brake)
    ) {
      // Follow the rendered path, including depth. Time-based easing alone
      // lets the head swivel while almost stationary; cap every turn by the
      // distance actually travelled. Charge vibrations must not steer it.
      const angle = Math.atan2(headingY, headingX);
      const target = Math.atan2(dy, dx);
      const delta = Math.atan2(
        Math.sin(target - angle),
        Math.cos(target - angle),
      );
      const turn = 1 - Math.exp(-dt / 120);
      const next = angle + clamp(delta * turn, -distance / 18, distance / 18);
      headingX = Math.cos(next);
      headingY = Math.sin(next);
    }
    const last = trail[trail.length - 1];
    if (
      now - lastTrail > 16 &&
      (!last || Math.hypot(x - last.x, y - last.y) > 0.055)
    ) {
      trail.push({
        x,
        y,
        depth,
        t: now,
        dust: Math.random() < 0.32,
        jx: random(-1.5, 1.5),
        grain: Math.random(),
      });
      lastTrail = now;
      if (trail.length > 70) trail.shift();
    }
    trail = trail.filter((v) => now - v.t < 1050);
    particles = particles.filter((v) => now - v.born < v.life);
    context.clearRect(0, 0, width, height);
    const origin = { x: home.x, y: home.y, scale };
    drawSpark(context, origin, now, reduced);
    if (bloomProgress > 0 && !reduced) {
      // A full-screen canvas lets the original photographic bloom erase the
      // creature and the dark stage. React starts the reveal at its white peak.
      const rise = smooth(bloomProgress / 0.72);
      const cx = origin.x + exitX * exitDepth * origin.scale;
      const cy = origin.y + exitY * exitDepth * origin.scale;
      const radius = lerp(5, Math.hypot(width, height) * 1.15, rise);
      glow(context, cx, cy, radius, COLORS[0], 0.95);
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.3, "rgba(255,255,255,.98)");
      gradient.addColorStop(0.7, "rgba(255,255,255,.55)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.fillStyle =
        "rgba(255,255,255," + smooth((bloomProgress - 0.4) / 0.29) + ")";
      context.fillRect(0, 0, width, height);
    }
  };
}
