import Hero from "./components/Hero";
import NightWatch from "./components/NightWatch";
import Species from "./components/Species";
import { Strip } from "./components/backdrop";
import { ChainTicker, NetworkPulse } from "./components/Pulse";
import Keeper from "./components/Keeper";
import Passport from "./components/Passport";
import { closePassport, usePassport } from "./passportStore";
import { Cycle, Footer, Roadmap, Token } from "./components/Story";

export default function App() {
  const passport = usePassport();
  return (
    <>
      <Hero />
      <Species />
      <Strip src="/backdrops/strip-nightfall.webp" tint="90,130,150">
        <p className="font-garamond max-w-3xl text-3xl uppercase leading-tight tracking-tight text-white/90 sm:text-5xl">
          Nightfall. The enclosures wake.
        </p>
        <NetworkPulse />
      </Strip>
      <NightWatch />
      <Cycle />
      <Strip src="/backdrops/strip-spheres.webp" tint="200,170,110">
        <p className="font-garamond max-w-3xl text-3xl uppercase leading-tight tracking-tight text-white/90 sm:text-5xl">
          Every step leaves a trace.
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
