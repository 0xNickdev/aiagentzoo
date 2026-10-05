import Hero from "./components/Hero";
import NightWatch from "./components/NightWatch";
import Species from "./components/Species";
import { Cycle, Finale, Footer, Roadmap, Token } from "./components/Story";

export default function App() {
  return (
    <>
      <Hero />
      <Species />
      <NightWatch />
      <Cycle />
      <Token />
      <Roadmap />
      <Finale />
      <Footer />
    </>
  );
}
