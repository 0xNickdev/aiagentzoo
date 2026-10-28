import { lazy, Suspense, useEffect, useState } from "react";
import Hero from "./components/Hero";
import { Holders, Products, TrustStrip } from "./components/HomeSections";
import { LiveNow, WhyAvoid } from "./components/home/HomeLive";
import SiteNav from "./components/SiteNav";
import { closePassport, usePassport } from "./passportStore";
import { Footer } from "./components/Story";
import RoadmapTeaser from "./components/roadmap/RoadmapTeaser";
import { type Route, TITLES, useRoute } from "./router";
import { t } from "./i18n";

const LivePage = lazy(() => import("./pages/LivePage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const Brief = lazy(() => import("./components/Brief"));
const AskPage = lazy(() => import("./components/Ask"));
const WallOfRugs = lazy(() => import("./components/WallOfRugs"));
const WallOfCabals = lazy(() => import("./components/WallOfCabals"));
const XRay = lazy(() => import("./components/XRay"));
const Play = lazy(() => import("./components/Play"));
const Connect = lazy(() => import("./components/Connect"));
const Stats = lazy(() => import("./components/Stats"));
const RoadmapPage = lazy(() => import("./components/roadmap/RoadmapPage"));
const Radar = lazy(() => import("./components/Radar"));
const Feed = lazy(() => import("./components/Feed"));
const Passport = lazy(() => import("./components/Passport"));

function Home() {
  return (
    <>
      <Hero />
      <TrustStrip />
      <LiveNow />
      <WhyAvoid />
      <Products />
      <Holders />
      <RoadmapTeaser />
    </>
  );
}

const PAGES: Record<Route, React.ComponentType> = {
  "/": Home,
  "/live": LivePage,
  "/brief": Brief,
  "/agents": AgentsPage,
  "/ask": AskPage,
  "/rugs": WallOfRugs,
  "/cabals": WallOfCabals,
  "/xray": XRay,
  "/play": Play,
  "/connect": Connect,
  "/stats": Stats,
  "/roadmap": RoadmapPage,
  "/radar": Radar,
  "/feed": Feed,
};

export default function App() {
  const passport = usePassport();
  // The passport loads the first time one opens and then stays mounted, so it can animate closed.
  const [passportUsed, setPassportUsed] = useState(false);
  useEffect(() => {
    if (passport) setPassportUsed(true);
  }, [passport]);
  const route = useRoute();
  const Page = PAGES[route];
  useEffect(() => {
    document.title = t(TITLES[route]);
  }, [route]);

  return (
    <>
      {route !== "/" && <SiteNav />}
      {/* At least a screen tall, so the footer never floats up the page. */}
      <main key={route} className="min-h-screen">
        {/* Every page but the home loads on demand, so the first screen carries only what it shows. */}
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </main>
      <Footer />
      {passportUsed && (
        <Suspense fallback={null}>
          <Passport agent={passport} onClose={closePassport} />
        </Suspense>
      )}
    </>
  );
}
