// The home's one particle system. It opens as the hero (dust that gathers into the two watcher eyes of the logo)
// and then, pinned while the page scrolls, tells one real token's story with the same grains:
//   1. the eyes turn to the token's address and the pupils tighten
//   2. a dive into one eye; the grains collapse into the dev's wallet and grow along a spiral, one per launch,
//      oldest to newest; the dumped ones fall and turn red
//   3. the spiral steps aside, the first buyers fly in, lines draw to the coin and back to who paid for them
//   4. everything pulls into a line that bends into the odds gauge; the needle stops at the real odds
// One scroll progress value drives it (see story.ts). Loaded lazily, so three.js never weighs on the first paint.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { beats, oddsFrac, phase, type Phase, type StoryData } from "./storyData";

let N = 30000;

export function webglOk(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

// a fixed hash, so the story's layout is the same on every visit
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ---------- the hero's targets ---------- */

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
const S = 62;
function eyesTargets() {
  const p = new Float32Array(N * 3);
  const part = new Float32Array(N);
  const centre = new Float32Array(N);
  const ringArea = Math.PI * (1 - 0.65 * 0.65);
  const dotArea = Math.PI * 0.277 * 0.277;
  const pRing = ringArea / (ringArea + dotArea);
  for (let i = 0; i < N; i++) {
    const side = i % 2 ? 1 : -1;
    let r;
    const a = Math.random() * Math.PI * 2;
    const ring = Math.random() < pRing;
    if (ring) r = Math.sqrt(0.65 * 0.65 + Math.random() * (1 - 0.65 * 0.65));
    else r = 0.277 * Math.sqrt(Math.random());
    r += (Math.random() - 0.5) * 0.018;
    p[i * 3] = (side * 1.07 + Math.cos(a) * r) * S;
    p[i * 3 + 1] = Math.sin(a) * r * S;
    p[i * 3 + 2] = (Math.random() - 0.5) * 6;
    part[i] = ring ? 0 : 1;
    centre[i] = side * 1.07 * S;
  }
  return { p, part, centre };
}

/* ---------- the story's targets ---------- */

/** Local layout of the story's chapters, in scene units around the art's centre. */
const L = {
  spiral: { r0: 24, r1: 178 },
  coin: [62, -6, 0] as const,
  mini: { k: 0.3, x: 168, y: 128 },
  gauge: { r: 178, cy: -58 },
};
const fallOf = (seed: number) => 22 + seed * 26;

function spiralAt(i: number, n: number): [number, number] {
  const a = i * 2.39996 + 0.6;
  const r = L.spiral.r0 + (L.spiral.r1 - L.spiral.r0) * Math.sqrt((i + 1) / n);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

function buildStory(d: StoryData, seed: Float32Array, small: boolean) {
  const T = d.timeline.length;
  const s2 = new Float32Array(N * 3), s2o = new Float32Array(N), s2k = new Float32Array(N);
  const s3a = new Float32Array(N * 3), s3b = new Float32Array(N * 3), s3u = new Float32Array(N), s3k = new Float32Array(N);
  const s4u = new Float32Array(N);
  const grainR = small ? 3.2 : 2.4;
  const kindOf = (m: string) => (m === "d" ? 0 : m === "u" ? 2 : 1);

  // the buyers on an arc left of the coin, their shared funders further left
  const E = d.early.length;
  const [cx, cy] = L.coin;
  const buyers = d.early.map((_, j) => {
    const a = Math.PI + (E === 1 ? 0 : (j / (E - 1) - 0.5) * (E > 4 ? 1.75 : 1.2));
    return [cx + Math.cos(a) * 152, cy + Math.sin(a) * 140, (hash(j + 7) - 0.5) * 30] as [number, number, number];
  });
  const funders = d.shared.map((g, k) => {
    const ys = g.wallets.map((w) => buyers[d.early.findIndex((e) => e.wallet === w)]![1]);
    return [-178, ys.reduce((s, v) => s + v, 0) / ys.length + k * 6, 0] as [number, number, number];
  });
  const funderLines: Array<[number, number]> = [];
  d.shared.forEach((g, k) => g.wallets.forEach((w) => funderLines.push([d.early.findIndex((e) => e.wallet === w), k])));
  const hasF = funderLines.length > 0;

  for (let i = 0; i < N; i++) {
    const h = hash(i * 1.37 + 3);
    const sd = seed[i]!;
    // chapter 2: one in eight is the dev's node, the rest are the launches, oldest first
    let gx = 0, gy = 0, kind = 3, ord = -1;
    if (h < 0.06) {
      const u = Math.random(), v = Math.random();
      const rr = 11 * Math.sqrt(-2 * Math.log(u + 1e-6)) * 0.42;
      const th = v * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      s2.set([rr * Math.sin(ph) * Math.cos(th), rr * Math.sin(ph) * Math.sin(th), rr * Math.cos(ph)], i * 3);
    } else {
      const g = i % T;
      [gx, gy] = spiralAt(g, T);
      const rr = grainR * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      gx += Math.cos(a) * rr;
      gy += Math.sin(a) * rr;
      kind = kindOf(d.timeline[g]!);
      ord = g / T;
      s2.set([gx, gy, (Math.random() - 0.5) * 4], i * 3);
    }
    s2o[i] = ord;
    s2k[i] = kind;

    // chapter 3: the spiral, small, aside; the coin; the buyers; the lines
    const r3 = hash(i * 2.11 + 9);
    const j = i % E;
    const jit = () => (Math.random() - 0.5) * 2;
    if (r3 < 0.42) {
      // the spiral keeps its colours where it stepped aside, the fallen ones still fallen
      let mx = gx, my = gy;
      if (kind === 3) [mx, my] = spiralAt(Math.floor(Math.random() * T), T);
      if (kind === 0) my -= fallOf(sd);
      s3a.set([L.mini.x + mx * L.mini.k, L.mini.y + my * L.mini.k, 0], i * 3);
      s3k[i] = 0;
    } else if (r3 < 0.5) {
      const rr = 9 * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      s3a.set([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, jit() * 4], i * 3);
      s3k[i] = 1;
    } else if (r3 < 0.6) {
      const b = buyers[j]!;
      const rr = 5.5 * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      s3a.set([b[0] + Math.cos(a) * rr, b[1] + Math.sin(a) * rr, b[2] + jit() * 3], i * 3);
      s3k[i] = 2;
    } else if (!hasF || r3 < 0.86) {
      const b = buyers[j]!;
      s3a.set([b[0], b[1], b[2]], i * 3);
      s3b.set([cx, cy, 0], i * 3);
      s3u[i] = Math.random();
      s3k[i] = 3;
    } else {
      const [bj, fk] = funderLines[i % funderLines.length]!;
      const b = buyers[bj]!, f = funders[fk]!;
      if (r3 < 0.91) {
        const rr = 6 * Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        s3a.set([f[0] + Math.cos(a) * rr, f[1] + Math.sin(a) * rr, jit() * 3], i * 3);
        s3b.set(b, i * 3);
        s3k[i] = 4;
      } else {
        s3a.set(b, i * 3);
        s3b.set(f, i * 3);
        s3u[i] = Math.random();
        s3k[i] = 5;
      }
    }
    // chapter 4: a place along the gauge
    s4u[i] = hash(i * 0.731 + 17);
  }
  return { s2, s2o, s2k, s3a, s3b, s3u, s3k, s4u, buyers, funders, T };
}

/* ---------- shaders ---------- */

const vert = /* glsl */ `
  uniform float uTime, uPixel, uIntro, uScan, uFlash, uDust, uFade;
  uniform float uS, uLook, uPupil, uEyeK, uGrow, uFall, uDraw, uDraw2, uBend, uNeedle, uOdds, uWarn;
  uniform vec2 uLookDir;
  uniform vec3 uMouse, uVerdict;
  attribute vec3 aDust, aEyes, aS2, aS3a, aS3b;
  attribute float aSeed, aPart, aEyeC, aS2o, aS2k, aS3u, aS3k, aS4u;
  varying vec3 vCol;
  varying float vAlpha;

  const vec3 DANGER = vec3(1.0, 0.541, 0.494);
  const vec3 MOSS = vec3(0.651, 0.89, 0.706);
  const vec3 WARN = vec3(1.0, 0.761, 0.478);

  vec3 drift(vec3 p, float amp) {
    float t = uTime * 0.18;
    return amp * vec3(sin(p.y * 0.012 + t + aSeed * 6.0), cos(p.x * 0.011 + t * 0.9 + aSeed * 5.0), sin(p.x * 0.009 + p.y * 0.01 + t * 0.7));
  }
  float stag(float t) {
    float d = clamp((t - aSeed * 0.32) / 0.68, 0.0, 1.0);
    return d < 0.5 ? 4.0 * d * d * d : 1.0 - pow(-2.0 * d + 2.0, 3.0) / 2.0;
  }
  vec3 eyes() {
    vec3 p = aEyes;
    if (aPart > 0.5) {
      vec2 c = vec2(aEyeC, 0.0);
      p.xy = c + (p.xy - c) * uPupil + uLookDir * uLook * 17.0;
    }
    return p * uEyeK;
  }
  vec3 hero() {
    float e = stag(uIntro);
    vec3 p = mix(aDust * uDust, eyes(), e);
    p += vec3(sin(aSeed * 50.0 + uTime * 0.6), cos(aSeed * 37.0 + uTime * 0.5), sin(aSeed * 23.0)) * sin(e * 3.14159) * 46.0;
    return p;
  }
  float settled() { return smoothstep(aS2o, aS2o + 0.06, uFall); }
  vec3 dev() {
    if (aS2k > 2.5) return aS2;
    float g = smoothstep(aS2o - 0.02, aS2o + 0.015, uGrow);
    vec3 p = mix(aS2 * 0.05, aS2, g);
    if (aS2k < 0.5) {
      float f = settled();
      p.y -= f * (22.0 + aSeed * 26.0);
      p.x += f * (aSeed - 0.5) * 8.0;
    }
    return p;
  }
  vec3 devCol(float st) {
    if (aS2k > 2.5) return vec3(1.0);
    vec3 c = vec3(0.78, 0.82, 0.8);
    if (aS2k < 0.5) return mix(c, DANGER * 1.05, st);
    if (aS2k < 1.5) return mix(c, MOSS * 1.6, st);
    return mix(c, vec3(0.26), st);
  }
  vec3 jit() { return (fract(sin(vec3(aSeed * 91.0, aSeed * 57.0, aSeed * 13.0)) * 43758.5453) - 0.5) * 2.4; }
  vec3 buyers() {
    if (aS3k > 2.5 && aS3k < 3.5) return mix(aS3a, mix(aS3a, aS3b, aS3u), step(aS3u, uDraw)) + jit();
    if (aS3k > 4.5) return mix(aS3a, mix(aS3a, aS3b, aS3u), step(aS3u, uDraw2)) + jit();
    if (aS3k > 3.5) return mix(aS3b, aS3a, smoothstep(0.0, 0.25, uDraw2));
    return aS3a;
  }
  vec3 buyersCol() {
    if (aS3k < 0.5) return devCol(1.0) * 0.6;
    if (aS3k < 1.5) return vec3(1.3);
    if (aS3k < 2.5) return vec3(1.05);
    if (aS3k < 3.5) return vec3(0.42, 0.47, 0.45);
    return WARN * (0.75 + uWarn * 0.9);
  }
  vec3 gauge() {
    float u = aS4u;
    vec3 line = vec3((u - 0.5) * 3.14159 * ${L.gauge.r.toFixed(1)} * 0.82, ${L.gauge.cy.toFixed(1)} + 40.0, 0.0);
    float a = 3.14159 * (1.0 - u);
    float rr = ${L.gauge.r.toFixed(1)} + (aSeed - 0.5) * 7.0;
    vec3 arc = vec3(cos(a) * rr, ${L.gauge.cy.toFixed(1)} + sin(a) * rr, (aSeed - 0.5) * 4.0);
    return mix(line + vec3(0.0, (aSeed - 0.5) * 6.0, 0.0), arc, uBend);
  }
  vec3 at(int k) {
    if (k == 0) return hero();
    if (k == 1) return eyes();
    if (k == 2) return dev();
    if (k == 3) return buyers();
    return gauge();
  }
  vec3 colAt(int k, vec3 p) {
    if (k <= 1) {
      if (k == 0 && uIntro < 0.999) return mix(mix(vec3(0.45, 0.68, 0.56), vec3(0.9, 1.0, 0.95), step(0.92, aSeed)) * 0.62, vec3(0.95, 0.98, 0.96), stag(uIntro));
      vec3 c = vec3(0.95, 0.98, 0.96);
      c += vec3(0.6, 0.9, 0.7) * smoothstep(5.0, 0.0, abs(p.y - uScan)) * 1.4;
      float m2 = length(p.xy - uMouse.xy);
      c += vec3(0.5, 0.75, 0.6) * exp(-(m2 * m2) / 1800.0) * 0.9;
      return mix(c, vec3(1.6, 0.45, 0.38), step(0.955, aSeed) * uFlash);
    }
    if (k == 2) return devCol(settled());
    if (k == 3) return buyersCol();
    float lit = step(aS4u, uOdds * uNeedle);
    return mix(vec3(0.2, 0.23, 0.22), uVerdict, lit);
  }
  float sizeAt(int k) {
    if (k == 0) return mix(1.7 + aSeed * 1.7, 1.25 + aSeed * 0.6, stag(uIntro));
    if (k == 1) return 1.25 + aSeed * 0.6;
    if (k == 2) return aS2k > 2.5 ? 1.5 : 1.6 + aSeed * 0.6;
    if (k == 3) return (aS3k > 2.5 && aS3k < 3.5) || aS3k > 4.5 ? 0.95 : 1.3 + aSeed * 0.5;
    return 1.2 + aSeed * 0.5;
  }

  void main() {
    int a = int(floor(uS));
    int b = min(a + 1, 4);
    float t = uS - float(a);
    float e = stag(t);
    vec3 pa = at(a), pb = at(b);
    vec3 p = mix(pa, pb, e);
    // mid-flight the grains swirl, so a change of shape reads as one material moving
    p += vec3(sin(aSeed * 50.0 + uTime * 0.6), cos(aSeed * 37.0 + uTime * 0.5), sin(aSeed * 23.0)) * sin(e * 3.14159) * 30.0;
    float amp = uS < 0.01 ? mix(9.0, 0.6, stag(uIntro)) : 0.9;
    p += drift(p, amp);
    // only the dust gives way to the cursor
    vec2 m = p.xy - uMouse.xy;
    float md = length(m);
    p.xy += normalize(m + 1e-4) * 34.0 * exp(-(md * md) / 3200.0) * (1.0 - stag(uIntro)) * (1.0 - min(1.0, uS));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(mix(sizeAt(a), sizeAt(b), e) * uPixel * (420.0 / -mv.z), 9.0 * uPixel);
    vCol = mix(colAt(a, pa), colAt(b, pb), e);
    vAlpha = mix(0.55, 1.0, step(0.5, aSeed)) * clamp(1.4 - (-mv.z - 280.0) / 520.0, 0.25, 1.0) * uFade;
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

export interface StoryText {
  dev: string;
  coin: string;
  buyers: Array<{ name: string; sub: string }>;
  funders: string[];
  odds: string;
  oddsSub: string;
  ticks: string[];
}

export interface SceneOptions {
  captions: [string, string];
  onCaption: (text: string) => void;
  onReady: () => void;
  /** The free band of the hero, in px from the host's top, between the headline and the search. */
  band: () => { top: number; bottom: number };
  /** The verdict's colour, for the gauge. */
  verdictColor: (v: StoryData["verdict"]) => string;
}

export interface Scene {
  stop: () => void;
  setStory: (d: StoryData, text: StoryText) => void;
  setProgress: (p: number) => void;
}

/** Starts the scene inside `host`. */
export function startScene(host: HTMLElement, o: SceneOptions): Scene {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = matchMedia("(max-width: 900px)").matches;
  N = small ? 11000 : 30000;
  let alive = true;
  const W = () => host.clientWidth, H = () => host.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: small ? "default" : "high-performance" });
  renderer.setPixelRatio(Math.min(small ? 1.5 : 2, devicePixelRatio || 1));
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
  const attr = (name: string, arr: Float32Array, size: number) => geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  attr("position", dust, 3);
  attr("aDust", dust, 3);
  attr("aEyes", eyes.p, 3);
  attr("aPart", eyes.part, 1);
  attr("aEyeC", eyes.centre, 1);
  attr("aSeed", seed, 1);
  // until the story is read, every chapter is the eyes
  attr("aS2", eyes.p.slice(), 3);
  attr("aS2o", new Float32Array(N).fill(-1), 1);
  attr("aS2k", new Float32Array(N).fill(3), 1);
  attr("aS3a", eyes.p.slice(), 3);
  attr("aS3b", eyes.p.slice(), 3);
  attr("aS3u", new Float32Array(N), 1);
  attr("aS3k", new Float32Array(N).fill(1), 1);
  attr("aS4u", new Float32Array(N).map((_, i) => hash(i * 0.731 + 17)), 1);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2000);

  const uniforms = {
    uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() }, uIntro: { value: reduce ? 1 : 0 },
    uScan: { value: -999 }, uFlash: { value: 0 }, uDust: { value: 1 }, uFade: { value: 1 },
    uMouse: { value: new THREE.Vector3(9999, 9999, 0) },
    uS: { value: 0 }, uLook: { value: 0 }, uPupil: { value: 1 }, uEyeK: { value: 1 }, uLookDir: { value: new THREE.Vector2(-1, -0.3) },
    uGrow: { value: 0 }, uFall: { value: 0 }, uDraw: { value: 0 }, uDraw2: { value: 0 }, uWarn: { value: 0 },
    uBend: { value: 0 }, uNeedle: { value: 0 }, uOdds: { value: 0 }, uVerdict: { value: new THREE.Color(1, 0.541, 0.494) },
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

  // two placements: the hero (centred in the band between the headline and the search) and the story's (the art
  // to the right of the text on a desktop, under it on a phone); the scroll moves from one to the other
  const heroAt = { x: 0, y: 0, k: 1 }, storyAt = { x: 0, y: 0, k: 1 };
  const EXT = small ? { x: 225, y: 245 } : { x: 410, y: 150 };
  const worldPerPxAt = (z: number) => (2 * Math.tan((camera.fov * Math.PI) / 360) * z) / H();
  const place = () => {
    renderer.setSize(W(), H());
    composer.setSize(W(), H());
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    const band = o.band();
    const k = worldPerPxAt(640);
    const bh = Math.max(120, band.bottom - band.top);
    heroAt.x = 0;
    heroAt.y = (H() / 2 - (band.top + band.bottom) / 2) * k;
    heroAt.k = Math.min(1.1, (W() * k * 0.94) / (2 * EXT.x), (bh * k) / (2 * EXT.y));
    uniforms.uDust.value = Math.min(2.2, 1 / heroAt.k);
    const wide = W() > 900;
    const c = wide ? { x: W() * 0.665, y: H() * 0.5 } : { x: W() / 2, y: H() * 0.63 };
    const box = wide ? { w: W() * 0.56, h: H() * 0.78 } : { w: W() * 0.98, h: H() * 0.5 };
    storyAt.x = (c.x - W() / 2) * k;
    storyAt.y = (H() / 2 - c.y) * k;
    storyAt.k = (Math.min(box.w, box.h * 1.05) * k) / 440;
    uniforms.uLookDir.value.set(wide ? -1 : 0, wide ? -0.32 : 1);
  };

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

  // labels and the gauge's scale, positioned from the 3D layout every frame
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
  host.appendChild(overlay);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("style", "position:absolute;inset:0;width:100%;height:100%;overflow:visible");
  overlay.appendChild(svg);
  type Label = { el: HTMLElement; x: number; y: number; z: number; ch: number; align: "l" | "r" | "c"; show: (b: ReturnType<typeof beats>) => number };
  let labels: Label[] = [];
  let ticks: Array<{ line: SVGLineElement; text: SVGTextElement; f: number }> = [];
  let needle: SVGLineElement | null = null;
  let hub: SVGCircleElement | null = null;
  let story: StoryData | null = null;
  const mono = "'Geist Mono',ui-monospace,monospace";
  const sans = "Geist,system-ui,sans-serif";

  const setStory = (d: StoryData, text: StoryText) => {
    story = d;
    const b = buildStory(d, seed, small);
    const put = (name: string, arr: Float32Array) => {
      const a = geo.getAttribute(name) as THREE.BufferAttribute;
      (a.array as Float32Array).set(arr);
      a.needsUpdate = true;
    };
    put("aS2", b.s2); put("aS2o", b.s2o); put("aS2k", b.s2k);
    put("aS3a", b.s3a); put("aS3b", b.s3b); put("aS3u", b.s3u); put("aS3k", b.s3k); put("aS4u", b.s4u);
    uniforms.uOdds.value = oddsFrac(d.run);
    uniforms.uVerdict.value.set(o.verdictColor(d.verdict)).multiplyScalar(1.15);
    for (const l of labels) l.el.remove();
    svg.replaceChildren();
    labels = [];
    const mk = (html: string, css: string) => {
      const el = document.createElement("div");
      el.innerHTML = html;
      el.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;opacity:0;${css}`;
      overlay.appendChild(el);
      return el;
    };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    labels.push({ el: mk(esc(text.dev), `font:500 ${small ? 10.5 : 11.5}px ${mono};letter-spacing:.04em;color:#fff;padding:4px 8px;border:1px solid #3a4640;border-radius:999px;background:#080b0a`), x: 0, y: -22, z: 0, ch: 2, align: "c", show: () => 1 });
    labels.push({ el: mk(esc(text.coin), `font:600 ${small ? 11.5 : 13}px ${sans};color:#fff`), x: L.coin[0] + 16, y: L.coin[1] + 2, z: 0, ch: 3, align: "l", show: () => 1 });
    const E = d.early.length;
    text.buyers.forEach((t, j) => {
      const p = b.buyers[j]!;
      labels.push({
        el: mk(`<div style="font:500 ${small ? 11 : 12.5}px ${sans};color:#e6e9e7">${esc(t.name)}</div><div style="font:400 ${small ? 9.5 : 11}px ${mono};color:#7d8681;margin-top:2px">${esc(t.sub)}</div>`, "text-align:right"),
        x: p[0] - 11, y: p[1] + 1, z: p[2], ch: 3, align: "r",
        show: (bt) => Math.min(1, Math.max(0, (bt.draw * (E + 1) - j) * 1.5)),
      });
    });
    text.funders.forEach((t, k) => {
      const p = b.funders[k]!;
      labels.push({ el: mk(esc(t), `font:500 ${small ? 10.5 : 12}px ${sans};color:#ffc27a;text-align:right`), x: p[0] - 11, y: p[1], z: 0, ch: 3, align: "r", show: (bt) => Math.min(1, bt.draw2 * 3) });
    });
    labels.push({
      el: mk(`<div style="font:600 ${small ? 30 : 44}px/1 ${sans};letter-spacing:-.04em;color:${o.verdictColor(d.verdict)}">${esc(text.odds)}</div><div style="font:400 ${small ? 11.5 : 13}px ${sans};color:#aab2ad;margin-top:6px">${esc(text.oddsSub)}</div>`, "text-align:center"),
      x: 0, y: L.gauge.cy + 34, z: 0, ch: 4, align: "c", show: (bt) => Math.min(1, Math.max(0, (bt.needle - 0.6) / 0.4)),
    });
    // the gauge's scale: ticks at each decade, the needle
    ticks = text.ticks.map((s, i) => {
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("stroke", "#7d8681");
      line.setAttribute("stroke-width", "1.2");
      const tx = document.createElementNS(svgNS, "text");
      tx.textContent = s;
      tx.setAttribute("fill", "#7d8681");
      tx.setAttribute("font-size", small ? "9.5" : "11");
      tx.setAttribute("font-family", "Geist Mono, monospace");
      svg.append(line, tx);
      return { line, text: tx, f: i / (text.ticks.length - 1) };
    });
    needle = document.createElementNS(svgNS, "line");
    needle.setAttribute("stroke", o.verdictColor(d.verdict));
    needle.setAttribute("stroke-width", "2");
    needle.setAttribute("stroke-linecap", "round");
    hub = document.createElementNS(svgNS, "circle");
    hub.setAttribute("r", "4");
    hub.setAttribute("fill", "#030504");
    hub.setAttribute("stroke", o.verdictColor(d.verdict));
    hub.setAttribute("stroke-width", "1.5");
    svg.append(needle, hub);
  };

  addEventListener("resize", place);
  place();

  let pTarget = 0;
  const setProgress = (p: number) => {
    pTarget = p;
    if (!raf && running()) wake();
  };

  // the hero: the dust holds, then gathers into the eyes; the eyes hold with a scan now and then
  const DUST = 2.2, MORPH = 3.0, SCAN = 6.5;
  const t0 = performance.now() / 1000;
  o.onCaption(reduce ? o.captions[1] : o.captions[0]);
  let saidEyes = reduce;
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number) => {
    tmp.set(x, y, z);
    group.localToWorld(tmp);
    tmp.project(camera);
    return [(tmp.x * 0.5 + 0.5) * W(), (-tmp.y * 0.5 + 0.5) * H()] as const;
  };
  let sway = 1;

  function frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, clock.getDelta());
    uniforms.uTime.value += reduce ? 0 : dt;
    const ph: Phase = phase(pTarget);
    const bt = beats(ph);
    const s = story ? ph.s : Math.min(ph.s, 1);
    uniforms.uS.value = s;

    // the hero's intro clock; scrolling into the story finishes it at once
    const el = now - t0;
    const intro = reduce ? 1 : Math.max(Math.min(1, Math.max(0, (el - DUST) / MORPH)), Math.min(1, s * 3));
    uniforms.uIntro.value = intro;
    if (!saidEyes && intro > 0.4) {
      saidEyes = true;
      o.onCaption(o.captions[1]);
    }
    const scanK = intro >= 1 && !reduce ? ((el - DUST - MORPH) % SCAN) / SCAN : -1;
    uniforms.uScan.value = scanK >= 0 && scanK < 0.6 && s < 0.05 ? 80 - (scanK / 0.6) * 200 : -999;
    uniforms.uFlash.value = scanK >= 0 && s < 0.05 ? Math.max(0, Math.sin(Math.min(1, Math.max(0, (scanK - 0.3) / 0.35)) * Math.PI)) : 0;

    uniforms.uLook.value = bt.look;
    uniforms.uPupil.value = 1 - 0.38 * bt.look;
    uniforms.uEyeK.value = 1 + 0.5 * Math.min(1, s);
    uniforms.uGrow.value = s > 2.5 ? 1 : bt.grow;
    uniforms.uFall.value = s > 2.5 ? 1 : bt.fall;
    uniforms.uDraw.value = s > 3.5 ? 1 : bt.draw;
    uniforms.uDraw2.value = s > 3.5 ? 1 : bt.draw2;
    uniforms.uWarn.value = bt.draw2 > 0.6 ? 0.5 + 0.5 * Math.sin(uniforms.uTime.value * 5) : 0;
    uniforms.uBend.value = bt.bend;
    uniforms.uNeedle.value = bt.needle;

    // placement: from the hero's to the story's
    const a = Math.min(1, s);
    const m = a * a * (3 - 2 * a);
    group.position.x = heroAt.x + (storyAt.x - heroAt.x) * m;
    group.position.y = heroAt.y + (storyAt.y - heroAt.y) * m;
    group.scale.setScalar(heroAt.k + (storyAt.k - heroAt.k) * m);
    // a slow turn in the hero, almost none in the story, none on the gauge
    sway += ((s > 3.2 ? 0 : s > 0.5 ? 0.25 : 1) - sway) * 0.05;
    group.rotation.y = Math.sin(uniforms.uTime.value * 0.11) * 0.11 * sway - 0.14 * bt.look * (s < 1.5 ? 1 : 0);
    group.rotation.x = Math.cos(uniforms.uTime.value * 0.09) * 0.05 * sway;
    group.updateMatrixWorld();

    // the dive: between the eyes and the dev, the camera goes into the left eye and out at the dev's node
    camera.position.set(0, 0, 640);
    if (s > 1 && s < 2) {
      const t = s - 1;
      const dive = Math.pow(Math.sin(Math.PI * t), 1.4);
      const ex = -1.07 * S * uniforms.uEyeK.value * (1 - t);
      tmp.set(ex, 0, 0);
      group.localToWorld(tmp);
      camera.position.set(tmp.x * dive, tmp.y * dive, 640 - 330 * dive);
    }
    uniforms.uFade.value = s > 1 && s < 2 ? 1 - 0.55 * Math.sin(Math.PI * (s - 1)) : 1;
    camera.updateMatrixWorld();

    // labels and the gauge's scale
    const vis = ph.vis;
    for (const l of labels) {
      const v = vis[l.ch]! * l.show(bt);
      l.el.style.opacity = v.toFixed(3);
      if (v <= 0.001) continue;
      const [x, y] = toScreen(l.x, l.y, l.z);
      const tx = l.align === "r" ? "-100%" : l.align === "c" ? "-50%" : "0";
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${tx}, -50%)`;
    }
    const gv = vis[4]! * bt.bend;
    svg.style.opacity = gv.toFixed(3);
    if (gv > 0.001 && needle && hub) {
      const R = L.gauge.r, cy = L.gauge.cy;
      for (const tk of ticks) {
        const ang = Math.PI * (1 - tk.f);
        const [x1, y1] = toScreen(Math.cos(ang) * (R - 12), cy + Math.sin(ang) * (R - 12), 0);
        const [x2, y2] = toScreen(Math.cos(ang) * (R - 24), cy + Math.sin(ang) * (R - 24), 0);
        const [lx, ly] = toScreen(Math.cos(ang) * (R - 40), cy + Math.sin(ang) * (R - 40), 0);
        tk.line.setAttribute("x1", x1.toFixed(1)); tk.line.setAttribute("y1", y1.toFixed(1));
        tk.line.setAttribute("x2", x2.toFixed(1)); tk.line.setAttribute("y2", y2.toFixed(1));
        tk.text.setAttribute("x", lx.toFixed(1)); tk.text.setAttribute("y", (ly + 4).toFixed(1));
        tk.text.setAttribute("text-anchor", tk.f < 0.15 ? "start" : tk.f > 0.85 ? "end" : "middle");
      }
      const ang = Math.PI * (1 - uniforms.uOdds.value * bt.needle);
      const [hx, hy] = toScreen(Math.cos(ang) * (R + 14), cy + Math.sin(ang) * (R + 14), 0);
      const [ix, iy] = toScreen(Math.cos(ang) * (R - 16), cy + Math.sin(ang) * (R - 16), 0);
      needle.setAttribute("x1", ix.toFixed(1)); needle.setAttribute("y1", iy.toFixed(1));
      needle.setAttribute("x2", hx.toFixed(1)); needle.setAttribute("y2", hy.toFixed(1));
      const [cx, cyy] = toScreen(Math.cos(ang) * R, cy + Math.sin(ang) * R, 0);
      hub.setAttribute("cx", cx.toFixed(1)); hub.setAttribute("cy", cyy.toFixed(1));
    }
    bloom.strength = 0.85 - 0.25 * Math.min(1, Math.max(0, s - 1));

    composer.render();
    raf = alive && running() ? requestAnimationFrame(frame) : 0;
  }

  // nothing runs while the tab is hidden or the stage is scrolled away
  let shown = true, onScreen = true, raf = 0;
  const running = () => shown && onScreen;
  const wake = () => {
    if (!alive) return;
    if (running() && !raf) {
      clock.getDelta();
      raf = requestAnimationFrame(frame);
    } else if (!running() && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const onVis = () => {
    shown = !document.hidden;
    wake();
  };
  document.addEventListener("visibilitychange", onVis);
  const io = new IntersectionObserver(([e]) => {
    onScreen = !!e?.isIntersecting;
    wake();
  });
  io.observe(host);
  shown = !document.hidden;
  wake();
  o.onReady();
  return {
    setStory,
    setProgress,
    stop: () => {
      alive = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      removeEventListener("resize", place);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerleave", onLeave);
      overlay.remove();
      geo.dispose();
      mat.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
