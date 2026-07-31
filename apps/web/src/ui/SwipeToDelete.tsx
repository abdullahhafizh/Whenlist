import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const SWIPE_THRESHOLD = 88;
const SWIPE_MAX = 140;

type Props = {
  disabled?: boolean;
  onSwipeDelete: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * Mobile swipe-left to reveal red delete zone and commit dismiss.
 */
export default function SwipeToDelete({
  disabled,
  onSwipeDelete,
  children,
  className = "",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const axisLock = useRef<"x" | "y" | null>(null);
  const offsetRef = useRef(0);
  const moved = useRef(false);
  const draggingRef = useRef(false);
  const disabledRef = useRef(disabled);
  const onSwipeDeleteRef = useRef(onSwipeDelete);

  disabledRef.current = disabled;
  onSwipeDeleteRef.current = onSwipeDelete;

  const setOffsetBoth = (x: number) => {
    offsetRef.current = x;
    setOffset(x);
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current) return;
      const t = e.touches[0];
      startX.current = t.clientX;
      startY.current = t.clientY;
      axisLock.current = null;
      moved.current = false;
      draggingRef.current = true;
      setDragging(true);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (disabledRef.current || !draggingRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;

      if (!axisLock.current) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axisLock.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axisLock.current !== "x") return;

      e.preventDefault();
      moved.current = true;
      const next = Math.min(0, Math.max(-SWIPE_MAX, dx));
      setOffsetBoth(next);
    };

    const onTouchEnd = () => {
      if (disabledRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      const x = offsetRef.current;
      if (moved.current && x <= -SWIPE_THRESHOLD) {
        setOffsetBoth(-SWIPE_MAX * 1.2);
        onSwipeDeleteRef.current();
      } else {
        setOffsetBoth(0);
      }
      axisLock.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const redReveal = Math.min(1, Math.abs(offset) / SWIPE_THRESHOLD);

  return (
    <div ref={rootRef} className={`checklist-swipe ${className}`}>
      <div
        className="checklist-swipe__bg"
        style={{ opacity: 0.35 + redReveal * 0.65 }}
        aria-hidden
      >
        <span className="checklist-swipe__icon" aria-label="Delete">
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
            <path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </span>
      </div>
      <div
        className={`checklist-swipe__fg ${dragging ? "is-dragging" : ""}`}
        style={{ "--swipe-x": `${offset}px` } as CSSProperties}
        onClickCapture={(e) => {
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
