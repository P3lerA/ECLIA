# ECLIA Motion Spec (v0.1)

This document defines a small, extensible motion system for **ECLIA Console**.
The goal is *calm, purposeful motion* that improves clarity without becoming a performance tax.

---

## 1) Principles

### Purpose first
Motion should communicate one of these:
- **Spatial relationship** (where something came from / where it goes)
- **State change** (opened, closed, sent, selected)
- **Feedback** (hover, press, focus, success)

If it does not add clarity, remove it.

### Quiet by default
- Keep offsets small (4–14px).
- Avoid constant motion except for very slow ambient background effects.
- Prefer easing that feels organic (gentle deceleration).

### Performance-safe
- Animate **opacity** and **transform** only (translate/scale).
- Avoid animating layout (height/width/top/left) when possible.
- Avoid forcing synchronous GPU/CPU readbacks.

### Accessible
Respect user preference:
- If `prefers-reduced-motion: reduce`, disable non-essential animation and stop ambient loops.

---

## 2) Motion tokens

Tokens live in `src/styles/motion.css` as CSS variables.

### Durations
- `--motion-1`: 105ms  (micro feedback: hover/press)
- `--motion-2`: 160ms (fast UI)
- `--motion-3`: 250ms (default enter)
- `--motion-4`: 370ms (page transitions)
- `--motion-5`: 600ms (slow/ambient emphasis)

### Easing curves
- `--ease-standard`: general UI motion
- `--ease-enter`: decelerating, slightly emphasized
- `--ease-exit`: accelerating, quick out
- `--ease-linear`: ambient/looped motion

### Distances
Use small offsets (screen-space):
- `--dist-1`: 4px
- `--dist-2`: 8px
- `--dist-3`: 14px

---

## 3) Patterns

### Page enter
Use `motion-page` on the top-level container.
- Fade + slight rise
- Duration `--motion-4`

### Composer docking (Chat)
Keep the composer fixed to the viewport to avoid layout push from growing message history.
- Use a fixed `composerDock` wrapper
- Animate entry once when transitioning from Landing → Chat (`motion-dock`)
- Reserve space in the scroll area (bottom padding) so messages are not hidden behind the composer

### Bottom sheet (Menu)
Use `usePresence(open)` to keep the sheet mounted during exit animation.
- Overlay: fade in/out
- Sheet: rise in / drop out
- Duration `--motion-3`

### List/message entry
Use `motion-msg` on inserted list items (messages, menu items, etc.)
- Small rise + fade
- Duration `--motion-2` or `--motion-3`

### Micro interactions
Buttons and interactive surfaces:
- Hover: 1px lift (transform)
- Press: slight scale down
- Focus: ring appears (box-shadow), no jump

---

## 4) Reduced motion

In `motion.css` we shorten durations to ~1ms and disable ambient loops.
Background animation must pause and render a single frame.

Implementation hooks:
- `useReducedMotion()` in `src/features/motion/useReducedMotion.ts`
- `usePresence()` in `src/features/motion/usePresence.ts`

---

## 5) Implementation API

### CSS utility classes
- `motion-page`: page enter animation
- `motion-item`: generic enter animation; can be staggered via `--motion-delay`
- `motion-msg`: small enter animation for list items
- `motion-overlay`: overlay fade
- `motion-sheet`: sheet enter/exit

### Data attributes (state machine)
Components may set:
- `data-motion="enter"`
- `data-motion="exit"`

This keeps the system extensible: new components only need to opt into the state contract.

### Example
```tsx
<div className="motion-item" style={{ ["--motion-delay" as any]: "80ms" }}>
  ...
</div>
```

---

## 6) Do / Don't

✅ Do
- Use motion to explain structure (sheets, navigation, insertion)
- Keep it subtle
- Use reduced-motion fallback

❌ Don't
- Animate layout-heavy properties by default
- Run expensive per-frame checks
- Add multiple competing animations on the same element


## Implementation note

- Animations that use `transform` should end at `transform: none` (not `translateY(0) scale(1)`) to avoid accidentally creating a containing block that breaks `position: fixed` descendants.
