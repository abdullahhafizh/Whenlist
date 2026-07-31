type Scrap = {
  el: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  flutter: number;
  /** How strongly the escaping air still pushes this scrap */
  wind: number;
};

/**
 * Air balloon overfill → pop.
 * Wind has no separate “body”: you see it by what it does to the balloon —
 * stretch, tear, and blast the membrane scraps outward.
 */
export async function explodeElement(
  el: HTMLElement | null,
  opts?: { durationMs?: number },
): Promise<void> {
  if (!el) return;

  const durationMs = opts?.durationMs ?? 340;
  const rect = el.getBoundingClientRect();

  const swipe = el.closest(".checklist-swipe") as HTMLElement | null;
  const row = el.closest(".checklist-row") as HTMLElement | null;
  if (swipe) {
    swipe.style.visibility = "hidden";
    swipe.style.pointerEvents = "none";
  }
  if (row) row.classList.add("is-balloon-pop");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.style.visibility = "hidden";
    return;
  }
  if (rect.width < 2 || rect.height < 2) {
    el.style.visibility = "hidden";
    return;
  }

  const cs = getComputedStyle(el);
  const fill =
    cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)"
      ? cs.backgroundColor
      : "#ffffff";
  const edge = cs.borderColor || "#99f6e4";

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:visible;";
  document.body.appendChild(layer);

  // Force a soft balloon silhouette immediately — never show card corners.
  const balloon = document.createElement("div");
  balloon.style.cssText = [
    "position:fixed",
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    "transform:translate3d(0,0,0) scale(1)",
    "transform-origin:50% 55%",
    "will-change:transform,opacity,border-radius,clip-path",
    "overflow:hidden",
    `background:${fill}`,
    "border:0",
    // Round enough that flat card edges are gone from frame 0
    `border-radius:${Math.min(rect.width, rect.height) / 2}px`,
    "clip-path:inset(0 round 999px)",
    "box-shadow:0 10px 28px -14px rgb(15 23 42 / 0.28)",
  ].join(";");
  layer.appendChild(balloon);

  const face = el.cloneNode(true) as HTMLElement;
  face.style.cssText = [
    "position:absolute",
    "inset:0",
    "margin:0",
    "border-radius:inherit",
    "overflow:hidden",
    // Soft-mask the clone so any leftover rect chrome is clipped
    "mask-image:radial-gradient(ellipse 72% 78% at 50% 50%, #000 55%, transparent 100%)",
    "-webkit-mask-image:radial-gradient(ellipse 72% 78% at 50% 50%, #000 55%, transparent 100%)",
    "will-change:opacity,filter,transform",
  ].join(";");
  balloon.appendChild(face);

  const gloss = document.createElement("div");
  gloss.style.cssText = [
    "position:absolute",
    "inset:0",
    "pointer-events:none",
    "opacity:0",
    "border-radius:inherit",
    "background:radial-gradient(120% 80% at 30% 22%, rgb(255 255 255 / 0.75), transparent 42%)",
  ].join(";");
  balloon.appendChild(gloss);

  el.style.visibility = "hidden";

  // Very short inflate → snap tear → fast blast
  const inflateMs = durationMs * 0.36;
  const tearMs = durationMs * 0.08;
  const blastMs = durationMs - inflateMs - tearMs;

  // 1) Air fills — silhouette stays fully rounded (no card corners)
  await runFrames(inflateMs, (t) => {
    const p = easeOutBack(Math.max(0, (t - 0.02) / 0.98));
    const pressure =
      Math.sin(t * Math.PI * 14) * (0.014 + t * 0.03) +
      Math.sin(t * Math.PI * 21) * 0.01;
    const grow = 1 + 0.72 * p + pressure;
    const wobble = Math.sin(t * Math.PI * 5.2) * (1 - t) * 0.04;
    const sx = grow * (1 + wobble);
    const sy = grow * (1 - wobble * 0.75);
    const rot = wobble * 12 + pressure * 36;
    const round = Math.min(rect.width, rect.height) / 2 + t * 24;

    // Shake builds with overpressure (getar makin kencang menjelang meledak)
    const shakeAmp = t * t * 5.5;
    const shakeX =
      Math.sin(t * Math.PI * 48) * shakeAmp +
      Math.sin(t * Math.PI * 73) * shakeAmp * 0.45;
    const shakeY =
      Math.cos(t * Math.PI * 56) * shakeAmp * 0.85 +
      Math.sin(t * Math.PI * 91) * shakeAmp * 0.35;
    const shakeRot =
      Math.sin(t * Math.PI * 62) * shakeAmp * 0.55 +
      Math.cos(t * Math.PI * 81) * shakeAmp * 0.25;

    balloon.style.transform = `translate3d(${shakeX}px,${t * -5 + shakeY}px,0) scale(${sx}, ${sy}) rotate(${rot + shakeRot}deg)`;
    balloon.style.borderRadius = `${round}px`;
    balloon.style.clipPath = `inset(0 round ${round}px)`;
    balloon.style.boxShadow = [
      `0 ${10 + t * 18}px ${24 + t * 20}px -10px rgb(13 148 136 / ${0.22 + t * 0.4})`,
      `inset 0 ${4 + t * 8}px ${12 + t * 6}px rgb(255 255 255 / ${0.35 + t * 0.4})`,
    ].join(",");

    face.style.opacity = String(1 - t);
    face.style.filter = `blur(${t * 10}px)`;
    face.style.transform = `scale(${1 + t * 0.12})`;
    gloss.style.opacity = String(Math.min(1, t * 1.15));
  });

  // 2) Quick tear — violent shake as air rips out
  const tearAngle = -25 + Math.random() * 50;
  await runFrames(tearMs, (t) => {
    const open = easeOutCubic(t);
    const pull = open * 14;
    const squash = 1.7 + open * 0.15;
    const stretchX = squash * (1 + open * 0.12);
    const stretchY = squash * (1 - open * 0.2);
    const hole = 12 + open * 48;
    const shakeAmp = 3 + open * 7;
    const shakeX = Math.sin(t * Math.PI * 90) * shakeAmp;
    const shakeY = Math.cos(t * Math.PI * 110) * shakeAmp * 0.9;
    const shakeRot = Math.sin(t * Math.PI * 100) * shakeAmp * 0.8;
    balloon.style.clipPath = `ellipse(${100 - hole * 0.55}% ${100 - hole * 0.4}% at ${50 + Math.cos((tearAngle * Math.PI) / 180) * hole * 0.15}% ${50 + Math.sin((tearAngle * Math.PI) / 180) * hole * 0.15}%)`;
    balloon.style.transform = `translate3d(${Math.cos((tearAngle * Math.PI) / 180) * pull + shakeX}px, ${-5 + Math.sin((tearAngle * Math.PI) / 180) * pull + shakeY}px, 0) scale(${stretchX}, ${stretchY}) rotate(${tearAngle * open * 0.3 + shakeRot}deg)`;
    balloon.style.opacity = String(1 - open * 0.35);
    gloss.style.opacity = String(1 - open * 0.6);
  });

  const pop = balloon.getBoundingClientRect();
  const cx = pop.left + pop.width / 2;
  const cy = pop.top + pop.height / 2;
  balloon.remove();

  // 3) Air blast exists only as force on the scraps of this div
  const scraps = spawnScraps(layer, cx, cy, pop, fill, edge, tearAngle);

  const gravity = 1700;
  let last = performance.now();

  await runFrames(blastMs, (t, now) => {
    const dt = Math.min(0.03, (now - last) / 1000);
    last = now;

    // Pressure wave decays — strong at first, then scraps just fall
    const wave = Math.exp(-t * 5.5);

    for (const s of scraps) {
      // Continuous wind shove away from the burst center while wave lasts
      const dx = s.x - cx;
      const dy = s.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const windForce = s.wind * wave * 4200 * dt;
      s.vx += (dx / dist) * windForce;
      s.vy += (dy / dist) * windForce * 0.85;

      s.vx *= 1 - (1.2 + wave) * dt;
      s.vy *= 1 - 0.35 * dt;
      s.vy += gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vr * dt;

      // Flutter = membrane catching remaining gusts
      const flap =
        1 +
        Math.sin(s.rot * 0.1 + now * 0.02 * s.flutter) *
          (0.08 + wave * 0.22);
      const fade = 1 - t * t;
      const shrink = 1 - t * 0.35;

      s.el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.rot}deg) scale(${shrink * flap}, ${shrink / flap})`;
      s.el.style.opacity = String(Math.max(0, fade));
    }
  });

  layer.remove();
}

function spawnScraps(
  layer: HTMLElement,
  cx: number,
  cy: number,
  pop: DOMRect,
  fill: string,
  edge: string,
  tearAngleDeg: number,
): Scrap[] {
  const scraps: Scrap[] = [];
  const n = 18;
  const tearRad = (tearAngleDeg * Math.PI) / 180;

  for (let i = 0; i < n; i++) {
    // Bias burst direction toward the tear (air vents that way first)
    const base = (i / n) * Math.PI * 2;
    const angle = base * 0.65 + tearRad * 0.35 + (Math.random() - 0.5) * 0.55;
    const speed = 520 + Math.random() * 640;
    const w = 12 + Math.random() * 32;
    const h = 7 + Math.random() * 20;
    const x = cx - w / 2 + Math.cos(angle) * pop.width * 0.04;
    const y = cy - h / 2 + Math.sin(angle) * pop.height * 0.04;

    const el = document.createElement("div");
    el.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      `width:${w}px`,
      `height:${h}px`,
      `background:linear-gradient(135deg, rgb(255 255 255 / 0.9), ${fill} 45%, ${edge})`,
      `clip-path:${tornClip()}`,
      "border-radius:40%",
      "box-shadow:0 1px 3px rgb(15 23 42 / 0.14)",
      "will-change:transform,opacity",
      "backface-visibility:hidden",
      `transform:translate3d(${x}px, ${y}px, 0)`,
    ].join(";");
    layer.appendChild(el);

    scraps.push({
      el,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 300 - Math.random() * 200,
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 980,
      flutter: 0.7 + Math.random() * 1.4,
      wind: 0.55 + Math.random() * 0.9,
    });
  }

  for (let i = 0; i < 12; i++) {
    const angle = tearRad + (Math.random() - 0.5) * 1.8;
    const speed = 560 + Math.random() * 720;
    const s = 4 + Math.random() * 10;
    const x = cx - s / 2;
    const y = cy - s / 2;
    const el = document.createElement("div");
    el.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      `width:${s}px`,
      `height:${s * (0.35 + Math.random() * 0.9)}px`,
      `background:${Math.random() > 0.45 ? fill : "#ccfbf1"}`,
      `clip-path:${tornClip()}`,
      "border-radius:50%",
      "will-change:transform,opacity",
      `transform:translate3d(${x}px, ${y}px, 0)`,
    ].join(";");
    layer.appendChild(el);
    scraps.push({
      el,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 260 - Math.random() * 200,
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 1200,
      flutter: 1 + Math.random() * 1.6,
      wind: 0.8 + Math.random() * 1.1,
    });
  }

  return scraps;
}

function tornClip(): string {
  const pts: string[] = [];
  const n = 5 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 35 + Math.random() * 55;
    pts.push(
      `${(50 + Math.cos(a) * r * 0.5).toFixed(1)}% ${(50 + Math.sin(a) * r * 0.5).toFixed(1)}%`,
    );
  }
  return `polygon(${pts.join(",")})`;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function runFrames(
  durationMs: number,
  onFrame: (t: number, now: number) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      onFrame(t, now);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
