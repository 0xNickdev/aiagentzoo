// The hero scene: one particle system that tells the product in three beats, on a loop.
//   1. dust - every launch on Solana, read as it happens: moss-green dust drifting, parting around the cursor
//   2. eyes - the dust pulls together into the two watcher eyes of the logo; a scan line passes, a few flash red
//   3. net  - the eyes dissolve into the real network of the loudest dev right now: their coins (dumped in red),
//             the wallets that keep buying them, money running along the links
// The network beat is read live from the north node. Loaded lazily, so three.js never weighs on the first paint.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let N = 32000;
const short = (a: string) => a.slice(0, 4) + "…" + a.slice(-4);

export function webglOk(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/* ---------- targets ---------- */

// Dust: a wide, deep, uneven cloud.
function dustTargets() {
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = Math.pow(Math.random(), 0.6);
    const a = Math.random() * Math.PI * 2;
    p[i * 3] = Math.cos(a) * r * 400 + (Math.random() - 0.5) * 60;
    p[i * 3 + 1] = (Math.random() - 0.5) * 460;
    p[i * 3 + 2] = (Math.random() - 0.5) * 420;
  }
  return p;
}

// The eyes of the logo: two rings (outer 1, inner .65) with a dot (.277), centres 2.14 apart, sampled by area.
function eyesTargets() {
  const p = new Float32Array(N * 3);
  const S = 62;
  const ringArea = Math.PI * (1 - 0.65 * 0.65);
  const dotArea = Math.PI * 0.277 * 0.277;
  const pRing = ringArea / (ringArea + dotArea);
  for (let i = 0; i < N; i++) {
    const side = i % 2 ? 1 : -1;
    let r, a = Math.random() * Math.PI * 2;
    if (Math.random() < pRing) r = Math.sqrt(0.65 * 0.65 + Math.random() * (1 - 0.65 * 0.65));
    else r = 0.277 * Math.sqrt(Math.random());
    // a little fuzz at the edges keeps it made of dust, not a vector shape
    r += (Math.random() - 0.5) * 0.018;
    p[i * 3] = (side * 1.07 + Math.cos(a) * r) * S;
    p[i * 3 + 1] = Math.sin(a) * r * S;
    p[i * 3 + 2] = (Math.random() - 0.5) * 6;
  }
  return p;
}

/** What a node in the network beat is, for its label and the card that opens on click. */
export type NetInfo =
  | { kind: "dev"; wallet: string; launches48h: number; dumped: number; medianDumpMin: number | null; graduated: number }
  | { kind: "coin"; mint: string; symbol: string; venue?: string; buyers?: number; dumpedAfterSec?: number | null; dumpedAfterMin?: number | null; devTookSol?: number | null; leftHolding?: number | null; peakCapUsd?: number | null; alive?: boolean }
  | { kind: "wallet"; wallet: string; launches: number; snipes48h?: number };

// The network: nodes become dense clumps, links become streams of particles.
// The ruggers list is read once a few minutes; each network beat takes the next dev on it.
let ruggerList: { at: number; list: Array<{ wallet: string; launches48h: number; dumped: number; medianDumpMin?: number; graduated?: number; recent?: unknown[] }> } | null = null;
async function netTargets(NORTH: string, caption: (dev: string, launches: number, dumped: number, regs: number, rank: number) => string, which = 0, shape = 0) {
  if (!ruggerList || Date.now() - ruggerList.at > 5 * 60_000) {
    const { ruggers } = await fetch(`${NORTH}/v1/chain/ruggers?limit=6`).then((r) => r.json());
    ruggerList = { at: Date.now(), list: ruggers };
  }
  const dev = ruggerList.list[which % ruggerList.list.length]!;
  const w = await fetch(`${NORTH}/v1/wallet/${dev.wallet}`).then((r) => r.json());
  const coins: Launch[] = (w.dev?.launches ?? dev.recent ?? []).slice(0, 34);
  const regs: Array<{ wallet: string; launches: number; snipes48h?: number }> = (w.dev?.regulars ?? []).slice(0, 12);

  // layout: dev in the centre, coins on a loose ring, regulars outside, a short relaxation
  type Node = { kind: "dev" | "coin" | "wallet"; x: number; y: number; z: number; r: number; dumped?: boolean; info: NetInfo };
  type Launch = { mint: string; symbol?: string; venue?: string; buyers?: number; dumpedAfterSec?: number | null; dumpedAfterMin?: number | null; devTookSol?: number | null; leftHolding?: number | null; peakCapUsd?: number | null; alive?: boolean };
  const nodes: Node[] = [{ kind: "dev", x: 0, y: 0, z: 0, r: 13, info: { kind: "dev", wallet: dev.wallet, launches48h: dev.launches48h, dumped: dev.dumped, medianDumpMin: dev.medianDumpMin ?? null, graduated: dev.graduated ?? 0 } }];
  const L = 0.82; // the layout's scale, so the network stays clear of the headline
  // three shapes, one per beat: a ring; a golden-angle spiral; split, the dumped coins left and the living right
  const dumpedOf = (c: Launch) => c.dumpedAfterSec != null || c.dumpedAfterMin != null;
  const nDumped = coins.filter(dumpedOf).length;
  let dIdx = 0, lIdx = 0;
  const place = (c: Launch, i: number): [number, number] => {
    if (shape === 1) {
      const a = i * 2.39996 + 0.4;
      const d = 70 + 26 * Math.sqrt(i + 1);
      return [a, d];
    }
    if (shape === 2) {
      const dumped = dumpedOf(c);
      const k = dumped ? dIdx++ : lIdx++;
      const n = Math.max(1, dumped ? nDumped : coins.length - nDumped);
      const a = (dumped ? Math.PI * 0.62 : -Math.PI * 0.38) + (n === 1 ? Math.PI * 0.38 : (k / (n - 1)) * Math.PI * 0.76);
      return [a, 135 + ((k * 37) % 5) * 14];
    }
    return [(i / coins.length) * Math.PI * 2 + Math.random() * 0.12, 120 + Math.random() * 70];
  };
  coins.forEach((c: Launch, i: number) => {
    const [a, d] = place(c, i);
    nodes.push({ kind: "coin", dumped: c.dumpedAfterSec != null || c.dumpedAfterMin != null, x: Math.cos(a) * d * 1.35 * L, y: Math.sin(a) * d * L, z: (Math.random() - 0.5) * 90, r: 4.2 + Math.min(4, (c.buyers ?? 0) / 25), info: { kind: "coin", mint: c.mint, symbol: c.symbol ?? "", venue: c.venue, buyers: c.buyers, dumpedAfterSec: c.dumpedAfterSec, dumpedAfterMin: c.dumpedAfterMin, devTookSol: c.devTookSol, leftHolding: c.leftHolding, peakCapUsd: c.peakCapUsd, alive: c.alive } });
  });
  regs.forEach((g, i: number) => {
    // in the split shape the buyers sit in two arcs above and below, between the dead and the living
    const a = shape === 2 ? (i % 2 ? Math.PI * 1.5 : Math.PI * 0.5) + ((Math.floor(i / 2) / Math.max(1, Math.ceil(regs.length / 2) - 1)) - 0.5) * 0.9 : (i / regs.length) * Math.PI * 2 + 0.3;
    const d = shape === 1 ? 300 + Math.random() * 30 : 255 + Math.random() * 40;
    nodes.push({ kind: "wallet", x: Math.cos(a) * d * 1.3 * L, y: Math.sin(a) * d * 0.95 * L, z: (Math.random() - 0.5) * 120, r: 3.2, info: { kind: "wallet", wallet: g.wallet, launches: g.launches, snipes48h: g.snipes48h } });
  });
  const links: Array<{ a: number; b: number; kind: "launch" | "buy" }> = [];
  const coinIdx = nodes.map((n, i) => (n.kind === "coin" ? i : -1)).filter((i) => i >= 0);
  coinIdx.forEach((i) => links.push({ a: 0, b: i, kind: "launch" }));
  // every regular bought most of this dev's launches: link it to the coins nearest to it on the ring
  nodes.forEach((n, i) => {
    if (n.kind !== "wallet") return;
    const near = coinIdx.slice().sort((p, q) => Math.hypot(nodes[p].x - n.x, nodes[p].y - n.y) - Math.hypot(nodes[q].x - n.x, nodes[q].y - n.y)).slice(0, 4);
    near.forEach((j) => links.push({ a: i, b: j, kind: "buy" }));
  });

  // share of particles: node clumps by size, the rest flows along links
  const nodeWeight = nodes.map((n) => (n.kind === "dev" ? 9 : n.r * n.r * 0.06));
  const totalNode = nodeWeight.reduce((s, v) => s + v, 0);
  const nodeShare = 0.46;
  const pos = new Float32Array(N * 3);
  const edgeA = new Float32Array(N * 3);
  const edgeB = new Float32Array(N * 3);
  const isEdge = new Float32Array(N);
  const nodeOf = new Float32Array(N).fill(-1);
  const col = new Float32Array(N * 3);
  const C = {
    dev: [1.35, 0.42, 0.36],
    dumped: [0.95, 0.52, 0.46],
    coin: [0.92, 0.95, 0.93],
    wallet: [1.0, 0.72, 0.42],
    launch: [0.62, 0.8, 0.7],
    buy: [0.85, 0.62, 0.36],
  };
  let i = 0;
  const nodeParticles = Math.floor(N * nodeShare);
  nodes.forEach((n, k) => {
    const cnt = Math.round((nodeWeight[k] / totalNode) * nodeParticles);
    for (let c = 0; c < cnt && i < N; c++, i++) {
      // a gaussian-ish clump, tighter for small nodes
      const u = Math.random(), v = Math.random();
      const rr = n.r * Math.sqrt(-2 * Math.log(u + 1e-6)) * 0.42;
      const th = v * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = n.x + rr * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = n.y + rr * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = n.z + rr * Math.cos(ph);
      const cc = n.kind === "dev" ? C.dev : n.kind === "wallet" ? C.wallet : n.dumped ? C.dumped : C.coin;
      col.set(cc, i * 3);
      nodeOf[i] = k;
    }
  });
  // the rest: links. a particle sits somewhere on its link and the shader moves it along.
  let li = 0;
  while (i < N && links.length) {
    const l = links[li++ % links.length];
    const A = nodes[l.a], B = nodes[l.b];
    edgeA.set([A.x, A.y, A.z], i * 3);
    edgeB.set([B.x, B.y, B.z], i * 3);
    isEdge[i] = l.kind === "launch" ? 1 : 2;
    pos.set([A.x, A.y, A.z], i * 3);
    col.set(l.kind === "launch" ? C.launch : C.buy, i * 3);
    i++;
  }
  // labels: the dev, and the coins most people bought
  const labelled = new Set(nodes.filter((n) => n.kind === "coin").sort((a, b) => ((b.info as { buyers?: number }).buyers ?? 0) - ((a.info as { buyers?: number }).buyers ?? 0)).slice(0, 7));
  const meta = nodes.map((n) => ({
    x: n.x, y: n.y, z: n.z, r: n.r, info: n.info,
    label: n.kind === "dev" ? "dev" : labelled.has(n) ? "coin" : null,
  }));
  return {
    pos, edgeA, edgeB, isEdge, col, meta, nodeOf,
    caption: caption(short(dev.wallet), dev.launches48h, dev.dumped, regs.length, (which % ruggerList.list.length) + 1),
  };
}

/* ---------- shaders ---------- */

const vert = /* glsl */ `
  uniform float uTime, uT, uPixel, uScan, uFlash;
  uniform int uFrom, uTo;
  uniform vec3 uMouse;
  uniform float uHover;
  attribute vec3 aDust, aEyes, aNet, aEdgeA, aEdgeB, aColNet;
  attribute float aSeed, aIsEdge, aNode;
  varying vec3 vCol;
  varying float vAlpha;

  vec3 hash3(float n) { return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453, 22578.1459, 19642.3490)); }
  vec3 drift(vec3 p, float amp) {
    float t = uTime * 0.18;
    return amp * vec3(sin(p.y * 0.012 + t + aSeed * 6.0), cos(p.x * 0.011 + t * 0.9 + aSeed * 5.0), sin(p.x * 0.009 + p.y * 0.01 + t * 0.7));
  }
  vec3 netPos() {
    if (aIsEdge > 0.5) {
      float k = fract(aSeed * 13.7 + uTime * (aIsEdge > 1.5 ? 0.05 : 0.09));
      vec3 j = (hash3(aSeed * 91.0) - 0.5) * 2.2;
      return mix(aEdgeA, aEdgeB, k) + j;
    }
    return aNet;
  }
  vec3 posOf(int s) { return s == 0 ? aDust : s == 1 ? aEyes : netPos(); }
  vec3 colOf(int s, vec3 p) {
    if (s == 0) return mix(vec3(0.45, 0.68, 0.56), vec3(0.9, 1.0, 0.95), step(0.92, aSeed)) * 0.62;
    if (s == 1) {
      vec3 c = vec3(0.95, 0.98, 0.96);
      // the scan line brightens what it passes; a few particles flash red, as if a dump was caught
      c += vec3(0.6, 0.9, 0.7) * smoothstep(5.0, 0.0, abs(p.y - uScan)) * 1.4;
      float m2 = length(p.xy - uMouse.xy);
      c += vec3(0.5, 0.75, 0.6) * exp(-(m2 * m2) / 1800.0) * 0.9;
      float red = step(0.955, aSeed) * uFlash;
      return mix(c, vec3(1.6, 0.45, 0.38), red);
    }
    return aColNet;
  }
  float ampOf(int s) { return s == 0 ? 9.0 : s == 1 ? 0.6 : 1.4; }
  float sizeOf(int s) { return s == 0 ? 1.7 + aSeed * 1.7 : s == 1 ? 1.25 + aSeed * 0.6 : (aIsEdge > 0.5 ? 1.0 : 1.5 + aSeed * 0.8); }

  void main() {
    float d = clamp((uT - aSeed * 0.32) / 0.68, 0.0, 1.0);
    float e = d < 0.5 ? 4.0 * d * d * d : 1.0 - pow(-2.0 * d + 2.0, 3.0) / 2.0;
    vec3 a = posOf(uFrom), b = posOf(uTo);
    vec3 p = mix(a, b, e);
    // mid-flight the dust swirls, so a change of shape reads as one material moving
    float fl = sin(e * 3.14159);
    p += vec3(sin(aSeed * 50.0 + uTime * 0.6), cos(aSeed * 37.0 + uTime * 0.5), sin(aSeed * 23.0)) * fl * 46.0;
    p += drift(p, mix(ampOf(uFrom), ampOf(uTo), e));
    // the cursor pushes particles aside, as if something is looking through them
    vec2 m = p.xy - uMouse.xy;
    float md = length(m);
    // only the dust gives way to the cursor, softly, with no hard edge; the logo and the network keep their shape
    float push = (uFrom == 0 ? 1.0 - e : 0.0) + (uTo == 0 ? e : 0.0);
    p.xy += normalize(m + 1e-4) * 34.0 * exp(-(md * md) / 3200.0) * push;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = mix(sizeOf(uFrom), sizeOf(uTo), e) * uPixel * (420.0 / -mv.z);
    vCol = mix(colOf(uFrom, p), colOf(uTo, p), e);
    float lit = (uFrom == 2 && uTo == 2 && abs(aNode - uHover) < 0.5) ? 1.0 : 0.0;
    vCol = mix(vCol, vec3(1.7, 1.75, 1.7), lit * 0.55);
    gl_PointSize *= 1.0 + lit * 0.35;
    vAlpha = mix(0.55, 1.0, step(0.5, aSeed)) * clamp(1.4 - (-mv.z - 280.0) / 520.0, 0.25, 1.0);
  }
`;

const frag = /* glsl */ `
  varying vec3 vCol;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vCol * a, a * vAlpha);
  }
`;

/* ---------- scene ---------- */

export interface SceneOptions {
  north: string;
  captions: [string, string];
  netCaption: (dev: string, launches: number, dumped: number, regs: number, rank: number) => string;
  onCaption: (text: string) => void;
  onReady: () => void;
  /** The label on the dev's node, e.g. "DEV 8WZw…9iLV". */
  devLabel: (short: string) => string;
  /** A card the page renders; the scene keeps it pinned to the node it is about. */
  popover: HTMLElement;
  /** "Drag to move · pinch to zoom", shown while the network is on screen. */
  exploreHint: string;
  /** A node was clicked (or the card dismissed, with null). */
  onPick: (info: NetInfo | null) => void;
}

/** Starts the scene inside `host`; returns a function that stops it and frees the GPU. */
export function startScene(host: HTMLElement, o: SceneOptions): () => void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = matchMedia("(max-width: 900px)").matches;
  N = small ? 14000 : 32000;
  let alive = true;
  const W = () => host.clientWidth, H = () => host.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W() / H(), 1, 3000);
  camera.position.set(0, 0, 640);

  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) seed[i] = Math.random();
  const dust = dustTargets(), eyes = eyesTargets();
  geo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
  geo.setAttribute("aDust", new THREE.BufferAttribute(dust, 3));
  geo.setAttribute("aEyes", new THREE.BufferAttribute(eyes, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  // until the network arrives it is the eyes, so the loop never breaks
  geo.setAttribute("aNet", new THREE.BufferAttribute(eyes.slice(), 3));
  geo.setAttribute("aEdgeA", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute("aEdgeB", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute("aIsEdge", new THREE.BufferAttribute(new Float32Array(N), 1));
  geo.setAttribute("aColNet", new THREE.BufferAttribute(new Float32Array(N * 3).fill(0.9), 3));
  geo.setAttribute("aNode", new THREE.BufferAttribute(new Float32Array(N).fill(-1), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2000);

  const uniforms = {
    uTime: { value: 0 }, uT: { value: 0 }, uPixel: { value: renderer.getPixelRatio() },
    uScan: { value: -999 }, uFlash: { value: 0 }, uFrom: { value: 0 }, uTo: { value: 0 },
    uMouse: { value: new THREE.Vector3(9999, 9999, 0) },
    uHover: { value: -1 },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  const group = new THREE.Group();
  group.add(pts);
  scene.add(group);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.85, 0.55, 0.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const home = { x: 0, y: 0 };
  // the art sits right of the headline on wide screens, centred and quieter on phones
  const place = () => {
    renderer.setSize(W(), H());
    composer.setSize(W(), H());
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    const halfW = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * camera.aspect;
    home.x = small ? 0 : halfW * 0.5;
    home.y = small ? 60 : 10;
    group.scale.setScalar(small ? 0.62 : 1);
  };
  addEventListener("resize", place);
  place();

  // pointer on the art plane
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    if (ray.ray.intersectPlane(plane, hit)) uniforms.uMouse.value.copy(group.worldToLocal(hit.clone()));
  };
  const onLeave = () => uniforms.uMouse.value.set(9999, 9999, 0);
  addEventListener("pointermove", onMove);
  addEventListener("pointerleave", onLeave);

  // labels over the network, positioned from the 3D nodes every frame
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .4s ease";
  host.appendChild(overlay);
  // a scanner's reticle: four thin corners closing in on the node
  const ring = document.createElement("div");
  ring.style.cssText = "position:absolute;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;opacity:0;transition:opacity .18s ease";
  for (const [v, h] of [["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]]) {
    const c = document.createElement("i");
    c.style.cssText = `position:absolute;${v}:0;${h}:0;width:9px;height:9px;border-${v}:1.5px solid rgba(255,255,255,.95);border-${h}:1.5px solid rgba(255,255,255,.95);filter:drop-shadow(0 0 4px rgba(255,255,255,.5))`;
    ring.appendChild(c);
  }
  overlay.appendChild(ring);
  let ringScale = 1.6;
  const hint = document.createElement("div");
  hint.textContent = o.exploreHint;
  hint.style.cssText = "position:absolute;right:32px;bottom:196px;font:500 12px Geist,system-ui,sans-serif;color:rgba(220,226,223,.7);padding:6px 10px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(6,9,8,.6);backdrop-filter:blur(8px)";
  if (!small) overlay.appendChild(hint);
  type Meta = { x: number; y: number; z: number; r: number; info: NetInfo; label: string | null; el?: HTMLElement; sx: number; sy: number; pr: number };
  let meta: Meta[] = [];
  let hovered: Meta | null = null;
  let picked: Meta | null = null;
  let pickedAt = 0;
  // ?pick=<n> opens node n's card once the network shows, for review
  let autoPick: string | null = new URLSearchParams(location.search).get("pick");
  const tmp = new THREE.Vector3();
  const interactive = (t: EventTarget | null) => t instanceof Element && !!t.closest("a,button,input,textarea,select,label,form,nav,[role=dialog],[data-no-art]");
  const netAlpha = () => (phase === "hold" ? (state === 2 ? 1 : 0) : next === 2 ? uniforms.uT.value : state === 2 ? 1 - uniforms.uT.value : 0);
  const findNode = (cx: number, cy: number) => {
    const r = host.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    let best: Meta | null = null, bd = Infinity;
    for (const m of meta) {
      const d = Math.hypot(m.sx - x, m.sy - y);
      if (d < Math.max(14, m.pr + 8) && d < bd) { best = m; bd = d; }
    }
    return best;
  };
  const onHoverMove = (e: PointerEvent) => {
    const can = netAlpha() > 0.7 && !interactive(e.target);
    const h = can ? findNode(e.clientX, e.clientY) : null;
    if (h !== hovered) {
      hovered = h;
      document.documentElement.style.cursor = h ? "pointer" : "";
    }
  };
  const onClick = (e: MouseEvent) => {
    if (suppressClick) return;
    if (interactive(e.target) || (e.target instanceof Element && o.popover.contains(e.target))) return;
    const h = netAlpha() > 0.7 ? findNode(e.clientX, e.clientY) : null;
    picked = h;
    pickedAt = performance.now() / 1000;
    o.onPick(h ? h.info : null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && picked) { picked = null; o.onPick(null); }
  };
  let zoom = 1, panX = 0, panY = 0, lastTouch = -99;
  let drag: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;
  // the left part of the hero is the headline and the form: exploring starts only right of it
  const inHost = (cx: number, cy: number) => {
    const r = host.getBoundingClientRect();
    return cx >= r.left + (small ? 0 : r.width * 0.42) && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };
  const worldPerPx = () => (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z) / H();
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || netAlpha() < 0.7 || interactive(e.target) || !inHost(e.clientX, e.clientY) || o.popover.contains(e.target as Node)) return;
    drag = { x: e.clientX, y: e.clientY, px: panX, py: panY, moved: false };
  };
  const onDrag = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      document.documentElement.style.cursor = "grabbing";
    }
    if (drag.moved) {
      const k = worldPerPx();
      panX = drag.px + dx * k;
      panY = drag.py - dy * k;
      lastTouch = performance.now() / 1000;
    }
  };
  const onUp = () => {
    if (drag?.moved) {
      document.documentElement.style.cursor = "";
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
    }
    drag = null;
  };
  let suppressClick = false;
  const onWheel = (e: WheelEvent) => {
    // only a pinch (ctrl) or cmd + scroll zooms; a plain scroll keeps scrolling the page
    if (!(e.ctrlKey || e.metaKey) || netAlpha() < 0.7 || !inHost(e.clientX, e.clientY)) return;
    e.preventDefault();
    const before = zoom;
    zoom = Math.min(3, Math.max(0.6, zoom * Math.exp(-e.deltaY * 0.01)));
    // zoom toward the cursor: keep the point under it where it is
    const r = host.getBoundingClientRect();
    const k = worldPerPx();
    const cx = (e.clientX - r.left - r.width / 2) * k, cy = -(e.clientY - r.top - r.height / 2) * k;
    // the world spans `before/zoom` as much after; shift so the point under the cursor stays put
    panX += cx * (before / zoom - 1);
    panY += cy * (before / zoom - 1);
    lastTouch = performance.now() / 1000;
  };
  addEventListener("pointerdown", onDown);
  addEventListener("pointermove", onDrag);
  addEventListener("pointerup", onUp);
  addEventListener("wheel", onWheel, { passive: false });
  addEventListener("pointermove", onHoverMove);
  addEventListener("click", onClick);
  addEventListener("keydown", onKey);

  const caps: Record<number, string> = { 0: o.captions[0], 1: o.captions[1], 2: "" };
  const say = (t: string) => o.onCaption(t);

  let haveNet = false;
  type Net = Awaited<ReturnType<typeof netTargets>>;
  let pending: Net | null = null;
  // ?net=<n> starts from the n-th dev and shape, for review
  let netIndex = Number(new URLSearchParams(location.search).get("net")) || 0;
  const applyNet = (n: Net) => {
      for (const m of meta) m.el?.remove();
      hovered = null;
      picked = null;
      geo.getAttribute("aNet").array.set(n.pos);
      geo.getAttribute("aNet").needsUpdate = true;
      geo.getAttribute("aEdgeA").array.set(n.edgeA);
      geo.getAttribute("aEdgeA").needsUpdate = true;
      geo.getAttribute("aEdgeB").array.set(n.edgeB);
      geo.getAttribute("aEdgeB").needsUpdate = true;
      geo.getAttribute("aIsEdge").array.set(n.isEdge);
      geo.getAttribute("aIsEdge").needsUpdate = true;
      geo.getAttribute("aColNet").array.set(n.col);
      geo.getAttribute("aColNet").needsUpdate = true;
      geo.getAttribute("aNode").array.set(n.nodeOf);
      geo.getAttribute("aNode").needsUpdate = true;
      caps[2] = n.caption;
      meta = n.meta.map((m) => ({ ...m, sx: -999, sy: -999, pr: 8 }));
      for (const m of meta) {
        if (!m.label) continue;
        const el = document.createElement("span");
        const isDev = m.info.kind === "dev";
        el.textContent = isDev ? o.devLabel(short((m.info as { wallet: string }).wallet)) : (() => {
          const sy = String((m.info as { symbol: string }).symbol || "").replace(/^\$+/, "").replace(/[\s\u3164\u115f\u1160\u200b-\u200d\ufeff]+/g, " ").trim();
          return sy ? "$" + sy.slice(0, 12) : "";
        })();
        if (!el.textContent) continue;
        el.style.cssText = isDev
          ? "position:absolute;left:0;top:0;white-space:nowrap;font:600 11px Geist,system-ui,sans-serif;letter-spacing:.08em;color:#ffb3aa;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,138,126,.5);background:rgba(20,8,7,.75);"
          : "position:absolute;left:0;top:0;white-space:nowrap;font:500 11.5px Geist,system-ui,sans-serif;color:rgba(235,240,237,.82);text-shadow:0 1px 6px #000;";
        overlay.appendChild(el);
        m.el = el;
      }
      haveNet = true;
  };
  // the next dev and shape are read while the dust and the eyes are on screen
  const prepare = () =>
    netTargets(o.north, o.netCaption, netIndex, netIndex % 3)
      .then((n) => {
        if (!alive) return;
        netIndex += 1;
        if (!haveNet) applyNet(n);
        else pending = n;
      })
      .catch(() => {});
  void prepare();

  // the loop: hold, morph, hold, morph... dust -> eyes -> net -> dust
  const HOLD: Record<number, number> = { 0: 3.2, 1: 4.6, 2: 7.5 };
  const pin = new URLSearchParams(location.search).get("beat");
  const MORPH = 3.0;
  let state = 0, next = 1, phase = "hold", t0 = performance.now() / 1000;
  if (pin === "1") { state = 1; uniforms.uFrom.value = uniforms.uTo.value = 1; }
  say(caps[state]);
  if (pin === "2") {
    const wait = setInterval(() => {
      if (!haveNet) return;
      clearInterval(wait);
      state = 2; uniforms.uFrom.value = uniforms.uTo.value = 2; say(caps[2]);
    }, 100);
  }
  const clock = new THREE.Clock();
  let rot = 0;
  function frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, clock.getDelta());
    uniforms.uTime.value += reduce ? 0 : dt;
    // someone is looking at a node: the network stays
    const exploring = now - lastTouch < 7 || !!drag;
    if ((hovered || picked || exploring) && phase === "hold" && state === 2) t0 += dt;
    if (!exploring && !picked) {
      zoom += (1 - zoom) * 0.03;
      panX += (0 - panX) * 0.03;
      panY += (0 - panY) * 0.03;
    }
    const el = now - t0;
    if (phase === "hold" && el > HOLD[state] && !reduce && pin == null) {
      next = state === 0 ? 1 : state === 1 ? (haveNet ? 2 : 0) : 0;
      // into the network: swap in the one read in the meantime; out of it: start reading the next
      if (next === 2 && pending) {
        applyNet(pending);
        pending = null;
      }
      if (state === 2) void prepare();
      phase = "morph";
      t0 = now;
      uniforms.uFrom.value = state;
      uniforms.uTo.value = next;
      say(caps[next]);
    } else if (phase === "morph") {
      uniforms.uT.value = Math.min(1, el / MORPH);
      if (el > MORPH) {
        state = next;
        phase = "hold";
        t0 = now;
        uniforms.uFrom.value = state;
        uniforms.uTo.value = state;
        uniforms.uT.value = 0;
      }
    }
    // eyes: one scan sweep top to bottom, then the red flash
    const inEyes = (phase === "hold" && state === 1);
    const k = inEyes ? (pin === "1" ? (el % HOLD[1]) : el) / HOLD[1] : 0;
    uniforms.uScan.value = inEyes ? 80 - k * 200 : -999;
    uniforms.uFlash.value = inEyes ? Math.max(0, Math.sin(Math.min(1, Math.max(0, (k - 0.45) / 0.4)) * Math.PI)) : 0;
    // a slow turn of the whole piece, more in the network, so its depth shows
    const turn = state === 2 && phase === "hold" ? 0.12 : 0.05;
    rot += (turn - rot) * 0.02;
    group.rotation.y = Math.sin(uniforms.uTime.value * 0.11) * rot * 2.2;
    group.rotation.x = Math.cos(uniforms.uTime.value * 0.09) * 0.05;
    group.position.x = home.x + panX;
    group.position.y = home.y + panY;
    camera.position.z = 640 / zoom;
    group.updateMatrixWorld();
    const na = netAlpha();
    overlay.style.opacity = String(na);
    if (na > 0.01 && meta.length) {
      const w = W(), h = H();
      for (const m of meta) {
        tmp.set(m.x, m.y, m.z);
        group.localToWorld(tmp);
        const depth = camera.position.z - tmp.z;
        tmp.project(camera);
        m.sx = (tmp.x * 0.5 + 0.5) * w;
        m.sy = (-tmp.y * 0.5 + 0.5) * h;
        m.pr = (m.r * group.scale.x * h) / (2 * Math.tan((camera.fov * Math.PI) / 360) * depth);
        if (m.el) {
          const dx = m.info.kind === "dev" ? m.pr + 10 : m.pr + 6;
          m.el.style.transform = `translate(${(m.sx + dx).toFixed(1)}px, ${(m.sy - 9).toFixed(1)}px)`;
          m.el.style.opacity = hovered === m || picked === m ? "1" : m.info.kind === "dev" ? "0.95" : "0.7";
        }
      }
      const focus = picked ?? hovered;
      ring.style.opacity = focus ? "1" : "0";
      uniforms.uHover.value = focus ? meta.indexOf(focus) : -1;
      // the corners close in when a node is found, then sit just outside it
      const fit = focus ? Math.max(0.6, (focus.pr * 2 + 18) / 40) : 1.6;
      ringScale += ((focus ? fit : fit * 1.6) - ringScale) * 0.25;
      if (focus) ring.style.transform = `translate(${focus.sx.toFixed(1)}px, ${focus.sy.toFixed(1)}px) scale(${ringScale.toFixed(3)})`;
      else ringScale = 1.6 * fit;
    } else {
      ring.style.opacity = "0";
      uniforms.uHover.value = -1;
    }
    // the page closed the card (its × button): let go of the node too
    if (picked && o.popover.childElementCount === 0 && pickedAt < now - 0.3) picked = null;
    if (!picked && autoPick != null && meta.length && na > 0.95) {
      picked = meta[Number(autoPick)] ?? null;
      pickedAt = now;
      if (picked) o.onPick(picked.info);
      autoPick = null;
    }
    if (picked) {
      // the card opens beside the node, on the side with more room
      const left = picked.sx + 16 + 270 > W() - 16;
      o.popover.style.transform = `translate(${(picked.sx + (left ? -16 : 16)).toFixed(1)}px, ${(picked.sy - 20).toFixed(1)}px) translateX(${left ? "-100%" : "0"})`;
      if (na < 0.5) { picked = null; o.onPick(null); }
    }
    composer.render();
    if (alive) raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);
  o.onReady();
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    removeEventListener("resize", place);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerleave", onLeave);
    removeEventListener("pointermove", onHoverMove);
    removeEventListener("pointerdown", onDown);
    removeEventListener("pointermove", onDrag);
    removeEventListener("pointerup", onUp);
    removeEventListener("wheel", onWheel);
    removeEventListener("click", onClick);
    removeEventListener("keydown", onKey);
    document.documentElement.style.cursor = "";
    overlay.remove();
    geo.dispose();
    mat.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

