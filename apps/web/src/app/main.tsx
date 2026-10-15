import { LangRoot } from "../i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import MiniApp from "./MiniApp";
import { boot } from "./tg";
import "../index.css";
import "./app.css";

boot();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangRoot>{(l) => <MiniApp key={l} />}</LangRoot>
    <Analytics />
  </StrictMode>,
);
