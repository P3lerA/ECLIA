import React from "react";
import { useReducedMotion } from "../motion/useReducedMotion";

type Props = {
  onStatus?: (available: boolean) => void;
};

const VERT = `#version 300 es
precision highp float;

// Fullscreen triangle (no VBO needed): gl_VertexID in WebGL2
const vec2 POS[3] = vec2[](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);

void main() {
  gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0);
}
`;

/**
 * Fragment shader: a lightweight noise field + contour/isolines.
 * - Value noise + FBM
 * - Isoline stripes via fract(), anti-aliased with fwidth()
 *
 * Goal: subtle light-gray topographic contours with a slow "breathing" motion.
 * The field stays anchored (no translation); only the contours morph over time.
 */
const FRAG = `#version 300 es
precision highp float;

out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;

float hash21(vec2 p) {
  // Cheap hash
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Smooth interpolation
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * valueNoise(p);
    p = m * p;
    a *= 0.55;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;

  // Aspect-correct space
  vec2 p = uv;
  p.x *= u_resolution.x / u_resolution.y;

  // Base scale controls the "map" size
  p *= 4.0;

  float t = u_time;

  // Slow breathing: no translation, just a gentle morph in place.
  // (Two waves to avoid looking perfectly periodic.)
  float breath = 0.5 * sin(t * 0.30) + 0.5 * sin(t * 0.19 + 1.7);

  // Domain warp: makes it feel more topographic.
  float w1 = fbm(p * 0.9 + 12.3);
  float w2 = fbm(p * 0.9 + 98.1);
  float warpAmp = 0.22 + 0.055 * breath;
  p += warpAmp * vec2(w1 - 0.5, w2 - 0.5);

  float h = fbm(p);

  // Reuse a low-frequency phase for subtle shading & micro-breathing.
  float phase = fbm(p * 0.6 + 200.0);

  // Global shift (more noticeable breathing).
  h += breath * 0.03;

  // Local micro-breathing (keeps it organic, but still gentle).
  h += sin(t * 0.30 + phase * 6.2831853) * 0.012;

  // Contour density: higher = denser lines.
  float k = 11.0;
  float x = h * k;

  // Distance to the line center in value-space
  float d = abs(fract(x) - 0.5);

  // Pixel-space uniform thickness: normalize by fwidth(x).
  float w = max(fwidth(x), 1e-4);
  float distPx = d / w;

  float thickness = 0.85; // thinner lines (approx px half-width)
  float line = 1.0 - smoothstep(thickness, thickness + 1.0, distPx);

  // Very subtle shading so it doesn't look flat.
  float shade = phase * 0.05;

  vec3 bg = vec3(0.965, 0.969, 0.973);      // ~ #f6f7f8
  vec3 contour = vec3(0.82, 0.83, 0.85);    // light gray lines

  vec3 col = bg - shade;

  // Subtle breathing in contrast as well (helps readability without being loud).
  float ink = 0.42 + 0.04 * breath;
  col = mix(col, contour, line * ink);

  outColor = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "(no log)";
    gl.deleteShader(sh);
    throw new Error("Shader compile failed: " + log);
  }
  return sh;
}

function createProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);

  const prog = gl.createProgram();
  if (!prog) throw new Error("createProgram failed");

  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || "(no log)";
    gl.deleteProgram(prog);
    throw new Error("Program link failed: " + log);
  }

  return prog;
}

function clampDpr(dpr: number): number {
  // Decorative background: no need to push full Retina DPR (saves power & heat).
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(dpr, 1.5);
}

export function WebGLContourBackground({ onStatus }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = useReducedMotion();

  const rafRef = React.useRef<number | null>(null);
  const timeoutRef = React.useRef<number | null>(null);

  const glRef = React.useRef<WebGL2RenderingContext | null>(null);
  const progRef = React.useRef<WebGLProgram | null>(null);
  const vaoRef = React.useRef<WebGLVertexArrayObject | null>(null);

  const uResRef = React.useRef<WebGLUniformLocation | null>(null);
  const uTimeRef = React.useRef<WebGLUniformLocation | null>(null);

  const lostRef = React.useRef(false);
  const confirmedRef = React.useRef(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const stop = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };

    const clearFailSafe = () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };

    const cleanupGL = () => {
      stop();
      clearFailSafe();

      const gl = glRef.current;
      if (gl) {
        if (progRef.current) gl.deleteProgram(progRef.current);
        if (vaoRef.current) gl.deleteVertexArray(vaoRef.current);
      }
      glRef.current = null;
      progRef.current = null;
      vaoRef.current = null;
      uResRef.current = null;
      uTimeRef.current = null;
    };

    const resize = (gl: WebGL2RenderingContext) => {
      const dpr = clampDpr(window.devicePixelRatio || 1);
      const cssW = Math.max(1, window.innerWidth);
      const cssH = Math.max(1, window.innerHeight);
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      // Write u_resolution every frame: tiny cost, avoids NaN/black-screen edge cases on some implementations.
      const uRes = uResRef.current;
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    };

    const init = () => {
      lostRef.current = false;
      confirmedRef.current = false;

      const gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power",
        preserveDrawingBuffer: false
      });

      if (!gl) {
        onStatus?.(false);
        return false;
      }

      glRef.current = gl;

      const prog = createProgram(gl, VERT, FRAG);
      progRef.current = prog;

      gl.useProgram(prog);

      // WebGL2 requires a VAO bound (even if we don't use attributes).
      const vao = gl.createVertexArray();
      if (!vao) throw new Error("createVertexArray failed");
      vaoRef.current = vao;
      gl.bindVertexArray(vao);

      uResRef.current = gl.getUniformLocation(prog, "u_resolution");
      uTimeRef.current = gl.getUniformLocation(prog, "u_time");

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      // Initialize viewport + u_resolution to avoid NaNs on the first frame.
      resize(gl);

      return true;
    };

    const renderLoop = (startMs: number) => {
      let lastDraw = 0;
      const targetFrameMs = 1000 / 30;

      const tick = (now: number) => {
        if (lostRef.current) return;

        // If the tab is hidden, skip rendering (save power).
        if (document.hidden) {
          if (!reducedMotion) rafRef.current = requestAnimationFrame(tick);
          return;
        }

        // Decorative background: cap to ~30fps unless reduced-motion is on (then render once).
        if (!reducedMotion && now - lastDraw < targetFrameMs) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        lastDraw = now;

        const gl = glRef.current;
        const prog = progRef.current;
        const vao = vaoRef.current;
        if (!gl || !prog || !vao) return;

        gl.useProgram(prog);
        gl.bindVertexArray(vao);

        resize(gl);

        const t = reducedMotion ? 0.0 : (now - startMs) / 1000.0;
        const uTime = uTimeRef.current;
        if (uTime) gl.uniform1f(uTime, t);

        gl.clearColor(0.965, 0.969, 0.973, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // One-shot smoke test: ensure we didn't render an all-black frame.
        if (!confirmedRef.current) {
          try {
            const px = new Uint8Array(4);
            const x = Math.min(10, Math.max(0, canvas.width - 1));
            const y = Math.min(10, Math.max(0, canvas.height - 1));
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const lum = px[0] + px[1] + px[2];

            if (lum < 15) {
              // eslint-disable-next-line no-console
              console.warn("[bg] smoke test: near-black pixel, downgrade", px);
              lostRef.current = true;
              onStatus?.(false);
              cleanupGL();
              return;
            }

            confirmedRef.current = true;
            clearFailSafe();
            onStatus?.(true);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn("[bg] smoke test failed, downgrade", err);
            lostRef.current = true;
            onStatus?.(false);
            cleanupGL();
            return;
          }
        }

        // Reduced motion: render a single frame and stop.
        if (reducedMotion) {
          stop();
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      stop();
      rafRef.current = requestAnimationFrame(tick);
    };

    const onLost = (e: Event) => {
      e.preventDefault();
      lostRef.current = true;
      onStatus?.(false);
      cleanupGL();
    };

    const onRestored = () => {
      cleanupGL();
      try {
        const ok = init();
        if (ok) {
          // Failsafe: after context restore we need to re-confirm we can render.
          timeoutRef.current = window.setTimeout(() => {
            if (!confirmedRef.current && !lostRef.current) {
              // eslint-disable-next-line no-console
              console.warn("[bg] no frame confirmed within timeout (restored), downgrade");
              lostRef.current = true;
              onStatus?.(false);
              cleanupGL();
            }
          }, 1200);

          renderLoop(performance.now());
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[bg] WebGL restore failed", err);
        onStatus?.(false);
      }
    };

    const onWinResize = () => {
      const gl = glRef.current;
      const prog = progRef.current;
      if (!gl || !prog) return;
      gl.useProgram(prog);
      resize(gl);
    };

    try {
      const ok = init();
      if (ok) {
        timeoutRef.current = window.setTimeout(() => {
          if (!confirmedRef.current && !lostRef.current) {
            // eslint-disable-next-line no-console
            console.warn("[bg] no frame confirmed within timeout, downgrade");
            lostRef.current = true;
            onStatus?.(false);
            cleanupGL();
          }
        }, 1200);

        renderLoop(performance.now());
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[bg] WebGL init failed", err);
      onStatus?.(false);
    }

    window.addEventListener("resize", onWinResize);
    canvas.addEventListener("webglcontextlost", onLost as any, { passive: false });
    canvas.addEventListener("webglcontextrestored", onRestored as any);

    return () => {
      window.removeEventListener("resize", onWinResize);
      canvas.removeEventListener("webglcontextlost", onLost as any);
      canvas.removeEventListener("webglcontextrestored", onRestored as any);
      cleanupGL();
    };
  }, [onStatus, reducedMotion]);

  return <canvas ref={canvasRef} className="bg-canvas" aria-hidden="true" />;
}

