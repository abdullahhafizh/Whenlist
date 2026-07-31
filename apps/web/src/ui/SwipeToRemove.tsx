import {
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
} from "react";

const SWIPE_THRESHOLD = 88;
const SWIPE_MAX = 140;

type Props = {
  disabled?: boolean;
  onSwipeRemove: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  cardRef?: (el: HTMLDivElement | null) => void;
};

/**
 * Mobile swipe-left to remove. Red reveal under the card; past threshold
 * fires onSwipeRemove (parent handles exit + undo).
 */
export default function SwipeToRemove({
  disabled,
  onSwipeRemove,
  children,
  className = "",
  style,
  cardRef,
}: Props) {
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  const axis = useRef<"h" | "v" | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onTouchStart = (e: TouchEvent) => {
    if (disabled) return;
    const t = e.touches[0];
    if (!t) return;
    startX.current = t.clientX;
    startY.current = t.clientY;
    tracking.current = true;
    axis.current = null;
    setDragging(true);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!tracking.current || disabled) return;
    const t = e.touches[0];
    if (!t) return;
    const rawX = t.clientX - startX.current;
    const rawY = t.clientY - startY.current;

    if (axis.current === null) {
      if (Math.abs(rawX) < 8 && Math.abs(rawY) < 8) return;
      axis.current = Math.abs(rawX) > Math.abs(rawY) ? "h" : "v";
      if (axis.current === "v") {
        tracking.current = false;
        setDragging(false);
        setDx(0);
        return;
      }
    }
    if (axis.current !== "h") return;

    // Only swipe left
    const next = Math.max(-SWIPE_MAX, Math.min(0, rawX));
    setDx(next);
    if (next < -12) e.preventDefault();
  };

  const finish = (commit: boolean) => {
    tracking.current = false;
    axis.current = null;
    setDragging(false);
    if (commit) {
      setDx(-SWIPE_MAX * 1.2);
      onSwipeRemove();
    } else {
      setDx(0);
    }
  };

  const onTouchEnd = () => {
    if (!tracking.current && dx === 0) {
      setDragging(false);
      return;
    }
    finish(dx <= -SWIPE_THRESHOLD);
  };

  const onTouchCancel = () => finish(false);

  const progress = Math.min(1, Math.abs(dx) / SWIPE_THRESHOLD);

  return (
    <div className="swipe-shell relative overflow-hidden rounded-2xl">
      <div
        className="swipe-behind pointer-events-none absolute inset-0 flex items-center justify-end bg-red-500 px-5"
        aria-hidden
      >
        <span
          className="text-sm font-semibold text-white transition-opacity"
          style={{ opacity: 0.35 + progress * 0.65 }}
        >
          Hapus
        </span>
      </div>
      <div
        ref={cardRef}
        className={`swipe-front ${className} ${dragging ? "is-dragging" : ""}`}
        style={{
          ...style,
          transform: dx !== 0 ? `translateX(${dx}px)` : undefined,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {children}
      </div>
    </div>
  );
}
