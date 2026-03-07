import React from "react";
import { useAppDispatch, useAppSelector } from "../../state/AppState";
import { WebGLContourBackground } from "./WebGLContourBackground";

export function BackgroundRoot() {
  const textureDisabled = useAppSelector((s) => s.settings.textureDisabled);
  const gpuAvailable = useAppSelector((s) => s.gpu.available);
  const dispatch = useAppDispatch();

  const onStatus = React.useCallback(
    (available: boolean) => {
      dispatch({ type: "gpu/available", available });
    },
    [dispatch]
  );

  // Solid background only (no texture).
  if (textureDisabled) {
    return <div className="bg-root" aria-hidden="true" data-texture="off" />;
  }


  return (
    <div className="bg-root" aria-hidden="true" data-texture="on">
      {/* If GPU is unavailable: do not mount WebGL again (avoid repeated failures). */}
      {gpuAvailable !== false ? <WebGLContourBackground onStatus={onStatus} /> : null}
    </div>
  );
}
