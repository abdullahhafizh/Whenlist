import confetti from "canvas-confetti";

const EMERALD = [
  "#059669",
  "#10b981",
  "#34d399",
  "#6ee7b7",
  "#a7f3d0",
  "#ecfdf5",
];

/** Burst confetti from the center of a DOM node (canvas-confetti). */
export function burstFromElement(el: HTMLElement | null): void {
  if (!el) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const rect = el.getBoundingClientRect();
  const x = (rect.left + rect.width / 2) / window.innerWidth;
  const y = (rect.top + rect.height / 2) / window.innerHeight;

  void confetti({
    particleCount: 52,
    spread: 68,
    startVelocity: 26,
    gravity: 1.05,
    ticks: 100,
    origin: { x, y },
    colors: EMERALD,
    disableForReducedMotion: true,
  });
  void confetti({
    particleCount: 28,
    spread: 100,
    startVelocity: 16,
    scalar: 0.75,
    gravity: 0.95,
    ticks: 80,
    origin: { x, y },
    colors: ["#10b981", "#34d399", "#ffffff"],
    disableForReducedMotion: true,
  });
}
