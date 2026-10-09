import Hero from "./components/Hero";
import LiveStats from "./components/LiveStats";
import NightWatch from "./components/NightWatch";
import Species from "./components/Species";
import { Strip } from "./components/backdrop";
import { ChainTicker, NetworkPulse } from "./components/Pulse";
import Brief from "./components/Brief";
import Developers from "./components/Developers";
import Guests from "./components/Guests";
import Keeper from "./components/Keeper";
import Passport from "./components/Passport";
import { closePassport, usePassport } from "./passportStore";
import { Cycle, Footer, Token } from "./components/Story";
import Roadmap from "./components/roadmap/Roadmap";

export default function App() {
  const passport = usePassport();
  return (
    <>
      <Hero />
      <LiveStats />
      <Species />
      <Strip src="/backdrops/strip-nightfall.webp" tint="90,130,150">
        <p className="font-display max-w-3xl text-3xl leading-tight text-white/90 sm:text-5xl">
          Nightfall. <span className="accent">The enclosures wake.</span>
        </p>
        <p className="mt-4 max-w-xl text-sm font-light text-white/65">
          Every node runs its own agents on its own schedule. They talk only through signed signals.
        </p>
        <NetworkPulse />
      </Strip>
      <NightWatch />
      <Brief />
      <Developers />
      <Guests />
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
      <Token />
      <Roadmap />
      <Keeper />
      <Footer />
      <Passport agent={passport} onClose={closePassport} />
    </>
  );
}
