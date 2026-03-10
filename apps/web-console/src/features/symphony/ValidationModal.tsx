import { useEffect } from "react";
import type { ValidationError } from "@eclia/symphony-protocol";

export function ValidationModal({ errors, onClose }: { errors: ValidationError[]; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="sym-modal-backdrop" onClick={onClose}>
      <div className="sym-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sym-modal-header">
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
