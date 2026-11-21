import { useEffect, useId, useRef, useState } from "react";
import { pick, t } from "../../i18n";
import { Corners } from "./Timeline";
import { shippedByWeek, TRIAL } from "./data";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True once the element has been on screen. */
function useSeen<T extends Element>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

/** The two eyes, as a small mark inside a diagram. */
function Eyes({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <svg x={x} y={y} width={w} height={w * 0.52} viewBox="32 140 448 232" aria-hidden="true">
      <circle cx="148" cy="256" r="88" fill="none" stroke="#fff" strokeWidth="46" />
      <circle cx="148" cy="256" r="30" fill="#fff" />
      <circle cx="364" cy="256" r="88" fill="none" stroke="#fff" strokeWidth="46" />
      <circle cx="364" cy="256" r="30" fill="#fff" />
    </svg>
  );
}

const day = 86_400_000;
const dayOf = (now: number) => Math.floor((now - TRIAL.from) / day) + 1;

/* ---------- the wide card: live launches into a frozen model, out to the sheet that is graded on day seven ---------- */

function TrialCard() {
  const still = reduced();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const d = Math.max(1, dayOf(now));
  const over = d > TRIAL.days;
  const launches = [
    { x: 54, y: 40 },
    { x: 104, y: 22 },
    { x: 152, y: 42 },
    { x: 44, y: 98 },
    { x: 148, y: 118 },
  ];
  const L1 = "M117,67 C196,67 210,100 262,100";
  const L2 = "M117,73 C186,73 206,120 262,120";
  const R1 = "M378,100 C412,100 418,86 450,86";
  const R2 = "M378,120 C412,120 418,134 450,134";
  const [side, setSide] = useState<"" | "left" | "right">("");
  return (
    <div className="rm-frame rm-wide">
      <Corners />
      <div className="rm-card overflow-hidden !p-0">
        <svg className="block h-auto w-full" viewBox="0 0 640 178" role="img" aria-label={t("Live launches pass through the frozen model into a sheet that is graded on day seven")}>
          <defs>
            <radialGradient id="trial-glow" cx="320" cy="110" r="200" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#18201c" />
              <stop offset="1" stopColor="#0e1311" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="trial-rays" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#333b37" stopOpacity="0.5" />
              <stop offset="1" stopColor="#333b37" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width="640" height="178" fill="url(#trial-glow)" />
          {[-62, -38, -14, 14, 38, 62].map((a) => {
            const p = (deg: number) => `${320 + Math.sin((deg * Math.PI) / 180) * 260},${110 - Math.cos((deg * Math.PI) / 180) * 260}`;
            return <path key={a} d={`M320,110 L${p(a)} L${p(a + 7)}Z`} fill="url(#trial-rays)" opacity="0.5" />;
          })}

          {/* live launches */}
          <g onPointerEnter={() => setSide("left")} onPointerLeave={() => setSide("")}>
            <rect x="20" y="6" width="170" height="134" fill="transparent" />
            {launches.map((m, i) => (
              <line key={i} x1={m.x} y1={m.y} x2="104" y2="70" stroke="#333b37" strokeDasharray="2 3" />
            ))}
            <rect x="91" y="57" width="26" height="26" rx="5" className="rm-node" />
            <Eyes x={95} y={65.5} w={18} />
            {launches.map((m, i) => (
              <g key={i}>
                <circle cx={m.x} cy={m.y} r="10" fill="#0e1311" stroke="#4a524e" />
                <circle cx={m.x} cy={m.y} r="3" fill="#fff" className={still ? undefined : "rm-pulse"} style={{ animationDelay: `${i * 0.4}s` }} />
              </g>
            ))}
            <text x="104" y="152" textAnchor="middle" className="rm-cap">
              {pick("LIVE LAUNCHES", "实时发射")}
            </text>
          </g>

          {[L1, L2].map((p, i) => (
            <path key={p} d={p} className={`rm-flow ${side === "left" ? "rm-flow-on" : ""} ${i ? "rm-dash" : ""}`} />
          ))}
          {[R1, R2].map((p, i) => (
            <path key={p} d={p} className={`rm-flow ${side === "right" ? "rm-flow-on" : ""} ${i ? "rm-dash" : ""}`} />
          ))}
          {!still &&
            !over &&
            [L1, L2, R1, R2].map((p, i) => (
              <circle key={i} r="2.2" fill="#fff">
                <animateMotion dur={`${2.2 + (i % 2) * 0.6}s`} begin={`${i * 0.35}s`} repeatCount="indefinite" path={p} />
              </circle>
            ))}

          {/* the model, frozen */}
          <g transform="translate(262,88)">
            <rect x="-4" y="-4" width="124" height="52" rx="8" fill="none" stroke="#232c27" className={still ? undefined : "rm-pulse"} />
            <rect width="116" height="44" rx="6" className="rm-node" />
            <Eyes x={11} y={16} w={22} />
            <text x="40" y="20" className="rm-cap" fill="#fff" style={{ fill: "#fff" }}>
              {pick("MODEL", "模型")}
            </text>
            <text x="40" y="32" className="rm-cap">
              {pick("FROZEN 21 NOV", "11 月 21 日冻结")}
            </text>
          </g>

          {/* the sheet: one box a day, filled as the days pass */}
          <g onPointerEnter={() => setSide("right")} onPointerLeave={() => setSide("")}>
            {[2, 1, 0].map((k) => (
              <g key={k} transform={`translate(${450 + k * 12},${40 - k * 10})`} opacity={1 - k * 0.3}>
                <rect width="138" height="102" rx="3" fill="#0e1311" stroke="#333b37" />
                {k === 0 && (
                  <>
                    <text x="10" y="17" className="rm-cap">
                      {over ? pick("GRADING", "评分中") : pick(`DAY ${d} OF ${TRIAL.days}`, `第 ${d} 天 / 共 ${TRIAL.days} 天`)}
                    </text>
                    <rect x="10" y="25" width="64" height="5" rx="1" fill="#fff" opacity="0.8" />
                    <rect x="10" y="34" width="96" height="3" rx="1" fill="#333b37" />
                    {Array.from({ length: TRIAL.days }, (_, j) => {
                      const done = j + 1 < d;
                      const today = j + 1 === d && !over;
                      return <rect key={j} x={10 + j * 17} y="52" width="13" height="13" rx="2" fill={done || over ? "#fff" : "none"} stroke={today ? "#fff" : done || over ? "#fff" : "#4a524e"} className={today && !still ? "rm-pulse" : undefined} />;
                    })}
                    <text x="10" y="84" className="rm-cap">
                      {pick("GRADED 28 NOV", "11 月 28 日评分")}
                    </text>
                    <path d="M10 91h118" stroke="#333b37" strokeWidth="2.5" />
                  </>
                )}
              </g>
            ))}
          </g>
        </svg>
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 sm:gap-8">
          <div>
            <h3>{t("Runner radar, a silent trial")}</h3>
            <p>{t("For months we said which coins to stay away from. Now the same chain data is asked the other question: what does a runner look like in its first five minutes, before the chart shows it.")}</p>
          </div>
          <div>
            <h3>{t("Graded before it ships")}</h3>
            <p>{t("It was run back on 79,000 launches. Since 21 November it reads live coins it has never seen, with the model frozen. If the numbers hold, it ships. If they do not, it does not.")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Pro: what stays free and what it opens, as two plain lists ---------- */

const FREE: Array<{ en: string; zh: string }> = [
  { en: "The verdict and its main reasons", zh: "结论和主要理由" },
  { en: "The odds from the first five minutes", zh: "前五分钟算出的赔率" },
  { en: "The dev's record", zh: "开发者的记录" },
];
const PRO: Array<{ en: string; zh: string }> = [
  { en: "The funding trace", zh: "资金追踪" },
  { en: "One hand in many wallets", zh: "多钱包同一只手" },
  { en: "Where the SOL went", zh: "SOL 的去向" },
  { en: "Alerts", zh: "提醒" },
];

function ProCard() {
  const list = (head: string, tag: string, rows: typeof FREE, lit: boolean) => (
    <div className="min-w-0">
      <p className="flex items-center justify-between border-b border-line pb-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em]">
        <span className="text-white">{t(head)}</span>
        <span className={lit ? "rounded-[3px] bg-white px-1.5 leading-[16px] text-night" : "text-faint"}>{t(tag)}</span>
      </p>
      <ul>
        {rows.map((r) => (
          <li key={r.en} className="flex items-center gap-2.5 border-b border-line py-2.5 text-[13px] text-fg-2">
            <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${lit ? "bg-white" : "border border-[#7d8681]"}`} />
            {pick(r.en, r.zh)}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="rm-frame">
      <Corners />
      <div className="rm-card">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {list("Free", "Stays free", FREE, true)}
          {list("Pro", "Soon", PRO, false)}
        </div>
        <div className="mt-auto pt-2">
          <h3>{t("Pro, the deep x-ray")}</h3>
          <p>{t("The verdict and its main reasons stay free for everyone. Pro opens everything behind them. No price here until it is live.")}</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- what shipped, week by week: our own ledger as a line you can scrub ---------- */

function ShippedCard() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [ref, seen] = useSeen<HTMLDivElement>(0.3);
  const [hover, setHover] = useState(-1);
  const weeks = shippedByWeek();
  const W = 300;
  const H = 130;
  const pad = 14;
  const hi = weeks[weeks.length - 1]!.total || 1;
  const pts = weeks.map((w, i) => [pad + (i / (weeks.length - 1)) * (W - pad * 2), H - pad - (w.total / hi) * (H - pad * 2)] as const);
  let line = "";
  pts.forEach(([x, y], i) => {
    if (i === 0) return void (line = `M${x.toFixed(1)},${y.toFixed(1)}`);
    const [px, py] = pts[i - 1]!;
    const cx = ((px + x) / 2).toFixed(1);
    line += ` C${cx},${py.toFixed(1)} ${cx},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)},${H - pad} L${pts[0]![0].toFixed(1)},${H - pad} Z`;
  // The week the cut landed in.
  const cut = weeks.findIndex((w, i) => w.week <= "2026-11-20" && (weeks[i + 1]?.week ?? "9999") > "2026-11-20");
  const i = hover >= 0 ? hover : pts.length - 1;
  const p = pts[i]!;
  const w = weeks[i]!;
  const label = new Date(w.week).toLocaleDateString(pick("en-GB", "zh-CN"), { day: "numeric", month: "short", timeZone: "UTC" });
  const tip = pick(`wk of ${label} · ${w.total}`, `${label} 当周 · ${w.total}`);
  return (
    <div className="rm-frame" ref={ref} data-in={seen}>
      <Corners />
      <div className="rm-card">
        <svg
          className="block h-auto w-full cursor-crosshair overflow-visible"
          viewBox={`0 0 ${W} ${H + 6}`}
          role="img"
          aria-label={t("Builds shipped, running total by week")}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            let best = 0;
            pts.forEach((q, k) => {
              if (Math.abs(q[0] - x) < Math.abs(pts[best]![0] - x)) best = k;
            });
            setHover(best);
          }}
          onPointerLeave={() => setHover(-1)}
        >
          <defs>
            <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.3, 0.52, 0.74].map((g) => (
            <line key={g} x1={pad} x2={W - pad} y1={H * g} y2={H * g} stroke="#18201c" />
          ))}
          <path d={area} fill={`url(#${uid}-area)`} />
          <path d={line} fill="none" stroke="#fff" strokeWidth="1.4" pathLength={1} className="rm-draw" />
          {cut > 0 && (
            <>
              <line x1={pts[cut]![0]} x2={pts[cut]![0]} y1="10" y2={H - pad} stroke="#4a524e" strokeDasharray="2 3" />
              <text x={pts[cut]![0] - 4} y={H - 18} textAnchor="end" className="rm-cap">
                {pick("THE CUT", "大删减")}
              </text>
            </>
          )}
          {hover >= 0 && <line x1={p[0]} x2={p[0]} y1="8" y2={H - pad} stroke="#fff" strokeOpacity="0.35" />}
          <circle cx={p[0]} cy={p[1]} r="3.2" fill="#0e1311" stroke="#fff" strokeWidth="1.5" />
<g transform={`translate(${pad},4)`}>
            <rect width="96" height="15" rx="2" fill="#fff" />
            <text x="48" y="10.5" textAnchor="middle" fontSize="7.5" fill="#030504" className="font-mono">
              {tip}
            </text>
          </g>
        </svg>
        <div className="mt-auto">
          <h3>{t("Shipped, week by week")}</h3>
          <p>{t("The running count of builds on this page, each one a commit you can open. Move across the line to read a week.")}</p>
        </div>
      </div>
    </div>
  );
}

export default function Now() {
  return (
    <div className="rm-bento">
      <TrialCard />
      <ProCard />
      <ShippedCard />
    </div>
  );
}
