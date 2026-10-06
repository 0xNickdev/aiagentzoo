import Hero from "./components/Hero";
import NightWatch from "./components/NightWatch";
import Species from "./components/Species";
import { Strip } from "./components/backdrop";
import Keeper from "./components/Keeper";
import { Cycle, Footer, Roadmap, Token } from "./components/Story";

export default function App() {
  return (
    <>
      <Hero />
      <Species />
      <Strip src="/backdrops/strip-nightfall.webp" tint="90,130,150">
        <p className="font-garamond max-w-3xl text-3xl uppercase leading-tight tracking-tight text-white/90 sm:text-5xl">
          Nightfall. The enclosures wake.
        </p>
      </Strip>
      <NightWatch />
      <Cycle />
      <Strip src="/backdrops/strip-spheres.webp" tint="200,170,110">
        <p className="font-garamond max-w-3xl text-3xl uppercase leading-tight tracking-tight text-white/90 sm:text-5xl">
          Every step leaves a trace.
        </p>
      </Strip>
      <Token />
      <Roadmap />
      <Keeper />
      <Footer />
    </>
  );
}
