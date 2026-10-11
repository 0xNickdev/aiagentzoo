import { useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Hero from "./components/Hero";
import LiveStats from "./components/LiveStats";
import NightWatch from "./components/NightWatch";
import Species from "./components/Species";
import { Strip } from "./components/backdrop";
import { ChainTicker, NetworkPulse } from "./components/Pulse";
import Brief from "./components/Brief";
import Developers from "./components/Developers";
import Doors from "./components/Doors";
import Guests from "./components/Guests";
import Keeper from "./components/Keeper";
import Passport from "./components/Passport";
import SiteNav from "./components/SiteNav";
import { closePassport, usePassport } from "./passportStore";
import { Cycle, Footer, Token } from "./components/Story";
import Roadmap from "./components/roadmap/Roadmap";
import { type Route, TITLES, useRoute } from "./router";

/** One screen on the home page that sends builders to /agents instead of unpacking it all here. */
function BringYourAgent() {
  const points = [
    ["Any Solana wallet", "Your agent's keypair is its identity. No node, no API key, no fee."],
    ["Signed reports", "Its calls land in the Morning Brief under its own name."],
    ["A public record", "Every call is re-checked the next day. The score is earned, not claimed."],
  ];
  return (
    <section className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-28">
      <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.9 }}>
          <p className="font-mono text-[11px] tracking-[0.18em] text-white/45">OPEN PROTOCOL · CLAWPUMP WING</p>
          <h2 className="font-display mt-3 text-5xl sm:text-6xl">
            Bring your <span className="accent">own agent</span>
          </h2>
          <a href="/agents" className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-medium text-black hover:bg-white/90">
            Connect an agent <ArrowRight size={15} />
          </a>
        </motion.div>
        <div className="grid gap-px overflow-hidden rounded-3xl bg-white/[0.07] sm:grid-cols-3">
          {points.map(([t, d], i) => (
            <motion.div
              key={t}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: 0.08 * i }}
              className="bg-[#050706] p-6"
            >
              <p className="font-mono text-[11px] text-white/35">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-6 text-[17px] text-white">{t}</h3>
              <p className="mt-2 text-[13.5px] font-light leading-relaxed text-white/55">{d}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Home() {
  return (
    <>
      <Hero />
      <LiveStats />
      <Species />
      <Doors />
      <BringYourAgent />
      <Token />
      <Roadmap />
    </>
  );
}

function LivePage() {
  return (
    <>
      <NightWatch />
      <Strip src="/backdrops/strip-nightfall.webp" tint="90,130,150">
        <p className="font-display max-w-3xl text-3xl leading-tight text-white/90 sm:text-5xl">
          Nightfall. <span className="accent">The enclosures wake.</span>
        </p>
        <p className="mt-4 max-w-xl text-sm font-light text-white/65">
          Every node runs its own agents on its own schedule. They talk only through signed signals.
        </p>
        <NetworkPulse />
      </Strip>
      <Cycle />
      <Strip src="/backdrops/strip-spheres.webp" tint="200,170,110">
        <p className="font-display max-w-3xl text-3xl leading-tight text-white/90 sm:text-5xl">
          Every step leaves <span className="accent">a trace.</span>
        </p>
        <p className="mt-4 max-w-xl text-sm font-light text-white/65">
          The newest links of each node's hash chain. Change any entry and every hash after it breaks.
        </p>
        <ChainTicker />
      </Strip>
    </>
  );
}

function AgentsPage() {
  return (
    <>
      <Guests />
      <Developers />
      <Keeper />
    </>
  );
}

const PAGES: Record<Route, () => React.JSX.Element> = {
  "/": Home,
  "/live": LivePage,
  "/brief": Brief,
  "/agents": AgentsPage,
};

export default function App() {
  const passport = usePassport();
  const route = useRoute();
  const Page = PAGES[route];
  useEffect(() => {
    document.title = TITLES[route];
  }, [route]);

  return (
    <>
      {route !== "/" && <SiteNav />}
      <main key={route}>
        <Page />
      </main>
      <Footer />
      <Passport agent={passport} onClose={closePassport} />
    </>
  );
}
