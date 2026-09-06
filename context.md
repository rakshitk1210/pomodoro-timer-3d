# Time Timer 3D — project context

Handoff notes for continuing this build. Current deliverable is a single React
file, `pomodoro-timer-3d.jsx`, ~190 KB.

---

## Goal

A digital version of the Time Timer desk pomodoro timer. Rendered in 3D, fully
rotatable, usable on laptop and phone. Should feel clean, minimal and fun to
play with rather than like a demo.

Interaction model:

- Drag the dial face to set the time
- Drag anywhere else to rotate the object freely
- Double click to return to the front view
- Remaining time shows on a small physical readout panel on the front of the
  case, not in the surrounding UI

---

## Stack

Currently raw `three` r128 inside a React component, imperative, one file.

This is a constraint of the preview environment, not a preference. The
environment ships three core only, so `OrbitControls` and `GLTFLoader` are both
unavailable. Orbit is hand rolled and the mesh is inlined as base64 rather than
loaded.

**When moving to a real Vite project, port to React Three Fiber plus Drei.**
Same geometry maths, declarative, and `useGLTF` replaces the inline mesh
payload. Suggested deps: `three`, `@react-three/fiber`, `@react-three/drei`,
`zustand` for timer state, `framer-motion` for 2D chrome.

---

## Architecture

### Imported geometry (baked, from Spline)

Three meshes exported from Spline as GLB, then quantised and inlined in the
`MESH` constant at the top of the file. `decodeMesh()` turns each into a
`BufferGeometry`.

| part    | tris  | verts | role                                    |
| ------- | ----- | ----- | --------------------------------------- |
| `body`  | 6,518 | 5,121 | the case, window cut through it         |
| `stand` | 1,308 | 1,312 | decorative plate behind the case        |
| `panel` | 1,400 | 1,229 | readout housing on the front, bottom    |

Encoding: positions as `uint16` with a per mesh offset and range, normals as
`int8`, indices as `uint16`, each base64. Hard edges are preserved by welding
on position **and** normal, then splitting by a 35 degree face angle threshold.

`panel` was decimated from 6,884 tris via quadric decimation. Measured
deviation from the original surface: mean 0.0019, max 0.0072 scene units. `body`
is untouched because decimating it cost up to 1% of case width on the silhouette.

### Generated geometry (parametric, in code)

- **Disc** — `THREE.Shape` with `absarc` through `ExtrudeGeometry`. The sweep
  angle *is* the remaining minutes. This is why the whole thing is code and not
  a model. Rebuilt only when the value moves more than 0.01 minutes, so it is
  smooth while dragging and near free while counting down.
- **Backing plate** — rounded rect extrusion, sits behind the window
- **Dial face** — a plane carrying a 2048px canvas texture with 60 ticks,
  numbers every 5, and the faint guide arc
- **Knob and stem** — cylinder and box, stem rotates with the disc

All five live in `faceGroup` so `dialZ` can slide them together.

---

## Measured constants — do not guess these

The Spline body's window is **not square and not centred**. Measured from the
front face inner edge:

```
opening   x  -1.439 .. 1.439      width  2.877
          y  -0.991 .. 1.439      height 2.430
          centre y  +0.224
case      3.2 x 3.2 x 0.704       (scale factor 3.2 / 200)
recess depth              0.435   (front face 0.352, floor ~ -0.083)
readout panel   x -0.604..0.604, y -1.438..-1.073, front face z 0.394
stand           x -1.512..1.512, y -1.473..-0.476, z -0.404..-0.18
```

Derived layout in the file:

```js
DIAL_SIZE = 2.41; // square, fitted to the tighter axis
DIAL_CY = 0.224; // faceGroup y offset
PLATE_W = 3.0;
PLATE_H = 2.7; // rectangle, must cover the full window
PLATE_FRONT = 0.08;
DIAL_Z = 0.085;
DISC_Z = 0.115;
KNOB_Z = 0.2;
STEM_Z = 0.2;
PANEL_FACE_Z = 0.3975;
PANEL_CY = -1.2555;
PANEL_W = 1.13;
PANEL_H = 0.3;
```

Dial texture radii are fractions of `DIAL_SIZE`: ticks 0.375 outer, major tick
inner 0.343, guide arc 0.398, numbers 0.437. At 2.41 that puts the major tick
inner edge at 0.827, which is why the disc radius slider caps at 0.82.

---

## Bugs already found and fixed — do not reintroduce

1. **`renderer.setSize(w, h, false)`** — the third argument skips setting the
   canvas CSS size, so on a 2x display the canvas rendered at twice its
   container and spilled out of frame. Always pass two arguments.
2. **Dial plane buried inside the plate** — it was at `z = -0.235` while the
   plate front was at `-0.22`, so the ticks and numbers never rendered.
3. **Disc larger than the tick ring** — disc radius 1.02 against a tick outer
   radius of 0.98 meant the disc covered the markings.
4. **Dial face assumed square and centred** — caused the 25, 30 and 35 numbers
   to be clipped by the bottom of the window. See measured constants above.
5. **Dial drag inverted from behind** — once full rotation was enabled, screen
   space angle deltas flip sign when the camera is behind the face. Corrected
   with `camera.position.z >= 0 ? 1 : -1`.
6. **Clicks reaching the knob through the case** — the raycast originally only
   tested the disc, dial and knob, so a drag on the *back* of the case silently
   changed the time. It now tests the body, stand and panel too and only dials
   if the face is the nearest hit.

---

## Other things worth knowing

- **Timer counts from a stored `endTimestamp`**, never an accumulating
  interval. Background tabs throttle timers, and accumulating would desync the
  disc from real elapsed time. Keep it this way.
- **Angle wraparound** on the dial drag is handled by unwrapping the per frame
  delta, not by reading absolute angle. Dragging past 0 must not snap.
- **The body is an open shell.** No floor, no back panel. The backing plate
  covers the back opening, so from behind you see the plate's back face. Adding
  a real back panel is a few lines if wanted.
- **Counterclockwise.** Minute `m` sits at angle `PI/2 + (m/60) * 2PI`. Zero at
  top, 15 at left. This matches the real product.
- **No `TIME TIMER` wordmark.** It is a trademark and was deliberately left off.
  Time Timer also holds design patents on the disc mechanism. Personal use is
  fine; shipping is a separate conversation.
- **Digits** render to a 1024x272 canvas and map onto a plane 0.0035 units proud
  of the panel face, with an unlit `MeshBasicMaterial` so they read as backlit
  rather than picking up the key light.

---

## The Design panel

Press "Design", top right. Live parameters so form and look can be iterated
without a code round trip.

- **Form** — disc radius, disc thickness, knob size, dial depth
- **Material** — case roughness, clearcoat, key light, ambient, exposure, shadow
- **Colours** — case, disc, face, panel, digits, backdrop
- **Presets** — Original, Ink, Machined, Citrus, Night
- **Copy values** — puts the current params on the clipboard as JSON

Corner radius, bezel width, case depth and edge softness used to be sliders.
They are gone because those are baked into the imported Spline mesh now. To
change them, change the mesh.

---

## Regenerating the mesh payload

If the Spline export changes, re run the packing step rather than hand editing.
Rough shape of it:

1. Parse the GLB JSON and BIN chunks
2. Apply each node's world matrix, subtract the body node's translation as the
   origin, scale by `3.2 / 200`
3. Weld on rounded position plus normal, then split vertices by a 35 degree
   face angle threshold to keep hard edges
4. Quantise positions to `uint16` over the per mesh bbox, normals to `int8`,
   indices to `uint16`, base64 each
5. Inject into the JSX at the `MESH` constant

Deps used: `numpy`, `trimesh`, `fast_simplification`, `scipy`.

**Do not emit the base64 by hand.** Write the JSX with a `__MESH_DATA__`
placeholder and substitute it with a script.

---

## Formats that did and did not work

- **GLB from Spline, 3D Formats export** — correct. Geometry only, drops into
  the existing scene, keeps all lighting and material work.
- **Spline Code Export** — wrong. Brings Spline's own camera, lights and
  `OrbitControls`, and replaces the scene rather than plugging into it.
- **`.splinecode`** — wrong. 14 KB of proprietary MessagePack with custom
  extension types. Contains no geometry, only a procedural description. Useless
  without `@splinetool/runtime`, which then owns rendering.
- **Rodin AI generated GLB** — wrong. 500k tris, 23.5 MB, everything fused into
  a single mesh with baked textures, non square proportions. No separable disc.

---

## Open items

- Legibility of the digits at oblique angles. The panel is small, 1.13 by 0.30,
  and near the bottom edge.
- The window is wider than tall, 2.877 against 2.430. The dial is square and
  fitted to the tighter axis, leaving about 0.23 of plain plate on each side.
  Same colour so it reads as one surface, but filling the full width would mean
  an oval dial or an elongated tick ring.
- No back panel on the case.
- Optional: replace the procedural dial texture with an SVG exported from Figma
  for full control over the typography.
- Not yet built: notifications, break cycles, session counts, persistence.
  Note that iOS PWAs cannot reliably fire notifications when backgrounded, which
  is the one real argument for going native later.
