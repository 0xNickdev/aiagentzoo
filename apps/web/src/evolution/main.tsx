import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import EvolutionApp from "./EvolutionApp";
import "../index.css";
import "./evolution.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EvolutionApp />
    <Analytics />
  </StrictMode>,
);
