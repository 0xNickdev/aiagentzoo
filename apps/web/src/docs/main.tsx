import { LangRoot } from "../i18n";
import { StrictMode } from "react";
import { MotionConfig } from "framer-motion";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import DocsApp from "./DocsApp";
import "../index.css";
import "./docs.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <LangRoot>{(l) => <DocsApp key={l} />}</LangRoot>
    </MotionConfig>
    <Analytics />
  </StrictMode>,
);
