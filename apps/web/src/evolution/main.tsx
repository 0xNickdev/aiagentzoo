import { LangRoot } from "../i18n";
import { StrictMode } from "react";
import { MotionConfig } from "framer-motion";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import EvolutionApp from "./EvolutionApp";
import "../index.css";
import "./evolution.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <LangRoot>{(l) => <EvolutionApp key={l} />}</LangRoot>
    </MotionConfig>
    <Analytics />
  </StrictMode>,
);
