import { Environment, Html, Lightformer, Line, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { LiveNumbers } from "../LiveStats";
import { type Milestone, MILESTONES } from "./milestones";

type Vec3 = [number, number, number];

const SHIPPED_R = 0.36;
const NEXT_R = 0.3;

/**
 * The milestones walk down the forest path of the backdrop: what shipped is
 * close and bright, what comes next recedes into the fog toward the light.
 */
const PATH_LANDSCAPE: Vec3[] = [
  [-5.6, -1.25, 3.2],
  [-2.2, -1.0, 2.0],
  [2.6, -0.8, 0.6],
  [2.4, -0.55, -2.6],
  [-2.2, -0.3, -5.2],
  [2.7, -0.05, -8.2],
  [-2.3, 0.25, -11.4],
];

/** Where milestone k sits along the path, as a fraction of its length. */
const at = (k: number) => 0.04 + (k / (MILESTONES.length - 1)) * 0.92;

function layout(count: number, portrait: boolean): { points: Vec3[]; curve: THREE.CatmullRomCurve3 } {
  const curve = new THREE.CatmullRomCurve3(
    PATH_LANDSCAPE.map(([x, y, z]) => new THREE.Vector3(portrait ? x * 0.3 : x, portrait ? y - 0.6 : y, z)),
    false,
    "centripetal",
  );
  // Equal steps along the path, so the spacing shrinks with distance like footsteps.
  const points = Array.from({ length: count }, (_, i) => curve.getPointAt(at(i)).toArray() as Vec3);
  return { points, curve };
}

/** Camera breathes with the pointer, looking down the path. */
function Rig({ portrait }: { portrait: boolean }) {
  const { camera } = useThree();
  const base = useMemo(() => new THREE.Vector3(0, portrait ? 4.6 : 3.4, portrait ? 13.5 : 8.2), [portrait]);
  const look = useMemo(() => new THREE.Vector3(0, -1.1, -4.2), []);

  useFrame(({ pointer }) => {
    camera.position.x += (base.x + pointer.x * 0.8 - camera.position.x) * 0.04;
    camera.position.y += (base.y + pointer.y * 0.35 - camera.position.y) * 0.04;
    camera.position.z += (base.z - camera.position.z) * 0.08;
    camera.lookAt(look);
  });
  return null;
}

/** Glass edge: bright at grazing angles, clear in the middle. */
const rimVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const rimFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.6);
    gl_FragColor = vec4(uColor * f * uStrength, f * uStrength);
  }
`;

function Orb({
  m,
  index,
  position,
  active,
  faded,
  onHover,
  onSelect,
}: {
  m: Milestone;
  index: number;
  position: Vec3;
  active: boolean;
  faded: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const shipped = m.status === "shipped";
  const r = shipped ? SHIPPED_R : NEXT_R;
  const rim = useMemo(
    () => ({ uColor: { value: new THREE.Color(shipped ? "#fff1d6" : "#cfdbe8") }, uStrength: { value: 1 } }),
    [shipped],
  );

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.position.y = position[1] + Math.sin(t * 0.7 + index * 1.3) * 0.07;
    const s = active ? 1.14 : 1;
    g.scale.lerp(target.set(s, s, s), 0.12);
    const strength = (faded ? 0.25 : active ? 1.6 : 1) * (shipped ? 1 : 0.7);
    rim.uStrength.value += (strength - rim.uStrength.value) * 0.15;
    if (core.current) {
      // Shipped milestones glow steadily; the future ones breathe.
      const glow = shipped ? 1 : 0.35 + Math.sin(t * 1.4 + index) * 0.2;
      (core.current.material as THREE.MeshBasicMaterial).opacity = faded ? glow * 0.35 : glow;
    }
  });

  return (
    <group ref={group} position={position}>
      <mesh
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
        {/* A clear shell that only shows reflections of the light formers. */}
        <meshPhysicalMaterial
          color="#ffffff"
          roughness={shipped ? 0.02 : 0.35}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.04}
          envMapIntensity={shipped ? 2.6 : 1.2}
          transparent
          opacity={faded ? 0.04 : shipped ? 0.12 : 0.18}
          depthWrite={false}
        />
      </mesh>
      <mesh scale={1.001}>
        <sphereGeometry args={[r, 48, 48]} />
        <shaderMaterial
          vertexShader={rimVertex}
          fragmentShader={rimFragment}
          uniforms={rim}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={core}>
        <sphereGeometry args={[r * (shipped ? 0.24 : 0.16), 32, 32]} />
        <meshBasicMaterial color={shipped ? "#ffd59a" : "#c9d6e6"} transparent toneMapped={false} />
      </mesh>
      {shipped && <pointLight color="#ffc979" intensity={active ? 2.4 : 0.9} distance={1.8} decay={2} />}
      <Html center position={[0, -r - 0.22, 0]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <span className={`font-mono whitespace-nowrap text-[10.5px] transition-opacity ${faded ? "opacity-25" : "opacity-60"} text-white`}>
          {String(index + 1).padStart(2, "0")}
        </span>
      </Html>
    </group>
  );
}

function Scene({
  live,
  portrait,
  onMiss,
  onActive,
}: {
  live: LiveNumbers | null;
  portrait: boolean;
  onMiss: { current: () => void };
  onActive: (active: { id: string; pinned: boolean } | null) => void;
}) {
  const firstNext = MILESTONES.findIndex((m) => m.status === "next");
  const { points: positions, curve } = useMemo(() => layout(MILESTONES.length, portrait), [portrait]);
  const byId = useMemo(() => new Map(MILESTONES.map((m, i) => [m.id, i])), []);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  onMiss.current = () => setSelected(null);
  const active = hovered ?? selected;
  const activeIndex = active ? byId.get(active)! : -1;
  const activeM = activeIndex >= 0 ? MILESTONES[activeIndex]! : null;
  useEffect(() => onActive(active ? { id: active, pinned: active === selected && !hovered } : null), [active, selected, hovered, onActive]);

  // Everything the active milestone builds on, and everything built on it.
  const related = useMemo(() => {
    if (!activeM) return new Set<string>();
    return new Set([...activeM.links, ...MILESTONES.filter((m) => m.links.includes(activeM.id)).map((m) => m.id)]);
  }, [activeM]);

  const shippedPath = useMemo(
    () => Array.from({ length: 90 }, (_, i) => curve.getPointAt(at(0) + (i / 89) * (at(firstNext - 1) - at(0)))),
    [curve, firstNext],
  );
  const nextPath = useMemo(
    () => Array.from({ length: 70 }, (_, i) => curve.getPointAt(at(firstNext - 1) + (i / 69) * (at(positions.length - 1) - at(firstNext - 1)))),
    [curve, firstNext],
  );

  // A spark travelling from the last shipped milestone toward the next one: "we are here".
  const spark = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!spark.current) return;
    const a = at(firstNext - 1);
    const b = at(firstNext);
    const t = (clock.elapsedTime * 0.22) % 1;
    spark.current.position.copy(curve.getPointAt(a + (b - a) * t));
    (spark.current.material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI);
  });

  return (
    <>
      <Rig portrait={portrait} />
      <fog attach="fog" args={["#05080a", 10, 30]} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[-4, 6, 4]} intensity={0.6} color="#cfe0ff" />
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={2.2} color="#d6e6ff" position={[-5, 4, 3]} scale={[6, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={1.2} color="#bff2d4" position={[4, 2, 5]} scale={3} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.6} color="#ffffff" position={[0, -4, -4]} scale={[10, 2, 1]} target={[0, 0, 0]} />
      </Environment>

      <Sparkles count={portrait ? 60 : 110} position={[0, 0, -5]} scale={portrait ? [6, 5, 22] : [14, 4, 22]} size={1.8} speed={0.22} opacity={0.5} color="#ffe2b0" />

      <Line points={shippedPath} color="#ffe6c2" lineWidth={1} transparent opacity={activeM ? 0.12 : 0.32} />
      <Line points={nextPath} color="#c7d2dd" lineWidth={1} dashed dashSize={0.18} gapSize={0.14} transparent opacity={activeM ? 0.08 : 0.22} />
      <mesh ref={spark}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color="#fff0d2" transparent toneMapped={false} />
      </mesh>

      {MILESTONES.map((m, i) => (
        <Orb
          key={m.id}
          m={m}
          index={i}
          position={positions[i]!}
          active={active === m.id}
          faded={!!activeM && active !== m.id && !related.has(m.id)}
          onHover={setHovered}
          onSelect={(id) => setSelected((s) => (s === id ? null : id))}
        />
      ))}

      {activeM && (
        <>
          {[...related].map((id) => {
            const j = byId.get(id)!;
            const from = positions[activeIndex]!;
            const to = positions[j]!;
            const m = MILESTONES[j]!;
            return (
              <group key={id}>
                <Line points={[from, to]} color="#ffffff" lineWidth={1} transparent opacity={0.55} />
                <Html position={[to[0] + 0.1, to[1] + (m.status === "shipped" ? SHIPPED_R : NEXT_R) + 0.14, to[2]]} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
                  <div className="font-mono whitespace-nowrap text-[11px] leading-tight text-white/85">
                    <span className="mr-1.5 text-white/50">+</span>
                    {m.metric(live)}
                    <div className="mt-0.5 pl-4 text-[10px] text-white/45">{m.title}</div>
                  </div>
                </Html>
              </group>
            );
          })}
        </>
      )}
    </>
  );
}

export default function RoadmapScene({
  live,
  running,
  portrait,
  onActive,
}: {
  live: LiveNumbers | null;
  running: boolean;
  portrait: boolean;
  onActive: (active: { id: string; pinned: boolean } | null) => void;
}) {
  const onMiss = useRef(() => {});
  return (
    <Canvas
      frameloop={running ? "always" : "never"}
      dpr={[1, 1.75]}
      camera={{ fov: 40, position: [0, 0.8, 10], near: 0.1, far: 80 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onPointerMissed={() => {
        document.body.style.removeProperty("cursor");
        onMiss.current();
      }}
    >
      <Scene live={live} portrait={portrait} onMiss={onMiss} onActive={onActive} />
    </Canvas>
  );
}
