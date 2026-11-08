import { motion } from "framer-motion";
import { type ReactNode, useState } from "react";
import { t } from "../i18n";
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
    <div className="mb-8 max-w-4xl sm:mb-14">
      <Reveal>
        <p className="mb-3 text-[15px] text-fg-4">{eyebrow}</p>
      </Reveal>
      <h2 className="font-display text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-[56px] md:text-[60px]">
        {title.map((line) => (
          <StaggeredFade key={line} text={line} />
        ))}
      </h2>
      {text && (
        <Reveal delay={0.4}>
          <Lead text={text} />
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
    <section id={id} className={`relative px-5 py-14 sm:px-8 sm:py-24 md:py-28 ${className}`}>
      {backdrop && <Backdrop {...backdrop} />}
      <div className="relative z-10 mx-auto max-w-7xl">{children}</div>
    </section>
  );
}

/** A long section text shows its first sentence; the rest opens on "how it works", so a trader reads one line, not six. */
function Lead({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const m = text.length > 150 ? /^(.+?[.!?。！？])\s*(\S.*)$/s.exec(text) : null;
  if (!m) return <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-fg-3">{text}</p>;
  return (
    <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-fg-3">
      {m[1]}
      {open ? (
        <> {m[2]}</>
      ) : (
        <>
          {" "}
          <button type="button" onClick={() => setOpen(true)} className="text-fg-4 underline decoration-white/25 underline-offset-4 hover:text-white">
            {t("how it works")}
          </button>
        </>
      )}
    </p>
  );
}
