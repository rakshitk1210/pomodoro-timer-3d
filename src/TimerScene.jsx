import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as THREE from "three";
import {
  CalendarDaysIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { createLofiBed, DEFAULT_VOLUME } from "./lofiBed";
import { playButtonClick, playDialTicks, playWoosh, unlockSfx } from "./sfx";
import { makeBackdrop, playChime } from "./lib/three-utils";
import { TIMERS, byId } from "./timers/registry";
import ThumbRail from "./ThumbRail";
import SessionDrawer from "./components/SessionDrawer";
import * as log from "./lib/sessionLog";
import { useSessionLog } from "./hooks/useSessionLog";
import { focusMsOnDay } from "./lib/dayLayout";
import { fmtDuration, startOfDay } from "./lib/time";
import { loadVolume, saveVolume } from "./lib/prefs";

const HOME = { theta: 0, phi: 1.33 };

/* release speed in rad/s: below MIN is a drag, at MAX the woosh is full */
const FLICK_MIN = 3.2;
const FLICK_MAX = 15;

/* a linear control seen end on projects to nothing, and a fraction of
   nothing is infinite. never divide by less than this many pixels. */
const AXIS_MIN_PX = 60;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function initialParams() {
  const out = {};
  for (const t of TIMERS) out[t.id] = { ...t.defaults };
  return out;
}

/* ------------------------------------------------------------------ */

export default function TimerScene() {
  const mountRef = useRef(null);
  const S = useRef({});

  const [activeId, setActiveId] = useState(TIMERS[0].id);
  const [paramsByTimer, setParamsByTimer] = useState(initialParams);
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState("form");
  const [copied, setCopied] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const [volume, setVolume] = useState(loadVolume);

  /* the pill doubles as an at-a-glance daily total. closed segments only, so
     it settles when a session ends rather than ticking with the countdown. */
  const { sessions } = useSessionLog();
  const todayTotal = useMemo(
    () => focusMsOnDay(sessions, startOfDay(Date.now())),
    [sessions]
  );
  const openLog = useCallback(() => setLogOpen(true), []);

  /* one canonical time, in seconds. both timers read and write it. */
  const [seconds, setSeconds] = useState(1500);
  const [setPoint, setSetPoint] = useState(1500);
  const [running, setRunning] = useState(false);

  const endRef = useRef(null);
  const rawRef = useRef(1500);
  const remRef = useRef(0);
  const lastQRef = useRef(1500);
  const secondsRef = useRef(1500);
  const lofiRef = useRef(null);
  /* the bed is built lazily on the first start, and onButton's callback can
     hold a stale render, so read the level through a ref like `seconds` does */
  const volumeRef = useRef(volume);
  /* the level to come back to when unmuting */
  const preMuteRef = useRef(volume || DEFAULT_VOLUME);

  const mod = byId(activeId);
  const params = paramsByTimer[activeId];

  secondsRef.current = seconds;
  volumeRef.current = volume;
  S.current.activeId = activeId;
  S.current.timeState = { running, seconds, total: setPoint };

  /* ---------------- scene ---------------- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding !== undefined)
      renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);
    const el = renderer.domElement;
    el.style.display = "block";
    el.style.touchAction = "none";
    el.style.cursor = "grab";

    /* every timer is built up front and the inactive ones parked, so a
       switch is a slide rather than a rebuild */
    const instances = {};
    for (const t of TIMERS) {
      const inst = t.build();
      inst.def = t;
      /* seed from the live selection, not the first timer, or a remount
         while the cassette is showing starts the stack inside out */
      inst.showT = t.id === S.current.activeId ? 1 : 0;
      scene.add(inst.root);
      instances[t.id] = inst;
    }
    S.current.instances = instances;
    const A = () => instances[S.current.activeId];

    /* lights */
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8e9b8c, 0.62);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(-3.4, 5.2, 5.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    key.shadow.bias = -0.0006;
    Object.assign(key.shadow.camera, {
      near: 1,
      far: 22,
      left: -4.5,
      right: 4.5,
      top: 4.5,
      bottom: -4.5,
    });
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfeee4, 0.42);
    fill.position.set(4.5, 1.2, 3.2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.55);
    rim.position.set(1.5, 2.4, -5);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = TIMERS[0].groundY ?? -1.63;
    ground.receiveShadow = true;
    scene.add(ground);

    /* orbit */
    const orb = {
      theta: HOME.theta,
      phi: HOME.phi,
      tTheta: HOME.theta,
      tPhi: HOME.phi,
      radius: 9,
      dragging: false,
      dialing: false,
      control: null,
      pressing: null,
      lastX: 0,
      lastY: 0,
      prevAngle: 0,
      spin: 0,
      lastMoveAt: 0,
      touched: false,
    };
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();

    function rectNDC(e) {
      const r = el.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      return r;
    }

    /* the angle of the pointer about THIS control's own centre, in screen
       space. the cassette has two knobs, so the pivot cannot be assumed
       to be the object centre. */
    function controlAngle(e, rect, ctrl) {
      const c = tmp
        .copy(ctrl.local)
        .applyMatrix4(ctrl.space.matrixWorld)
        .project(camera);
      const cx = ((c.x + 1) / 2) * rect.width + rect.left;
      const cy = ((1 - c.y) / 2) * rect.height + rect.top;
      return Math.atan2(-(e.clientY - cy), e.clientX - cx);
    }

    /* the screen space vector a LINEAR control's full travel traces out,
       measured symmetrically about the control so perspective does not
       bias one end. projecting a pointer delta onto it gives fraction of
       travel directly, and gets the camera being behind the object for
       free — which is why the rotary `facing` flip has no equivalent here. */
    function axisScreen(rect, ctrl) {
      const half = ctrl.travel / 2;
      const a = tmp
        .copy(ctrl.local)
        .addScaledVector(ctrl.axis, -half)
        .applyMatrix4(ctrl.space.matrixWorld)
        .project(camera);
      const ax = ((a.x + 1) / 2) * rect.width;
      const ay = ((1 - a.y) / 2) * rect.height;
      const b = tmp2
        .copy(ctrl.local)
        .addScaledVector(ctrl.axis, half)
        .applyMatrix4(ctrl.space.matrixWorld)
        .project(camera);
      const bx = ((b.x + 1) / 2) * rect.width;
      const by = ((1 - b.y) / 2) * rect.height;
      return { x: bx - ax, y: by - ay };
    }

    /* blockers are in here so a drag on the BACK of the object is
       swallowed instead of silently setting the time */
    function pickable() {
      const a = A();
      return [
        ...a.buttons.map((b) => b.pad),
        ...a.controls.flatMap((c) => c.meshes),
        ...a.blockers,
      ];
    }

    function onDown(e) {
      const rect = rectNDC(e);
      ray.setFromCamera(ndc, camera);
      unlockSfx();
      const a = A();
      const first = ray.intersectObjects(pickable(), false)[0];
      orb.touched = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {}

      const btn = first && a.buttons.find((b) => b.pad === first.object);
      if (btn) {
        orb.pressing = btn;
        btn.down = true;
        playButtonClick(true);
        el.style.cursor = "pointer";
        return;
      }

      const ctrl =
        first && a.controls.find((c) => c.meshes.includes(first.object));
      el.style.cursor = "grabbing";
      if (ctrl) {
        orb.dialing = true;
        orb.control = ctrl;
        if (ctrl.axis) {
          orb.lastX = e.clientX;
          orb.lastY = e.clientY;
        } else {
          orb.prevAngle = controlAngle(e, rect, ctrl);
        }
        S.current.onControlStart && S.current.onControlStart(ctrl);
      } else {
        orb.dragging = true;
        orb.lastX = e.clientX;
        orb.lastY = e.clientY;
        orb.lastMoveAt = performance.now();
        orb.spin = 0;
      }
    }

    function onMove(e) {
      /* slide off a held button and it un-presses, like a native one */
      if (orb.pressing) {
        rectNDC(e);
        ray.setFromCamera(ndc, camera);
        const f = ray.intersectObjects(pickable(), false)[0];
        orb.pressing.down = !!f && f.object === orb.pressing.pad;
        return;
      }
      if (!orb.dragging && !orb.dialing) {
        rectNDC(e);
        ray.setFromCamera(ndc, camera);
        const f = ray.intersectObjects(pickable(), false)[0];
        const a = A();
        const onPad = f && a.buttons.some((b) => b.pad === f.object);
        const onCtrl =
          f && a.controls.some((c) => c.meshes.includes(f.object));
        el.style.cursor = onPad ? "pointer" : onCtrl ? "grab" : "grab";
      }
      if (orb.dialing && orb.control.axis) {
        const rect = el.getBoundingClientRect();
        const v = axisScreen(rect, orb.control);
        const raw = Math.hypot(v.x, v.y) || 1;
        const len = Math.max(AXIS_MIN_PX, raw);
        const dx = e.clientX - orb.lastX;
        const dy = e.clientY - orb.lastY;
        orb.lastX = e.clientX;
        orb.lastY = e.clientY;
        /* direction from the true projection, sensitivity from the
           floored one, so an end on axis goes stiff rather than wild */
        S.current.onControlMove &&
          S.current.onControlMove(
            orb.control,
            (dx * v.x + dy * v.y) / raw / len
          );
      } else if (orb.dialing) {
        const rect = el.getBoundingClientRect();
        const a2 = controlAngle(e, rect, orb.control);
        let d = a2 - orb.prevAngle;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        orb.prevAngle = a2;
        /* screen space angle deltas flip sign once the camera is behind */
        const facing = camera.position.z >= 0 ? 1 : -1;
        S.current.onControlMove &&
          S.current.onControlMove(orb.control, (d * facing) / (Math.PI * 2));
      } else if (orb.dragging) {
        const dx = e.clientX - orb.lastX;
        const dy = e.clientY - orb.lastY;
        orb.lastX = e.clientX;
        orb.lastY = e.clientY;
        const prevPhi = orb.tPhi;
        orb.tTheta -= dx * 0.0062;
        orb.tPhi = THREE.MathUtils.clamp(orb.tPhi - dy * 0.0055, 0.12, 3.02);

        /* angular speed at the moment of release is what makes a flick a
           flick. phi is clamped, so measure the rotation that landed
           rather than the one that was asked for, or dragging down past
           the pole reads as a flick. */
        const now = performance.now();
        const dt = Math.max(8, now - orb.lastMoveAt) / 1000;
        orb.lastMoveAt = now;
        const moved = Math.hypot(dx * 0.0062, orb.tPhi - prevPhi);
        orb.spin = orb.spin * 0.55 + (moved / dt) * 0.45;
      }
    }

    function onUp(e, cancelled) {
      if (orb.pressing) {
        const b = orb.pressing;
        if (b.down && !cancelled) {
          playButtonClick(false);
          S.current.onButton && S.current.onButton(b.kind);
        }
        b.down = false;
        orb.pressing = null;
        el.style.cursor = "grab";
        try {
          el.releasePointerCapture(e.pointerId);
        } catch (err) {}
        return;
      }
      /* still moving at the moment of release, not a fast drag that
         came to rest first */
      const flicked =
        orb.dragging &&
        !cancelled &&
        performance.now() - orb.lastMoveAt < 90 &&
        orb.spin > FLICK_MIN;
      if (flicked) playWoosh((orb.spin - FLICK_MIN) / (FLICK_MAX - FLICK_MIN));
      orb.spin = 0;
      orb.dragging = false;
      orb.dialing = false;
      orb.control = null;
      el.style.cursor = "grab";
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    function onDouble() {
      const two = Math.PI * 2;
      let t = orb.theta % two;
      if (t > Math.PI) t -= two;
      if (t < -Math.PI) t += two;
      orb.theta = t;
      orb.tTheta = HOME.theta;
      orb.tPhi = HOME.phi;
    }

    const onCancel = (e) => onUp(e, true);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("dblclick", onDouble);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);

    /* the distance that fits the active timer to the tighter axis.
       the two landscape timers are about as wide as they are tall, so
       one number covered both; a portrait object needs its own width or
       a phone zooms out far enough to fit a width it does not have. */
    function targetRadius() {
      const def = A().def;
      const halfY = def.frameHalf ?? 2.2;
      const halfX = def.frameHalfX ?? halfY;
      const tanF = Math.tan((camera.fov * Math.PI) / 360);
      return Math.max(halfY / tanF, halfX / (tanF * camera.aspect));
    }

    function resize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      /* two arguments only. the third skips the CSS size and the canvas
         spills out of frame on a 2x display. */
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      /* snap, never ease: easing here means a portrait phone loads with
         the object hugely overscaled and zooms out afterwards */
      orb.radius = targetRadius();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf;
    const clock = new THREE.Clock();

    function frame() {
      raf = requestAnimationFrame(frame);
      const t = performance.now();
      const dt = Math.min(0.05, clock.getDelta());

      if (!orb.touched && !reduce) {
        orb.tTheta = Math.sin(t * 0.00035) * 0.34;
        orb.tPhi = HOME.phi + Math.sin(t * 0.00023) * 0.05;
      }
      orb.theta += (orb.tTheta - orb.theta) * Math.min(1, dt * 7);
      orb.phi += (orb.tPhi - orb.phi) * Math.min(1, dt * 7);

      /* each timer's own framing, eased so a switch does not jump cut */
      const act = A();
      orb.radius += (targetRadius() - orb.radius) * Math.min(1, dt * 5);

      camera.position.set(
        orb.radius * Math.sin(orb.phi) * Math.sin(orb.theta),
        orb.radius * Math.cos(orb.phi),
        orb.radius * Math.sin(orb.phi) * Math.cos(orb.theta)
      );
      camera.lookAt(0, 0, 0);

      const gy = act.def.groundY ?? -1.63;
      ground.position.y += (gy - ground.position.y) * Math.min(1, dt * 5);

      /* the stack: the active object comes forward, the rest slide back */
      const state = S.current.timeState;
      for (const id of Object.keys(instances)) {
        const inst = instances[id];
        const target = id === S.current.activeId ? 1 : 0;
        inst.showT += (target - inst.showT) * Math.min(1, dt * 7.5);
        const s = inst.showT;
        inst.root.visible = s > 0.02;
        inst.root.position.z = (1 - s) * -2.6;
        inst.root.scale.setScalar(0.84 + 0.16 * s);
        if (inst.root.visible) inst.update(dt, state, target === 1);

        for (const b of inst.buttons) {
          /* a button on a round base does not face +z, so the travel
             runs along its own normal. captured once, here, so a module
             only has to say `axis` if it is not the usual +z. */
          if (!b.home) {
            b.home = b.group.position.clone();
            b.dir = b.axis ?? new THREE.Vector3(0, 0, 1);
            b.at = 0;
          }
          const to = b.down ? -b.press : 0;
          b.at += (to - b.at) * Math.min(1, dt * 26);
          b.group.position.copy(b.home).addScaledVector(b.dir, b.at);
          /* head on, 0.03 of travel reads as nothing, so the cap also
             takes on the shade of the recess as it sinks */
          const k = Math.min(1, -b.at / b.press);
          if (b.baseColor)
            b.mat.color.copy(b.baseColor).multiplyScalar(1 - 0.2 * k);
        }
      }

      renderer.render(scene, camera);
    }
    frame();

    S.current.gfx = { scene, renderer, hemi, key, ground };
    S.current.applyAll && S.current.applyAll();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("dblclick", onDouble);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      for (const id of Object.keys(instances)) instances[id].dispose();
      renderer.dispose();
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);

  /* ---------------- params drive materials and environment ---------- */
  useEffect(() => {
    const applyAll = () => {
      const g = S.current.gfx;
      const inst = S.current.instances?.[activeId];
      if (!g || !inst) return;
      inst.applyParams(params);
      if (g.scene.background) g.scene.background.dispose();
      g.scene.background = makeBackdrop(params.bgColor);
      g.key.intensity = params.key;
      g.hemi.intensity = params.ambient;
      g.renderer.toneMappingExposure = params.exposure;
      g.ground.material.opacity = params.shadow;
    };
    S.current.applyAll = applyAll;
    applyAll();
  }, [activeId, params]);

  /* ---------------- readout ---------------- */
  useEffect(() => {
    const inst = S.current.instances?.[activeId];
    if (inst) inst.setTime(seconds, params);
  }, [activeId, seconds, params]);

  /* ---------------- transport button faces ---------------- */
  useEffect(() => {
    const inst = S.current.instances?.[activeId];
    if (inst) inst.paintButtons(params, running);
  }, [activeId, params, running]);

  /* ---------------- lofi bed ---------------- */
  const ensureLofi = () => {
    if (!lofiRef.current) lofiRef.current = createLofiBed(volumeRef.current);
    return lofiRef.current;
  };
  useEffect(() => {
    lofiRef.current?.setVolume(volume);
    saveVolume(volume);
  }, [volume]);

  const toggleMute = useCallback(() => {
    setVolume((v) => {
      if (v > 0) {
        preMuteRef.current = v;
        return 0;
      }
      return preMuteRef.current || DEFAULT_VOLUME;
    });
  }, []);

  /* the two popovers share the same corner, so only one opens at a time */
  const toggleVolPanel = useCallback(() => {
    setVolOpen((v) => !v);
    setPanel(false);
  }, []);

  /* create it on mount so the station list is fetched long before the
     first play, keeping that play() call inside the user gesture */
  useEffect(() => {
    const bed = ensureLofi();
    return () => {
      bed.dispose();
      lofiRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!running) lofiRef.current?.stop();
  }, [running]);

  /* ---------------- countdown ---------------- */
  useEffect(() => {
    if (!running) return;
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      /* counts from a stored timestamp, never an accumulating interval,
         so a throttled background tab cannot desync it */
      const left = (endRef.current - Date.now()) / 1000;
      if (left <= 0) {
        /* endRef, not Date.now(): rAF fires a few ms late and a 25:00
           pomodoro logged as 25:00.017 reads as sloppy in a duration column.
           complete() is idempotent, which matters because StrictMode
           double-invokes this effect and an already-expired timer would
           otherwise run this branch twice. */
        log.complete(endRef.current);
        setSeconds(0);
        setRunning(false);
        playChime();
        return;
      }
      setSeconds(left);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [running]);

  /* ---------------- control gestures ---------------- */
  S.current.onControlStart = useCallback((ctrl) => {
    /* re-dialling ends the run. a no-op when nothing is in flight, which it
       usually is: this fires on every control pointer-down, idle or not. */
    log.abandon();
    setRunning(false);
    const s = Math.round(secondsRef.current);
    rawRef.current = s;
    /* keep the part of the value this knob does not own, so turning
       minutes at 25:30 does not throw the 30 away */
    remRef.current = s % ctrl.step;
    lastQRef.current = s;
    unlockSfx();
  }, []);

  S.current.onControlMove = useCallback(
    (ctrl, turns) => {
      const max = mod.maxSeconds;
      /* most controls are linear in their own units. the hourglass is
         not — a millimetre of sand at the throat is worth far less time
         than one at the rim — so it converts the gesture itself and the
         plate can still track the finger one to one. */
      const gain = ctrl.gain
        ? ctrl.gain(rawRef.current, turns)
        : turns * ctrl.unitsPerTurn * ctrl.secondsPerUnit;
      rawRef.current = clamp(rawRef.current + gain, 0, max);
      const step = ctrl.step;
      const rem = remRef.current;
      const q = clamp(
        Math.round((rawRef.current - rem) / step) * step + rem,
        0,
        max
      );
      if (q !== lastQRef.current) {
        playDialTicks(Math.abs(q - lastQRef.current) / step);
        lastQRef.current = q;
      }
      setSeconds(q);
      setSetPoint(q);
    },
    [mod]
  );

  S.current.onButton = useCallback(
    (kind) => {
      /* the hourglass flips on reset, and that has to be driven by a
         real press: inferring it from `seconds` jumping up is wrong,
         because dragging its plate up does exactly the same thing. */
      S.current.instances?.[S.current.activeId]?.onButton?.(kind, {
        seconds,
        setPoint,
        running,
      });
      if (kind === "reset") {
        log.abandon();
        setRunning(false);
        setSeconds(setPoint);
        return;
      }
      if (running) {
        /* pause keeps the record open, so resuming appends a segment to it
           rather than starting a second one */
        log.pause();
        return setRunning(false);
      }
      if (seconds <= 0) return;
      log.startOrResume({
        timerId: S.current.activeId,
        remainingMs: seconds * 1000,
      });
      endRef.current = Date.now() + seconds * 1000;
      ensureLofi().start();
      setRunning(true);
    },
    [running, seconds, setPoint]
  );

  /* ---------------- switching ---------------- */
  const switchTo = useCallback(
    (id) => {
      if (id === activeId) return;
      unlockSfx();
      playWoosh(0.35);
      const max = byId(id).maxSeconds;
      setActiveId(id);
      /* the time carries across, clamped into the new timer's range */
      setSeconds((s) => {
        const n = Math.min(s, max);
        if (running && n !== s) endRef.current = Date.now() + n * 1000;
        return n;
      });
      setSetPoint((s) => Math.min(s, max));
    },
    [activeId, running]
  );

  /* ---------------- design panel ---------------- */
  const set = (k, v) =>
    setParamsByTimer((p) => ({ ...p, [activeId]: { ...p[activeId], [k]: v } }));
  const applyPreset = (n) =>
    setParamsByTimer((p) => ({
      ...p,
      [activeId]: { ...mod.defaults, ...mod.presets[n] },
    }));
  const resetParams = () =>
    setParamsByTimer((p) => ({ ...p, [activeId]: { ...mod.defaults } }));
  const copyParams = () => {
    try {
      navigator.clipboard.writeText(JSON.stringify(params, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {}
  };

  const fields = tab === "form" ? mod.fields.form : mod.fields.light;

  /* the pill icon reads the level back, so the cluster shows mute at a glance */
  const VolIcon =
    volume === 0 ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon;

  return (
    <div
      className="w-full h-screen flex flex-col relative overflow-hidden select-none"
      style={{ background: params.bgColor, color: "#1b241c" }}
    >
      {/* DM Sans, .dm and .tab now live in index.css, where the font can also
          feed --font-sans so the shadcn chrome inherits it. What is left here
          is the design panel's own control styling. */}
      <style>{`
        input[type=range]{ -webkit-appearance:none; appearance:none; background:transparent; height:18px; width:100%; }
        input[type=range]::-webkit-slider-runnable-track{ height:2px; background:rgba(27,36,28,.22); border-radius:2px; }
        input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:13px; height:13px; margin-top:-5.5px; border-radius:50%; background:#1b241c; }
        input[type=range]::-moz-range-track{ height:2px; background:rgba(27,36,28,.22); border-radius:2px; }
        input[type=range]::-moz-range-thumb{ width:13px; height:13px; border:0; border-radius:50%; background:#1b241c; }
        input[type=color]{ -webkit-appearance:none; appearance:none; border:0; background:transparent; padding:0; }
        input[type=color]::-webkit-color-swatch-wrapper{ padding:0; }
        input[type=color]::-webkit-color-swatch{ border:1px solid rgba(27,36,28,.18); border-radius:7px; }
      `}</style>

      <div ref={mountRef} className="flex-1 min-h-0 w-full overflow-hidden" />

      <ThumbRail
        timers={TIMERS}
        activeId={activeId}
        paramsByTimer={paramsByTimer}
        onSelect={switchTo}
      />

      {/* a flex cluster rather than two absolutely placed pills, so adding
          one does not mean hand-computing the other's offset */}
      <div className="dm absolute top-4 right-4 z-20 flex items-center gap-2">
        <div className="relative">
          <button
            onClick={toggleVolPanel}
            aria-label="Lofi volume"
            aria-expanded={volOpen}
            className="flex h-9 items-center rounded-full bg-white/70 px-3 text-xs font-medium backdrop-blur transition-colors hover:bg-white"
          >
            <VolIcon className="size-4 shrink-0" />
          </button>

          {volOpen && (
            /* anchored under its own button rather than to the cluster's
               right edge, so it still points at the control on any width */
            <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl bg-white/80 p-3.5 shadow-lg shadow-black/5 backdrop-blur-md">
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="opacity-50">Lofi volume</span>
                <span className="tab opacity-40">
                  {Math.round(volume * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  aria-label={volume === 0 ? "Unmute" : "Mute"}
                  className="shrink-0 rounded-lg bg-black/5 p-1.5 transition-colors hover:bg-black/10"
                >
                  <VolIcon className="size-3.5" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  aria-label="Lofi volume"
                />
              </div>

              {/* the bed only plays during a session, so without this a drag
                  in silence reads as a broken slider */}
              {!running && (
                <p className="mt-2.5 text-[10px] leading-4 opacity-40">
                  Plays while the timer is running.
                </p>
              )}
            </div>
          )}
        </div>

        <button
          onClick={openLog}
          aria-label="Focus log"
          className="flex items-center h-9 px-3 rounded-full bg-white/70 backdrop-blur text-xs font-medium hover:bg-white transition-colors"
        >
          <CalendarDaysIcon className="size-4 shrink-0" />
          {todayTotal > 0 && (
            <span className="tab ml-1.5 hidden sm:inline">
              {fmtDuration(todayTotal)}
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setPanel((v) => !v);
            setVolOpen(false);
          }}
          className="h-9 px-3.5 rounded-full bg-white/70 backdrop-blur text-xs font-medium hover:bg-white transition-colors"
        >
          {panel ? "Close" : "Design"}
        </button>
      </div>

      {/* Every prop here must stay referentially stable. TimerScene re-renders
          ~60x/sec while a timer runs, and React.memo on the drawer is the only
          thing keeping the calendar off that path — pass a derived array or an
          inline arrow and the memo is defeated on every frame. */}
      <SessionDrawer open={logOpen} onOpenChange={setLogOpen} />

      {panel && (
        <div className="dm absolute top-16 right-4 z-20 w-64 max-h-[76vh] overflow-y-auto rounded-2xl bg-white/80 backdrop-blur-md p-4 shadow-lg shadow-black/5">
          <div className="text-[11px] font-medium opacity-50 mb-2">
            {mod.name}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {Object.keys(mod.presets).map((n) => (
              <button
                key={n}
                onClick={() => applyPreset(n)}
                className="px-2.5 py-1 rounded-full text-[11px] bg-black/5 hover:bg-black/10 transition-colors"
              >
                {n}
              </button>
            ))}
          </div>

          <div className="flex gap-1 mb-3">
            {[
              ["form", "Form"],
              ["light", "Material"],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                style={{
                  background:
                    tab === k ? "rgba(27,36,28,.9)" : "rgba(0,0,0,.05)",
                  color: tab === k ? "#fff" : "inherit",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {fields.map(([k, label, min, max, step]) => (
              <label key={k} className="block">
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="opacity-60">{label}</span>
                  <span className="tab opacity-40">
                    {Number(params[k]).toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={params[k]}
                  onChange={(e) => set(k, parseFloat(e.target.value))}
                />
              </label>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-black/10 grid grid-cols-2 gap-2.5">
            {mod.fields.color.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="color"
                  value={params[k]}
                  onChange={(e) => set(k, e.target.value)}
                  className="w-7 h-7 rounded-lg cursor-pointer"
                />
                <span className="text-[11px] opacity-60">{label}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={copyParams}
              className="flex-1 py-1.5 rounded-lg bg-black/5 hover:bg-black/10 text-[11px] font-medium transition-colors"
            >
              {copied ? "Copied" : "Copy values"}
            </button>
            <button
              onClick={resetParams}
              className="px-3 py-1.5 rounded-lg bg-black/5 hover:bg-black/10 text-[11px] font-medium transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
