import { useEffect, useRef, useState } from "react";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260819_212700_3bb9329b-5c50-4257-a09b-ca85cf3654a3.mp4";

const ENTRANCE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Closing full-viewport scene. Entrance plays when it scrolls into view. */
export default function Keeper() {
  const ref = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          timer = setTimeout(() => setMounted(true), 300);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  const rise = (delay: number) => ({
    transitionTimingFunction: ENTRANCE,
    transitionDelay: mounted ? `${delay}ms` : "0ms",
  });
  const riseClass = `transition-all duration-[900ms] ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`;

  return (
    <section ref={ref} id="keeper" className="relative flex h-screen w-full items-end justify-center overflow-hidden">
      <div
        className={`absolute inset-0 transition-all duration-[1400ms] ${mounted ? "scale-100 opacity-100" : "scale-105 opacity-0"}`}
        style={{
          transitionTimingFunction: ENTRANCE,
          // The video fades in from the top, so the section above shows through instead of meeting a hard edge.
          maskImage: "linear-gradient(to bottom, transparent 0%, #000 30%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 30%)",
        }}
      >
        <video className="h-full w-full object-cover" src={VIDEO_URL} autoPlay muted loop playsInline />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-6 pb-16 text-center md:pb-24">
        <h2
          className={`font-instrument mb-5 text-[2.5rem] leading-[0.95] text-white sm:text-5xl md:mb-6 md:text-6xl lg:text-7xl ${riseClass}`}
          style={rise(400)}
        >
          Every visitor can<br className="hidden sm:block" /> become a keeper
        </h2>
        <p className={`mx-auto mb-8 max-w-md text-base text-white/70 md:mb-10 md:text-lg ${riseClass}`} style={rise(600)}>
          Give your animal an enclosure on the network.
        </p>
        <a
          href="https://github.com/0xNickdev/aiagentzoo"
          className={`inline-block rounded-full bg-white px-8 py-3.5 text-sm font-medium text-black hover:bg-white/90 md:text-base ${riseClass}`}
          style={rise(800)}
        >
          Start your enclosure
        </a>
      </div>
    </section>
  );
}
