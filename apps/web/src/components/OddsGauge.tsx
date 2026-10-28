import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * A half-ring gauge for one probability, after 21st.dev's Animated Radial Chart (isaiahbjork), redrawn in the zoo's
 * palette: one solid colour on a dark track, no gradient text. An optional tick marks a reference, such as the
 * average launch, so the arc reads against something.
 */
export default function OddsGauge({ value, color, mark, markLabel, size = 220, duration = 1.4 }: { value: number; color: string; mark?: number; markLabel?: string; size?: number; duration?: number }) {
  const stroke = Math.max(10, size * 0.07);
  const radius = size * 0.4;
  const cx = size / 2;
  const cy = radius + stroke;
  const h = cy + stroke * 0.5;
  const arc = Math.PI * radius;
  const path = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
  const v = useMotionValue(0);
  const offset = useTransform(v, [0, 1], [arc, 0]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      v.set(value);
      setShown(value);
      return;
    }
    const c = animate(v, value, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    return c.stop;
  }, [value, v, duration]);
  // The reference tick sits across the ring at its share of the half circle.
  const at = (p: number, r: number) => [cx + Math.cos(Math.PI * (1 - p)) * r, cy - Math.sin(Math.PI * (1 - p)) * r] as const;
  const label = shown >= 0.1 ? `${Math.round(shown * 100)}%` : shown >= 0.01 ? `${(shown * 100).toFixed(1)}%` : value > 0 ? "<1%" : "0%";
  return (
    <div className="relative mx-auto" style={{ width: size, height: h }}>
      <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} className="overflow-visible" aria-hidden="true">
        <path d={path} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <motion.path d={path} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={arc} style={{ strokeDashoffset: offset, filter: `drop-shadow(0 0 10px ${color}55)` }} />
        {mark !== undefined && (
          <>
            <line x1={at(mark, radius - stroke / 2 - 3)[0]} y1={at(mark, radius - stroke / 2 - 3)[1]} x2={at(mark, radius + stroke / 2 + 3)[0]} y2={at(mark, radius + stroke / 2 + 3)[1]} stroke="#d9dddb" strokeWidth={1.5} />
            {markLabel && (
              <text x={at(mark, radius + stroke / 2 + 10)[0]} y={at(mark, radius + stroke / 2 + 10)[1]} fill="#a3aaa6" fontSize={11} fontFamily="Geist, sans-serif" textAnchor="end">
                {markLabel}
              </text>
            )}
          </>
        )}
      </svg>
      <div className="tabular-nums absolute inset-x-0 bottom-0 text-center font-semibold leading-none tracking-[-0.03em]" style={{ color, fontSize: size * 0.19 }}>
        {label}
      </div>
    </div>
  );
}
