import { motion } from "framer-motion";
import type { ReactNode } from "react";
import StaggeredFade from "../StaggeredFade";
import { Backdrop, type BackdropProps } from "./backdrop";

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string[]; text?: string }) {
  return (
    <div className="mx-auto mb-12 max-w-3xl text-center sm:mb-16">
      <Reveal>
        <p className="font-mono mb-5 text-[12px] text-white/50">{eyebrow}</p>
      </Reveal>
      <h2 className="font-display text-4xl leading-[1.05] text-white sm:text-5xl md:text-6xl">
        {title.map((line) => (
          <StaggeredFade key={line} text={line} />
        ))}
      </h2>
      {text && (
        <Reveal delay={0.4}>
          <p className="mx-auto mt-6 max-w-xl text-sm font-light leading-relaxed text-white/60 sm:text-base">{text}</p>
        </Reveal>
      )}
    </div>
  );
}

export function Section({
  id,
  children,
  className = "",
  backdrop,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  backdrop?: BackdropProps;
}) {
  return (
    <section id={id} className={`relative px-5 py-20 sm:px-8 sm:py-24 md:py-28 ${className}`}>
      {backdrop && <Backdrop {...backdrop} />}
      <div className="relative z-10 mx-auto max-w-7xl">{children}</div>
    </section>
  );
}
