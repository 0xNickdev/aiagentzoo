import { useEffect, useRef } from "react";
import { useMotionValue, useSpring } from "framer-motion";

/**
 * A number that rolls to its new value when it changes (after Magic UI's Number Ticker on 21st.dev). It starts at the
 * value it is first given, so a row that appears does not count up from zero; only later changes animate.
 */
export default function NumberTicker({ value, format, className = "" }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const motion = useMotionValue(value);
  const spring = useSpring(motion, { damping: 60, stiffness: 100 });
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    motion.set(value);
  }, [motion, value]);

  useEffect(() => {
    if (ref.current) ref.current.textContent = fmt.current(spring.get());
    return spring.on("change", (latest) => {
      if (ref.current) ref.current.textContent = fmt.current(latest);
    });
  }, [spring]);

  return <span ref={ref} className={`inline-block tabular-nums ${className}`} />;
}
