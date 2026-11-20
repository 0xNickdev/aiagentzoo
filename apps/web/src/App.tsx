import { lazy, Suspense, useEffect } from "react";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/site/SiteFooter";
import Home from "./pages/Home";
import { type Route, TITLES, useRoute } from "./router";
import { t } from "./i18n";

const XRay = lazy(() => import("./components/XRay"));
const Feed = lazy(() => import("./components/Feed"));
const Contests = lazy(() => import("./pages/Contests"));
const Connect = lazy(() => import("./components/Connect"));
const Stats = lazy(() => import("./components/Stats"));
const X402 = lazy(() => import("./components/X402"));
const Callers = lazy(() => import("./components/Callers"));
const Volume = lazy(() => import("./components/Volume"));

const PAGES: Record<Route, React.ComponentType> = {
  "/": Home,
  "/xray": XRay,
  "/feed": Feed,
  "/contests": Contests,
  "/play": Contests,
  "/connect": Connect,
  "/stats": Stats,
  "/x402": X402,
  "/callers": Callers,
  "/volume": Volume,
};

export default function App() {
  const route = useRoute();
  const Page = PAGES[route];
  useEffect(() => {
    document.title = t(TITLES[route]);
  }, [route]);

  return (
    <>
      <SiteNav />
      {/* At least a screen tall, so the footer never floats up the page. */}
      <main key={route} className="min-h-screen">
        {/* Every page but the home loads on demand, so the first screen carries only what it shows. */}
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
