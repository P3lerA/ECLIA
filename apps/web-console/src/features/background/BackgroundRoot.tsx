import React from "react";
import { useAppDispatch, useAppState } from "../../state/AppState";
import { WebGLContourBackground } from "./WebGLContourBackground";
import { StaticContourBackground } from "./StaticContourBackground";

export function BackgroundRoot() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const onStatus = React.useCallback(
    (available: boolean) => {
      dispatch({ type: "gpu/available", available });
    },
    [dispatch]
  );

  // Solid background only (no GPU texture + no static fallback).
  if (state.settings.textureDisabled) {
    return <div className="bg-root" aria-hidden="true" data-texture="off" />;
  }

  const wantStatic = state.gpu.available === false && state.settings.staticContourFallback;

  return (
    <div className="bg-root" aria-hidden="true" data-texture="on">
      {/* If GPU is unavailable: do not mount WebGL again (avoid repeated failures). */}
      {state.gpu.available !== false ? <WebGLContourBackground onStatus={onStatus} /> : null}
      {wantStatic ? <StaticContourBackground /> : null}
    </div>
  );
}
