import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DiffDuckApp } from "./diffduck-app.js";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("DiffDuck could not find its root element.");
}

createRoot(root).render(
  <StrictMode>
    <DiffDuckApp />
  </StrictMode>,
);
