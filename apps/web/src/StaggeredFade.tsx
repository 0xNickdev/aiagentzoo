import { motion, useInView, type Variants } from "framer-motion";
import { useRef } from "react";

const variants: Variants = {
  hidden: { opacity: 0 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07 },
  }),
};

export default function StaggeredFade({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  return (
    <span ref={ref} className="block">
      {text.split("").map((char, i) => (
        <motion.span
          key={`${char}-${i}`}
          variants={variants}
          initial="hidden"
          animate={isInView ? "show" : "hidden"}
          custom={i}
        >
          {char === " " ? " " : char}
        </motion.span>
      ))}
    </span>
  );
}
