import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";

const GAP = 10;
const LABEL = 16;

/* narrow screens get a horizontal strip along the bottom instead of a
   column down the side, or the rail sits on top of the object */
const NARROW = "(max-width: 640px)";

function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = (e) => setNarrow(e.matches);
    mq.addEventListener("change", on);
    setNarrow(mq.matches);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/* a stack of live thumbnails. one canvas and one renderer for the whole
   rail, scissored into a cell per timer, rather than a context each. */
export default function ThumbRail({
  timers,
  activeId,
  paramsByTimer,
  onSelect,
}) {
  const canvasRef = useRef(null);
  const S = useRef({});
  const narrow = useNarrow();

  const cell = narrow ? 58 : 76;
  const strideX = narrow ? cell + GAP : 0;
  const strideY = narrow ? 0 : cell + LABEL + GAP;
  const canvasW = narrow ? (timers.length - 1) * strideX + cell : cell;
  const canvasH = narrow ? cell : (timers.length - 1) * strideY + cell;

  S.current.activeId = activeId;
  S.current.paramsByTimer = paramsByTimer;
  S.current.layout = { cell, strideX, strideY, canvasW, canvasH };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
    } catch (err) {
      /* a second GL context is not guaranteed. the rail is a nicety, so
         fail quiet and leave the cards as plain buttons. */
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if (THREE.sRGBEncoding !== undefined)
      renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setScissorTest(true);

    const items = timers.map((def) => {
      const scene = new THREE.Scene();
      const inst = def.build();
      scene.add(inst.root);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8e9b8c, 0.75));
      const key = new THREE.DirectionalLight(0xffffff, 1.45);
      key.position.set(-3, 4.6, 5.4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xdfeee4, 0.4);
      fill.position.set(4, 1.2, 3);
      scene.add(fill);

      const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      const t = def.thumb ?? { phi: 1.33, theta: 0, radius: 7.4 };

      inst.applyParams(def.defaults);
      inst.setTime(1500, def.defaults);
      inst.paintButtons(def.defaults, false);

      return { def, scene, inst, cam, thumb: t, applied: null };
    });

    let raf;
    const clock = new THREE.Clock();
    function frame() {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.05, clock.getDelta());
      const L = S.current.layout;

      renderer.setSize(L.canvasW, L.canvasH, false);
      canvas.style.width = `${L.canvasW}px`;
      canvas.style.height = `${L.canvasH}px`;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const active = it.def.id === S.current.activeId;

        /* the selected card sits square on, the others drift */
        const sway = reduce ? 0 : Math.sin(now * 0.0004 + i * 1.7) * 0.42;
        const theta = it.thumb.theta + (active ? sway * 0.35 : sway);
        const phi = it.thumb.phi + (reduce ? 0 : Math.sin(now * 0.00027) * 0.06);
        const r = it.thumb.radius;
        it.cam.position.set(
          r * Math.sin(phi) * Math.sin(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.cos(theta)
        );
        it.cam.lookAt(0, 0, 0);

        it.inst.update(dt, { running: false, seconds: 1500, total: 1500 });

        /* scissor is measured from the bottom left of the canvas */
        const ox = i * L.strideX;
        const oy = i * L.strideY;
        const y = L.canvasH - (oy + L.cell);
        renderer.setViewport(ox, y, L.cell, L.cell);
        renderer.setScissor(ox, y, L.cell, L.cell);
        renderer.render(it.scene, it.cam);
      }
    }
    frame();

    S.current.sync = () => {
      for (const it of items) {
        const p = S.current.paramsByTimer?.[it.def.id];
        if (!p || it.applied === p) continue;
        it.applied = p;
        it.inst.applyParams(p);
        it.inst.setTime(1500, p);
        it.inst.paintButtons(p, false);
      }
    };
    S.current.sync();

    return () => {
      cancelAnimationFrame(raf);
      for (const it of items) it.inst.dispose();
      renderer.dispose();
    };
  }, [timers]);

  useEffect(() => {
    S.current.sync && S.current.sync();
  }, [paramsByTimer]);

  return (
    <div
      className={`dm absolute z-20 ${
        narrow
          ? "bottom-6 left-1/2 -translate-x-1/2"
          : "left-4 top-1/2 -translate-y-1/2"
      }`}
    >
      <div className="relative rounded-2xl bg-white/55 backdrop-blur-md p-2 shadow-lg shadow-black/5">
        <canvas
          ref={canvasRef}
          className="absolute left-2 top-2 pointer-events-none"
        />
        <div className={narrow ? "flex items-start" : ""}>
          {timers.map((t, i) => {
            const active = t.id === activeId;
            const last = i === timers.length - 1;
            return (
              <button
                key={t.id}
                onClick={() => onSelect(t.id)}
                title={t.name}
                aria-pressed={active}
                className="block text-left transition-transform hover:scale-[1.03]"
                style={{
                  width: cell,
                  marginRight: narrow && !last ? GAP : 0,
                  marginBottom: !narrow && !last ? GAP : 0,
                }}
              >
                <div
                  className="relative rounded-xl transition-colors"
                  style={{
                    width: cell,
                    height: cell,
                    background: active
                      ? "rgba(255,255,255,.72)"
                      : "rgba(255,255,255,.22)",
                    boxShadow: active
                      ? "0 0 0 2px rgba(27,36,28,.75)"
                      : "0 0 0 1px rgba(27,36,28,.12)",
                  }}
                >
                  {/* the canvas draws through here; this scrim dims the
                      cards that are not selected */}
                  {!active && (
                    <div className="absolute inset-0 rounded-xl bg-white/35" />
                  )}
                </div>
                <div
                  className="text-[10px] leading-4 text-center truncate transition-opacity"
                  style={{ height: LABEL, opacity: active ? 0.75 : 0.4 }}
                >
                  {t.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
