import { StrictMode } from "react";
import { MotionConfig } from "framer-motion";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App";
import { LangRoot } from "./i18n";
import { interceptLinks } from "./router";
import "./index.css";

interceptLinks();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <LangRoot>{(l) => <App key={l} />}</LangRoot>
    </MotionConfig>
    <Analytics />
  </StrictMode>,
);
