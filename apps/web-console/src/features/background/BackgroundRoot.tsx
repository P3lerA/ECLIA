import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { WebGLContourBackground } from "./WebGLContourBackground";

export function BackgroundRoot() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const onStatus = React.useCallback(
    (available: boolean) => {
      dispatch({ type: "gpu/available", available });
    },
    [dispatch]
  );

  // Solid background only (no texture).
  if (state.settings.textureDisabled) {
    return <div className="bg-root" aria-hidden="true" data-texture="off" />;
  }


  return (
    <div className="bg-root" aria-hidden="true" data-texture="on">
      {/* If GPU is unavailable: do not mount WebGL again (avoid repeated failures). */}
      {state.gpu.available !== false ? <WebGLContourBackground onStatus={onStatus} /> : null}
    </div>
  );
}
