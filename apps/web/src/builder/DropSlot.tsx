import { useEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { clearBuilderDrag, setDragHoverSlot } from "./builderDrag";

const DRAG_TYPES = ["application/x-palette", "application/x-block-path"] as const;

export function isBuilderDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  const list = Array.from(types as unknown as string[]);
  return DRAG_TYPES.some((t) => list.includes(t));
}

export function markBuilderDragging(on: boolean) {
  document.documentElement.classList.toggle("builder-is-dragging", on);
  if (!on) clearBuilderDrag();
}

type Variant = "gap" | "append" | "canvas" | "replace";

type Props = {
  variant?: Variant;
  empty?: boolean;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  onDrop: (e: DragEvent) => void;
  onClick?: () => void;
};

/** Highlight only — the single drag proxy expands into this slot. */
export default function DropSlot({
  variant = "append",
  empty = false,
  disabled = false,
  className = "",
  children,
  onDrop,
  onClick,
}: Props) {
  const [hot, setHot] = useState(false);
  const depthRef = useRef(0);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clear = () => {
      depthRef.current = 0;
      setHot(false);
      setDragHoverSlot(null);
    };
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  if (disabled) return null;

  const activate = (e: DragEvent) => {
    if (!isBuilderDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const isPalette = Array.from(
      e.dataTransfer.types as unknown as string[],
    ).includes("application/x-palette");
    e.dataTransfer.dropEffect = isPalette ? "copy" : "move";
  };

  const onDragEnter = (e: DragEvent) => {
    if (!isBuilderDrag(e)) return;
    activate(e);
    depthRef.current += 1;
    if (depthRef.current === 1) {
      setHot(true);
      if (ref.current) setDragHoverSlot(ref.current);
    }
  };

  const onDragLeave = (e: DragEvent) => {
    if (!isBuilderDrag(e)) return;
    e.stopPropagation();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) {
      setHot(false);
      setDragHoverSlot(null);
    }
  };

  const onDragOver = (e: DragEvent) => {
    activate(e);
    if (ref.current) setDragHoverSlot(ref.current);
  };

  const handleDrop = (e: DragEvent) => {
    if (!isBuilderDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depthRef.current = 0;
    setHot(false);
    setDragHoverSlot(null);
    onDrop(e);
    clearBuilderDrag();
  };

  const classNames = [
    "builder-drop-slot",
    `builder-drop-slot--${variant}`,
    empty ? "is-empty" : "",
    hot ? "is-hot" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        className={classNames}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={handleDrop}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      ref={ref as Ref<HTMLDivElement>}
      className={classNames}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}
