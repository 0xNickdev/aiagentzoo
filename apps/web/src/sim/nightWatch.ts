import { SPECIES_COLOR, type SpeciesId } from "../data";

export const PARTS = [
  "New launches overnight",
  "Liquidity moves",
  "Top holders",
  "Suspicious contracts",
  "Went to zero",
  "Blocks triggered",
  "Summary table",
  "Night in review",
];

const NIGHT_START = 22 * 60;
const NIGHT_LENGTH = 9 * 60;
const SIM_MIN_PER_SEC = 6;
const FEED_PER_CYCLE = 0.4;
const FEED_PER_SIGNAL = 0.05;

type Ambience = "fireflies" | "ripples" | "dust";

interface Enclosure { id: string; name: string; node: string; cx: number; cy: number; r: number; seed: number; ambience: Ambience; tint: string; brightness: number; squash: number }

const ENCLOSURES: Enclosure[] = [
  { id: "north", name: "Northern Edge", node: "north.zoo", cx: 0.25, cy: 0.41, r: 0.21, seed: 1.3, ambience: "fireflies", tint: "214,232,170", brightness: 0.95, squash: 0.9 },
  { id: "marsh", name: "Quiet Marsh", node: "marsh.zoo", cx: 0.75, cy: 0.42, r: 0.2, seed: 2.7, ambience: "ripples", tint: "170,214,220", brightness: 1, squash: 0.55 },
  { id: "canyon", name: "Stone Canyon", node: "canyon.zoo", cx: 0.52, cy: 0.78, r: 0.19, seed: 4.1, ambience: "dust", tint: "236,214,180", brightness: 0.62, squash: 0.85 },
];
const encById = Object.fromEntries(ENCLOSURES.map((e) => [e.id, e]));

const ROSTER: { name: string; species: SpeciesId; enc: string; sprite: string }[] = [
  { name: "Raven", species: "sentinel", enc: "north", sprite: "raven" },
  { name: "Hedgehog", species: "gatherer", enc: "north", sprite: "hedgehog" },
  { name: "Owl", species: "sentinel", enc: "marsh", sprite: "owl" },
  { name: "Otter", species: "gatherer", enc: "marsh", sprite: "otter" },
  { name: "Beaver", species: "builder", enc: "canyon", sprite: "beaver" },
  { name: "Tortoise", species: "archivist", enc: "canyon", sprite: "tortoise" },
];

/* Optional generated art. Missing files fall back to vector drawing. */
const images = new Map<string, HTMLImageElement>();
function art(path: string): HTMLImageElement | null {
  let img = images.get(path);
  if (!img) {
    img = new Image();
    img.src = path;
    images.set(path, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

interface Mote { enc: string; x: number; y: number; vx: number; vy: number; phase: number; size: number }
interface Ripple { enc: string; x: number; y: number; age: number; tint: string }

type Action =
  | { type: "scan" }
  | { type: "archive" }
  | { type: "patrol" }
  | { type: "collect"; part: number }
  | { type: "build"; part: number }
  /** Mirrors a real wake-up from a live node: animate only, no simulated work. */
  | { type: "live" };

interface Animal {
  name: string;
  species: SpeciesId;
  enc: string;
  sprite: string;
  ox: number;
  oy: number;
  tx: number;
  ty: number;
  awake: boolean;
  moving: boolean;
  trail: { x: number; y: number; life: number }[];
  queue: Action[];
  nextWake: number;
  sleepIn: number;
}

interface Signal { from: Animal; to: Animal; part: number; accepted: boolean; t: number }

export interface LogEntry { id: number; time: string; who: string | null; species: SpeciesId | null; enc: string | null; text: string; hash: string }

export interface Snapshot {
  clock: string;
  cycles: number;
  feed: number;
  signals: number;
  rejected: number;
  awake: number;
  done: boolean[];
  progress: number;
  status: "building" | "published" | "partial";
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const hash = () => Math.random().toString(16).slice(2, 8);

export class NightWatch {
  speed = 1;
  paused = false;
  /** When true the map mirrors real node events instead of simulating a night. */
  live = false;

  private minute = 0;
  private animals: Animal[] = [];
  private signals: Signal[] = [];
  private unassigned: number[] = [];
  private drafted = new Set<number>();
  private done = new Set<number>();
  private stats = { cycles: 0, feed: 0, signals: 0, rejected: 0 };
  private status: Snapshot["status"] = "building";
  private resetIn = 0;
  private logId = 0;
  private motes: Mote[] = ENCLOSURES.flatMap((e) =>
    Array.from({ length: e.ambience === "dust" ? 26 : 18 }, () => ({
      enc: e.id,
      x: rand(-0.9, 0.9),
      y: rand(-0.9, 0.9),
      vx: rand(-0.02, 0.02),
      vy: e.ambience === "fireflies" ? rand(-0.03, -0.005) : rand(-0.01, 0.01),
      phase: rand(0, Math.PI * 2),
      size: rand(0.6, 1.8),
    })),
  );
  private ripples: Ripple[] = [];

  constructor(
    private onLog: (entry: LogEntry | "reset") => void,
  ) {
    this.reset();
  }

  reset() {
    this.minute = 0;
    this.animals = ROSTER.map((a, i) => ({
      ...a,
      ox: Math.cos(i * Math.PI + rand(-0.4, 0.4)) * rand(0.3, 0.5),
      oy: Math.sin(i * Math.PI + 0.8 + rand(-0.4, 0.4)) * rand(0.3, 0.5),
      tx: 0,
      ty: 0,
      awake: false,
      moving: false,
      trail: [],
      queue: [],
      nextWake: a.species === "sentinel" ? rand(5, 25) : a.species === "archivist" ? 60 : rand(60, 120),
      sleepIn: 0,
    }));
    this.signals = [];
    this.unassigned = PARTS.map((_, i) => i);
    this.drafted.clear();
    this.done.clear();
    this.stats = { cycles: 0, feed: 0, signals: 0, rejected: 0 };
    this.status = "building";
    this.onLog("reset");
    this.log(null, "Night begins. Warden on duty, kill-switch armed.");
  }

  snapshot(): Snapshot {
    return {
      clock: this.timeLabel(),
      ...this.stats,
      awake: this.animals.filter((a) => a.awake).length,
      done: PARTS.map((_, i) => this.done.has(i)),
      progress: (this.done.size + this.drafted.size * 0.5) / PARTS.length,
      status: this.status,
    };
  }

  private timeLabel() {
    if (this.live) {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    const m = Math.floor(NIGHT_START + this.minute) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  private log(animal: Animal | null, text: string) {
    this.onLog({
      id: ++this.logId,
      time: this.timeLabel(),
      who: animal?.name ?? null,
      species: animal?.species ?? null,
      enc: animal?.enc ?? null,
      text,
      hash: hash(),
    });
  }

  private of(species: SpeciesId) {
    return this.animals.filter((a) => a.species === species);
  }

  private wake(a: Animal, action: Action) {
    a.queue.push(action);
    a.awake = true;
    if (!a.moving) this.newTarget(a);
  }

  private newTarget(a: Animal) {
    const neighbours = this.animals.filter((o) => o !== a && o.enc === a.enc);
    let best = { x: 0, y: 0, gap: -1 };
    for (let i = 0; i < 8; i++) {
      const ang = rand(0, Math.PI * 2);
      const dist = Math.sqrt(Math.random()) * 0.7;
      const x = Math.cos(ang) * dist;
      const y = Math.sin(ang) * dist;
      const gap = Math.min(...neighbours.map((o) => Math.hypot(x - o.ox, y - o.oy)), Infinity);
      if (gap > best.gap) best = { x, y, gap };
      if (gap > 0.45) break;
    }
    a.tx = best.x;
    a.ty = best.y;
    a.moving = true;
  }

  private send(from: Animal, to: Animal, part: number) {
    this.stats.feed += FEED_PER_SIGNAL;
    this.signals.push({ from, to, part, accepted: Math.random() > 0.12, t: 0 });
  }

  private perform(a: Animal, action: Action) {
    if (action.type === "live") return;
    this.stats.cycles += 1;
    this.stats.feed += FEED_PER_CYCLE;
    switch (action.type) {
      case "scan": {
        if (this.unassigned.length && Math.random() < 0.55) {
          const part = this.unassigned.shift()!;
          const target = pick(this.of("gatherer"));
          const remote = target.enc !== a.enc ? " (remote node)" : "";
          this.log(a, `found a trail: “${PARTS[part]}” → signal ${target.name}${remote}`);
          this.send(a, target, part);
        } else {
          this.log(a, "patrolled the territory, no new trails");
        }
        break;
      }
      case "collect": {
        const builder = this.of("builder")[0];
        this.log(a, `gathered data for “${PARTS[action.part]}” → signal ${builder.name}`);
        this.send(a, builder, action.part);
        break;
      }
      case "build":
        this.drafted.add(action.part);
        this.log(a, `drafted “${PARTS[action.part]}”`);
        break;
      case "archive": {
        const ready = [...this.drafted];
        if (ready.length) {
          ready.forEach((p) => { this.drafted.delete(p); this.done.add(p); });
          this.log(a, `committed ${ready.length} section(s) to the log`);
        } else {
          this.log(a, "checked drafts, nothing to commit");
        }
        break;
      }
      case "patrol":
        this.log(a, "woke on schedule, budget intact, back to sleep");
        break;
    }
  }

  private deliver(s: Signal) {
    if (!s.accepted) {
      this.stats.rejected += 1;
      this.unassigned.push(s.part);
      this.log(s.to, `rejected signal from ${s.from.name}: failed species schema`);
      return;
    }
    this.stats.signals += 1;
    this.wake(s.to, { type: s.to.species === "builder" ? "build" : "collect", part: s.part });
  }

  /** Animate a real wake-up reported by a node. */
  liveWake(name: string) {
    const a = this.animals.find((x) => x.sprite === name);
    if (a) this.wake(a, { type: "live" });
  }

  /** Animate a real signal reported by a node. */
  liveSignal(from: string, to: string, accepted = true) {
    const a = this.animals.find((x) => x.sprite === from);
    const b = this.animals.find((x) => x.sprite === to);
    if (a && b) this.signals.push({ from: a, to: b, part: -1, accepted, t: 0 });
  }

  /** Movement and signal flight without any simulated decisions. */
  private animate(dt: number) {
    const move = 0.45 * dt;
    for (const a of this.animals) {
      if (a.awake && a.moving) {
        const dx = a.tx - a.ox;
        const dy = a.ty - a.oy;
        const d = Math.hypot(dx, dy);
        if (d <= move) {
          a.ox = a.tx;
          a.oy = a.ty;
          a.moving = false;
          this.ripples.push({ enc: a.enc, x: a.ox, y: a.oy, age: 0, tint: SPECIES_COLOR[a.species] });
          a.queue.shift();
          if (a.queue.length) this.newTarget(a);
          else a.sleepIn = 2.5;
        } else {
          a.ox += (dx / d) * move;
          a.oy += (dy / d) * move;
        }
        a.trail.push({ x: a.ox, y: a.oy, life: 1 });
      } else if (a.awake) {
        a.sleepIn -= dt;
        if (a.sleepIn <= 0) a.awake = false;
      }
      for (const p of a.trail) p.life -= dt * 0.12;
      while (a.trail.length && a.trail[0]!.life <= 0) a.trail.shift();
    }
    for (const s of this.signals) s.t += dt * 0.6;
    this.signals = this.signals.filter((s) => s.t < 1);
  }

  private ambient(dt: number) {
    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (Math.hypot(m.x, m.y) > 0.95) {
        const ang = rand(0, Math.PI * 2);
        const d = rand(0, 0.6);
        m.x = Math.cos(ang) * d;
        m.y = Math.sin(ang) * d;
      }
    }
    for (const e of ENCLOSURES) {
      if (e.ambience === "ripples" && Math.random() < dt * 0.6) {
        this.ripples.push({ enc: e.id, x: rand(-0.6, 0.6), y: rand(-0.6, 0.6), age: 0, tint: `rgb(${e.tint})` });
      }
    }
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < 2.6);
  }

  step(dt: number) {
    this.ambient(dt);
    if (this.paused) return;
    if (this.live) {
      this.animate(dt);
      return;
    }
    if (this.status !== "building") {
      this.resetIn -= dt;
      if (this.resetIn <= 0) this.reset();
      return;
    }

    this.minute += dt * SIM_MIN_PER_SEC * this.speed;
    const move = 0.45 * dt * Math.min(this.speed, 3);

    for (const a of this.animals) {
      if (this.minute >= a.nextWake) {
        if (a.species === "sentinel") {
          this.wake(a, { type: "scan" });
          a.nextWake = this.minute + rand(18, 36);
        } else if (a.species === "archivist") {
          this.wake(a, { type: "archive" });
          a.nextWake = this.minute + 45;
        } else {
          this.wake(a, { type: "patrol" });
          a.nextWake = this.minute + rand(90, 160);
        }
      }

      if (a.awake && a.moving) {
        const dx = a.tx - a.ox;
        const dy = a.ty - a.oy;
        const d = Math.hypot(dx, dy);
        if (d <= move) {
          a.ox = a.tx;
          a.oy = a.ty;
          a.moving = false;
          this.ripples.push({ enc: a.enc, x: a.ox, y: a.oy, age: 0, tint: SPECIES_COLOR[a.species] });
          this.perform(a, a.queue.shift()!);
          if (a.queue.length) this.newTarget(a);
          else a.sleepIn = 0.8;
        } else {
          a.ox += (dx / d) * move;
          a.oy += (dy / d) * move;
        }
        a.trail.push({ x: a.ox, y: a.oy, life: 1 });
      } else if (a.awake) {
        a.sleepIn -= dt;
        if (a.sleepIn <= 0) a.awake = false;
      }

      for (const p of a.trail) p.life -= dt * 0.12;
      while (a.trail.length && a.trail[0].life <= 0) a.trail.shift();
    }

    const arrived: Signal[] = [];
    for (const s of this.signals) {
      s.t += dt * 0.6 * Math.min(this.speed, 3);
      if (s.t >= 1) arrived.push(s);
    }
    this.signals = this.signals.filter((s) => s.t < 1);
    arrived.forEach((s) => this.deliver(s));

    if (this.minute >= NIGHT_LENGTH) {
      this.minute = NIGHT_LENGTH;
      const complete = this.done.size === PARTS.length;
      this.status = complete ? "published" : "partial";
      this.log(this.of("archivist")[0], complete
        ? "Morning Brief published. No human in the loop."
        : `brief published, ${this.done.size}/${PARTS.length} sections`);
      this.resetIn = 6;
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    ctx.clearRect(0, 0, w, h);
    const unit = Math.min(w, h);
    const geo = (e: Enclosure) => ({ x: e.cx * w, y: e.cy * h, r: e.r * unit });
    const pos = (a: Animal) => {
      const e = encById[a.enc];
      const g = geo(e);
      return { x: g.x + a.ox * g.r, y: g.y + a.oy * g.r * e.squash };
    };
    const curve = (p1: { x: number; y: number }, p2: { x: number; y: number }) => ({
      cx: (p1.x + p2.x) / 2 - (p2.y - p1.y) * 0.25,
      cy: (p1.y + p2.y) / 2 + (p2.x - p1.x) * 0.25,
    });
    const bez = (p1: { x: number; y: number }, c: { cx: number; cy: number }, p2: { x: number; y: number }, k: number) => {
      const u = 1 - k;
      return { x: u * u * p1.x + 2 * u * k * c.cx + k * k * p2.x, y: u * u * p1.y + 2 * u * k * c.cy + k * k * p2.y };
    };
    const glow = (x: number, y: number, r: number, color: string, alpha: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, "transparent");
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const blob = (e: Enclosure, g: { x: number; y: number; r: number }) => {
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const ang = (i / 64) * Math.PI * 2;
        const wob = 1 + 0.07 * Math.sin(ang * 3 + e.seed) + 0.04 * Math.sin(ang * 5 + e.seed * 2 + t / 3000);
        const x = g.x + Math.cos(ang) * g.r * wob;
        const y = g.y + Math.sin(ang) * g.r * wob;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
    };

    // drifting night fog
    glow(w * (0.3 + 0.08 * Math.sin(t / 9000)), h * 0.55, unit * 0.6, "rgba(255,255,255,0.05)", 1);
    glow(w * (0.75 + 0.06 * Math.cos(t / 11000)), h * 0.25, unit * 0.45, "rgba(255,255,255,0.04)", 1);

    // federation links with flowing dashes
    ctx.setLineDash([2, 7]);
    ctx.lineDashOffset = -t / 120;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < ENCLOSURES.length; i++) {
      for (let j = i + 1; j < ENCLOSURES.length; j++) {
        const a = geo(ENCLOSURES[i]);
        const b = geo(ENCLOSURES[j]);
        const c = curve(a, b);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(c.cx, c.cy, b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // enclosures: generated terrain if present, vector blob otherwise
    for (const e of ENCLOSURES) {
      const g = geo(e);
      const terrain = art(`/zones/${e.id}.webp`);
      if (terrain) {
        const size = g.r * 2.1 * (1 + 0.012 * Math.sin(t / 4000 + e.seed));
        ctx.save();
        ctx.globalAlpha = e.brightness;
        ctx.translate(g.x, g.y);
        ctx.rotate(0.02 * Math.sin(t / 15000 + e.seed));
        ctx.drawImage(terrain, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        blob(e, g);
        const fill = ctx.createRadialGradient(g.x, g.y - g.r * 0.3, 0, g.x, g.y, g.r * 1.1);
        fill.addColorStop(0, `rgba(${e.tint},0.07)`);
        fill.addColorStop(1, "rgba(255,255,255,0.01)");
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.stroke();
      }
    }

    // ripples: marsh water and footsteps
    for (const r of this.ripples) {
      const re = encById[r.enc];
      const g = geo(re);
      const k = r.age / 2.6;
      ctx.strokeStyle = r.tint;
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(g.x + r.x * g.r, g.y + r.y * g.r * re.squash, 4 + k * g.r * 0.18, (4 + k * g.r * 0.18) * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ambient motes: fireflies, marsh lights, canyon dust
    for (const m of this.motes) {
      const e = encById[m.enc];
      const g = geo(e);
      const x = g.x + m.x * g.r;
      const y = g.y + m.y * g.r * e.squash;
      const edge = 1 - Math.min(1, Math.hypot(m.x, m.y) / 0.95);
      if (e.ambience === "dust") {
        ctx.globalAlpha = 0.25 * edge;
        ctx.fillStyle = `rgb(${e.tint})`;
        ctx.fillRect(x, y, m.size * 0.8, m.size * 0.8);
      } else {
        const flicker = Math.max(0, Math.sin(t / (e.ambience === "fireflies" ? 700 : 1300) + m.phase));
        glow(x, y, m.size * 7, `rgb(${e.tint})`, 0.35 * flicker * edge);
        ctx.globalAlpha = flicker * edge;
        ctx.fillStyle = `rgb(${e.tint})`;
        ctx.beginPath();
        ctx.arc(x, y, m.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // labels
    for (const e of ENCLOSURES) {
      const g = geo(e);
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = `500 ${Math.max(15, g.r * 0.12)}px Geist, sans-serif`;
      ctx.fillText(e.name, g.x, g.y - g.r - 18);
      ctx.fillStyle = "rgba(255,255,255,0.42)";
      ctx.font = "400 10.5px 'Geist Mono', monospace";
      ctx.fillText(e.node, g.x, g.y - g.r - 3);
    }

    // trails
    for (const a of this.animals) {
      const e = encById[a.enc];
      const g = geo(e);
      ctx.fillStyle = SPECIES_COLOR[a.species];
      for (let i = 0; i < a.trail.length; i += 3) {
        const p = a.trail[i];
        ctx.globalAlpha = Math.max(0, p.life) * 0.5;
        ctx.beginPath();
        ctx.arc(g.x + p.x * g.r, g.y + p.y * g.r * e.squash, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // signals
    for (const s of this.signals) {
      const p1 = pos(s.from);
      const p2 = pos(s.to);
      const c = curve(p1, p2);
      const head = bez(p1, c, p2, s.t);
      const col = SPECIES_COLOR[s.from.species];
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const from = Math.max(0, s.t - 0.25);
      for (let k = 0; k <= 20; k++) {
        const q = bez(p1, c, p2, from + (s.t - from) * (k / 20));
        if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
      glow(head.x, head.y, 16, col, 1);
    }

    // agents
    const base = Math.min(52, Math.max(30, unit * 0.065));
    for (const a of this.animals) {
      const p = pos(a);
      const col = SPECIES_COLOR[a.species];
      const sprite = art(`/agents/${a.sprite}.webp`);
      const bob = Math.sin(t / 600 + a.name.length) * (a.awake ? 2 : 1);
      const size = base * (a.awake ? 1.15 : 0.9);

      if (a.awake) {
        glow(p.x, p.y + bob, size * 1.1, col, 0.3);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y + bob, size * 0.58 + Math.sin(t / 220) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (sprite) {
        ctx.save();
        ctx.globalAlpha = a.awake ? 1 : 0.6;
        ctx.drawImage(sprite, p.x - size / 2, p.y - size / 2 + bob, size, size);
        ctx.restore();
      } else {
        ctx.globalAlpha = a.awake ? 1 : 0.5;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y + bob, a.awake ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = a.awake ? 1 : 0.7;
      ctx.fillStyle = a.awake ? "#fff" : col;
      ctx.textAlign = "center";
      ctx.font = "400 10px Geist, sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.95)";
      ctx.shadowBlur = 6;
      ctx.fillText(a.name.toUpperCase(), p.x, p.y + bob + (sprite ? size / 2 + 12 : 16));
      ctx.shadowBlur = 0;
      if (!a.awake) {
        const zt = (t / 1600 + a.name.length) % 1;
        ctx.globalAlpha = 0.5 * (1 - zt);
        ctx.font = "italic 400 12px Garamond, serif";
        ctx.fillText("z", p.x + size * 0.4 + zt * 6, p.y - size * 0.35 - zt * 10);
      }
      ctx.globalAlpha = 1;
    }
  }
}
