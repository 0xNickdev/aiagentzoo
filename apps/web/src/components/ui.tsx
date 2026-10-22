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
      transition={{ duration: 0.9, delay, ease: [0.215, 0.61, 0.355, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string[]; text?: string }) {
  return (
    <div className="mx-auto mb-12 max-w-3xl text-center sm:mb-16">
      <Reveal>
        <p className="mb-4 text-[15px] text-white/70">{eyebrow}</p>
      </Reveal>
      <h2 className="font-display text-[40px] font-semibold leading-[1.02] text-white sm:text-[56px] md:text-[64px]">
        {title.map((line) => (
          <StaggeredFade key={line} text={line} />
        ))}
      </h2>
      {text && (
        <Reveal delay={0.4}>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-white/75">{text}</p>
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
