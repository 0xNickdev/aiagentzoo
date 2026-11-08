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
  // Letters fade one by one, but lines still break between words: each word keeps its letters together.
  let i = 0;
  const words = text.split(" ");

  return (
    <span ref={ref} className="block">
      {words.map((word, w) => (
        <span key={`${word}-${w}`}>
          <span className="inline-block whitespace-nowrap">
            {word.split("").map((char) => {
              const n = i++;
              return (
                <motion.span key={n} variants={variants} initial="hidden" animate={isInView ? "show" : "hidden"} custom={n}>
                  {char}
                </motion.span>
              );
            })}
          </span>
          {w < words.length - 1 && (i++, " ")}
        </span>
      ))}
    </span>
  );
}
