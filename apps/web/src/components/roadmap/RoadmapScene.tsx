import { Html, Line, MeshTransmissionMaterial, Sparkles, useFBO, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, type DepthOfFieldEffect, ToneMappingMode } from "postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";
import type { LiveNumbers } from "../LiveStats";
import { type Milestone, MILESTONES } from "./milestones";
import type { Stage } from "./Roadmap";

type Vec3 = [number, number, number];
type Active = { id: string; pinned: boolean } | null;

const SHIPPED_R = 0.36;
const NEXT_R = 0.3;
const BACKDROP = "/backdrops/roadmap.webp";
const BACKDROP_ASPECT = 2400 / 1348;
const BACKDROP_DISTANCE = 34;
/** Vertical field of view across the stage. The canvas is taller, so the real fov grows with it. */
const STAGE_FOV = 40;

/**
 * The canvas fills the whole section, but the 3D frame is composed for the
 * stage under the heading. A view offset keeps the camera axis on the stage's
 * centre and extends the frustum over the rest of the canvas.
 */
function frameFor(stage: Stage, width: number, height: number) {
  const centre = stage.top + stage.height / 2;
  const half = Math.max(centre, height - centre);
  const tanStage = Math.tan(((STAGE_FOV / 2) * Math.PI) / 180);
  const tanFull = tanStage * (half / (stage.height / 2));
  return { fov: (2 * Math.atan(tanFull) * 180) / Math.PI, full: 2 * half, offsetY: half - centre, tanFull };
}

function Frame({ stage }: { stage: Stage }) {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const f = frameFor(stage, size.width, size.height);
    cam.fov = f.fov;
    cam.aspect = size.width / f.full;
    cam.setViewOffset(size.width, f.full, 0, f.offsetY, size.width, size.height);
    cam.updateProjectionMatrix();
  }, [camera, size, stage]);
  return null;
}

/**
 * The milestones walk down the forest path: what shipped is close and bright,
 * what comes next recedes into the fog toward the light at the end of the road.
 */
const PATH: Vec3[] = [
  [-4.8, -1.05, 2.4],
  [-2.0, -0.95, 1.7],
  [2.6, -0.8, 0.6],
  [2.4, -0.55, -2.6],
  [-2.2, -0.3, -5.2],
  [2.7, -0.05, -8.2],
  [-2.3, 0.25, -11.4],
];

/** Where milestone k sits along the path, as a fraction of its length. */
const at = (k: number) => 0.04 + (k / (MILESTONES.length - 1)) * 0.92;

function makeCurve(portrait: boolean) {
  return new THREE.CatmullRomCurve3(
    PATH.map(([x, y, z]) => new THREE.Vector3(portrait ? x * 0.3 : x, portrait ? y - 0.6 : y, z)),
    false,
    "centripetal",
  );
}

/** Camera rest pose for each layout. The canvas starts far above, so the camera flies in. */
function pose(portrait: boolean) {
  return {
    eye: new THREE.Vector3(0, portrait ? 4.6 : 3.2, portrait ? 13.5 : 8.6),
    look: new THREE.Vector3(0, portrait ? -0.2 : 0.4, -4.2),
  };
}

function Rig({ portrait, focus }: { portrait: boolean; focus: Vec3 | null }) {
  const { camera } = useThree();
  const { eye, look } = useMemo(() => pose(portrait), [portrait]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const aim = useMemo(() => look.clone(), [look]);
  const wanted = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ pointer }) => {
    target.copy(eye);
    target.x += pointer.x * 0.8;
    target.y += pointer.y * 0.35;
    wanted.copy(look);
    if (focus) {
      // Lean toward whatever is in focus, without losing the path.
      target.lerp(wanted.set(...focus), 0.07);
      wanted.set(...focus).lerp(look, 0.65);
    }
    camera.position.lerp(target, 0.035);
    aim.lerp(wanted, 0.05);
    camera.lookAt(aim);
  });
  return null;
}

/** The forest photo lives inside the scene, far behind the path, so the glass refracts it. */
function Backdrop({ portrait, stage }: { portrait: boolean; stage: Stage }) {
  const map = useTexture(BACKDROP);
  map.colorSpace = THREE.SRGBColorSpace;
  const { size } = useThree();
  const mesh = useRef<THREE.Mesh>(null);
  const { eye, look } = useMemo(() => pose(portrait), [portrait]);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const f = frameFor(stage, size.width, size.height);
    const dir = look.clone().sub(eye).normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
    // World size of the visible canvas at the backdrop's distance, and where its centre is.
    const unit = BACKDROP_DISTANCE * f.tanFull; // half the virtual frame
    const h = (size.height / (f.full / 2)) * unit * 1.3; // margin for parallax and the fly-in
    const w = h * (size.width / size.height);
    const centreNdc = 1 - (2 * (f.offsetY + size.height / 2)) / f.full;
    m.position.copy(eye).addScaledVector(dir, BACKDROP_DISTANCE).addScaledVector(up, centreNdc * unit);
    m.lookAt(m.position.clone().sub(dir));
    // Cover: fill the canvas and crop whatever overflows.
    const height = Math.max(h, w / BACKDROP_ASPECT);
    m.scale.set(height * BACKDROP_ASPECT, height, 1);
  }, [eye, look, size, stage]);

  return (
    <mesh ref={mesh} renderOrder={-1}>
      <planeGeometry />
      {/* A touch darker than the photo, so the milestones carry the light. */}
      <meshBasicMaterial map={map} color="#b8bcc0" fog={false} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/** Characters roll before a reading settles, like an instrument. */
function Scramble({ text }: { text: string }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    const glyphs = "0123456789#%+/·";
    const total = 14;
    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      const settled = Math.floor((frame / total) * text.length);
      setShown(
        text
          .split("")
          .map((c, i) => (i < settled || c === " " ? c : glyphs[Math.floor(Math.random() * glyphs.length)]))
          .join(""),
      );
      if (frame >= total) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [text]);
  return <>{shown}</>;
}

/** A link that grows out of the active milestone toward its neighbour. */
function GrowLine({ from, to }: { from: Vec3; to: Vec3 }) {
  const line = useRef<Line2>(null);
  const progress = useRef(0);
  const a = useMemo(() => new THREE.Vector3(...from), [from]);
  const b = useMemo(() => new THREE.Vector3(...to), [to]);
  const tip = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    if (!line.current || progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + dt * 2.6);
    tip.copy(a).lerp(b, 1 - Math.pow(1 - progress.current, 3));
    line.current.geometry.setPositions([a.x, a.y, a.z, tip.x, tip.y, tip.z]);
  });
  return <Line ref={line} points={[from, from]} color="#fff6e6" lineWidth={1} transparent opacity={0.7} />;
}

function Orb({
  m,
  index,
  position,
  active,
  faded,
  buffer,
  glass,
  onHover,
  onSelect,
}: {
  m: Milestone;
  index: number;
  position: Vec3;
  active: boolean;
  faded: boolean;
  buffer: THREE.Texture;
  /** Glass shells are hidden while the transmission buffer renders; the glowing cores are not. */
  glass: Set<THREE.Mesh>;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.MeshBasicMaterial>(null);
  const scaleTo = useMemo(() => new THREE.Vector3(), []);
  const shipped = m.status === "shipped";
  const r = shipped ? SHIPPED_R : NEXT_R;
  // HDR colours above 1 are what the bloom pass picks up.
  const warm = useMemo(() => new THREE.Color(4.2, 2.5, 1.1), []);
  const cold = useMemo(() => new THREE.Color(1.1, 1.3, 1.6), []);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.position.y = position[1] + Math.sin(t * 0.7 + index * 1.3) * 0.07;
    const s = active ? 1.16 : 1;
    g.scale.lerp(scaleTo.set(s, s, s), 0.1);
    if (core.current) {
      const breathe = shipped ? 1 : 0.55 + Math.sin(t * 1.3 + index) * 0.35;
      core.current.color.copy(shipped ? warm : cold).multiplyScalar((faded ? 0.3 : active ? 1.2 : 1) * breathe);
    }
  });

  return (
    <group ref={group} position={position}>
      <mesh
        ref={(mesh) => {
          if (!mesh) return;
          glass.add(mesh);
          return () => void glass.delete(mesh);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(m.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(m.id);
        }}
      >
        <sphereGeometry args={[r, 64, 64]} />
        <MeshTransmissionMaterial
          buffer={buffer}
          transmission={1}
          thickness={0.22}
          roughness={shipped ? 0 : 0.22}
          ior={1.22}
          chromaticAberration={0.035}
          anisotropicBlur={0.02}
          distortion={0}
          clearcoat={1}
          clearcoatRoughness={0}
          attenuationDistance={4}
          attenuationColor="#ffffff"
          color={faded ? "#a7adb2" : "#ffffff"}
          samples={6}
          resolution={512}
          backside={false}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[r * (shipped ? 0.3 : 0.17), 32, 32]} />
        <meshBasicMaterial ref={core} toneMapped={false} />
      </mesh>
      {shipped && <pointLight color="#ffc979" intensity={active ? 3 : 1.1} distance={2} decay={2} />}
      <Html center position={[0, -r - 0.22, 0]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <span className={`font-mono whitespace-nowrap text-[10.5px] text-white transition-opacity duration-300 ${faded ? "opacity-20" : "opacity-60"}`}>
          {String(index + 1).padStart(2, "0")}
        </span>
      </Html>
    </group>
  );
}

function Effects({ rich, focus }: { rich: boolean; focus: THREE.Vector3 }) {
  const dof = useRef<DepthOfFieldEffect>(null);
  useFrame(() => {
    if (dof.current) dof.current.target = focus;
  });
  const aberration = useMemo(() => new THREE.Vector2(0.0005, 0.0007), []);
  // Depth of field is the most expensive pass, so phones skip it.
  return rich ? (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom mipmapBlur luminanceThreshold={1.15} luminanceSmoothing={0.04} intensity={1.1} radius={0.7} />
      <DepthOfField ref={dof} worldFocusRange={9} bokehScale={1.6} height={540} />
      <ChromaticAberration offset={aberration} radialModulation modulationOffset={0.3} />
      <Vignette offset={0.28} darkness={0.72} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.12} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  ) : (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom mipmapBlur luminanceThreshold={1.15} luminanceSmoothing={0.04} intensity={1} radius={0.7} />
      <Vignette offset={0.28} darkness={0.72} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.1} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}

function Scene({
  live,
  portrait,
  stage,
  onMiss,
  onActive,
}: {
  live: LiveNumbers | null;
  portrait: boolean;
  stage: Stage;
  onMiss: { current: () => void };
  onActive: (active: Active) => void;
}) {
  const firstNext = MILESTONES.findIndex((m) => m.status === "next");
  const curve = useMemo(() => makeCurve(portrait), [portrait]);
  const positions = useMemo(() => MILESTONES.map((_, i) => curve.getPointAt(at(i)).toArray() as Vec3), [curve]);
  const byId = useMemo(() => new Map(MILESTONES.map((m, i) => [m.id, i])), []);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  onMiss.current = () => setSelected(null);
  const active = hovered ?? selected;
  const activeIndex = active ? byId.get(active)! : -1;
  const activeM = activeIndex >= 0 ? MILESTONES[activeIndex]! : null;
  useEffect(() => onActive(active ? { id: active, pinned: active === selected && !hovered } : null), [active, selected, hovered, onActive]);

  const related = useMemo(() => {
    if (!activeM) return new Set<string>();
    return new Set([...activeM.links, ...MILESTONES.filter((m) => m.links.includes(activeM.id)).map((m) => m.id)]);
  }, [activeM]);

  const shippedPath = useMemo(
    () => Array.from({ length: 90 }, (_, i) => curve.getPointAt(at(0) + (i / 89) * (at(firstNext - 1) - at(0)))),
    [curve, firstNext],
  );
  const nextPath = useMemo(
    () => Array.from({ length: 70 }, (_, i) => curve.getPointAt(at(firstNext - 1) + (i / 69) * (at(MILESTONES.length - 1) - at(firstNext - 1)))),
    [curve, firstNext],
  );

  // "We are here": a spark running from the last shipped milestone to the next one.
  const spark = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!spark.current) return;
    const t = (clock.elapsedTime * 0.22) % 1;
    spark.current.position.copy(curve.getPointAt(at(firstNext - 1) + (at(firstNext) - at(firstNext - 1)) * t));
    spark.current.scale.setScalar(Math.sin(t * Math.PI) + 0.001);
  });

  // One transmission buffer for all the glass: the scene without the shells, rendered once a frame.
  const fbo = useFBO(1024, 1024, { samples: 0 });
  const glass = useMemo(() => new Set<THREE.Mesh>(), []);
  useFrame(({ gl, scene, camera }) => {
    for (const g of glass) g.visible = false;
    gl.setRenderTarget(fbo);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    for (const g of glass) g.visible = true;
  });

  // Rack focus: depth of field follows the milestone under the cursor.
  const focus = useMemo(() => new THREE.Vector3(...positions[2]!), [positions]);
  const focusTo = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    focus.lerp(focusTo.set(...(activeIndex >= 0 ? positions[activeIndex]! : positions[2]!)), 0.08);
  });

  return (
    <>
      <Frame stage={stage} />
      <Rig portrait={portrait} focus={activeIndex >= 0 ? positions[activeIndex]! : null} />
      <fog attach="fog" args={["#0a0f12", 9, 30]} />
      <Backdrop portrait={portrait} stage={stage} />

      <Sparkles count={portrait ? 60 : 120} position={[0, 0, -5]} scale={portrait ? [6, 6, 22] : [15, 5, 22]} size={2} speed={0.22} opacity={0.6} color="#ffe2b0" />

      <Line points={shippedPath} color="#ffe6c2" lineWidth={1} transparent opacity={activeM ? 0.1 : 0.32} />
      <Line points={nextPath} color="#c7d2dd" lineWidth={1} dashed dashSize={0.18} gapSize={0.14} transparent opacity={activeM ? 0.06 : 0.22} />
      <mesh ref={spark}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color={[5, 3.6, 2]} toneMapped={false} />
      </mesh>

      <group>
        {MILESTONES.map((m, i) => (
          <Orb
            key={m.id}
            m={m}
            index={i}
            position={positions[i]!}
            active={active === m.id}
            faded={!!activeM && active !== m.id && !related.has(m.id)}
            buffer={fbo.texture}
            glass={glass}
            onHover={setHovered}
            onSelect={(id) => setSelected((s) => (s === id ? null : id))}
          />
        ))}
      </group>

      {activeM &&
        [...related].map((id) => {
          const j = byId.get(id)!;
          const to = positions[j]!;
          const m = MILESTONES[j]!;
          return (
            <group key={`${activeM.id}-${id}`}>
              <GrowLine from={positions[activeIndex]!} to={to} />
              <Html
                position={[to[0] + 0.1, to[1] + (m.status === "shipped" ? SHIPPED_R : NEXT_R) + 0.14, to[2]]}
                zIndexRange={[20, 10]}
                style={{ pointerEvents: "none" }}
              >
                <div className="font-mono whitespace-nowrap text-[11px] leading-tight text-white/90">
                  <span className="mr-1.5 text-white/50">+</span>
                  <Scramble text={m.metric(live)} />
                  <div className="mt-0.5 pl-4 text-[10px] text-white/45">{m.title}</div>
                </div>
              </Html>
            </group>
          );
        })}

      <Effects rich={!portrait} focus={focus} />
    </>
  );
}

export default function RoadmapScene({
  live,
  running,
  portrait,
  stage,
  onActive,
}: {
  live: LiveNumbers | null;
  running: boolean;
  portrait: boolean;
  stage: Stage;
  onActive: (active: Active) => void;
}) {
  const onMiss = useRef(() => {});
  return (
    <Canvas
      frameloop={running ? "always" : "never"}
      dpr={portrait ? [1, 1.5] : [1, 1.75]}
      camera={{ fov: STAGE_FOV, position: [0, 5.5, 15], near: 0.1, far: 120, manual: true }}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance", toneMapping: THREE.NoToneMapping }}
      onPointerMissed={() => {
        document.body.style.removeProperty("cursor");
        onMiss.current();
      }}
    >
      <color attach="background" args={["#05080a"]} />
      <Scene live={live} portrait={portrait} stage={stage} onMiss={onMiss} onActive={onActive} />
    </Canvas>
  );
}
