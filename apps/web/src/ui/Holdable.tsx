import { useEffect, useRef, type ReactNode } from "react";

const HOLD_MS = 480;
const MOVE_CANCEL_PX = 10;

type Props = {
  disabled?: boolean;
  onHold: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * Long-press (mobile) to open an action menu. Cancels if the finger moves.
 */
export default function Holdable({
  disabled,
  onHold,
  children,
  className = "",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const fired = useRef(false);
  const disabledRef = useRef(disabled);
  const onHoldRef = useRef(onHold);

  disabledRef.current = disabled;
  onHoldRef.current = onHold;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current) return;
      const t = e.touches[0];
      startX.current = t.clientX;
      startY.current = t.clientY;
      fired.current = false;
      clear();
      timerRef.current = setTimeout(() => {
        fired.current = true;
        // Soft haptic where supported
        try {
          navigator.vibrate?.(12);
        } catch {
          /* ignore */
        }
        onHoldRef.current();
      }, HOLD_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!timerRef.current) return;
      const t = e.touches[0];
      const dx = Math.abs(t.clientX - startX.current);
      const dy = Math.abs(t.clientY - startY.current);
      if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clear();
    };

    const onTouchEnd = () => clear();

    const onContextMenu = (e: Event) => {
      if (fired.current) e.preventDefault();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      clear();
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  return (
    <div ref={rootRef} className={className}>
      {children}
    </div>
  );
}
