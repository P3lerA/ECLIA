import { useCallback, useEffect, useRef, useState } from "react";
import type { ValidationError } from "@eclia/symphony-protocol";

export function ValidationModal({ errors, onClose }: { errors: ValidationError[]; onClose: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from header, not from close button
    if ((e.target as HTMLElement).closest(".sym-modal-close")) return;
    const modal = (e.target as HTMLElement).closest(".sym-modal") as HTMLElement;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
  }, [dragging]);

  const onPointerUp = useCallback(() => { setDragging(false); }, []);

  const undocked = pos !== null;

  return (
    <div
      className={`sym-modal-backdrop${undocked ? " sym-modal-backdrop--undocked" : ""}`}
      onClick={undocked ? undefined : onClose}
    >
      <div
        className="sym-modal"
        onClick={(e) => e.stopPropagation()}
        style={undocked ? { position: "fixed", left: pos.x, top: pos.y, margin: 0 } : undefined}
      >
        <div
          className={`sym-modal-header${undocked ? " sym-modal-header--draggable" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <span className="sym-modal-title">Validation Failed</span>
          <button className="sym-modal-close" onClick={onClose}>&times;</button>
        </div>
        <ul className="sym-modal-errors">
          {errors.map((err, i) => (
            <li key={i} className="sym-modal-error-item">
              <code className="sym-modal-error-code">{err.code}</code>
              <span>{err.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
