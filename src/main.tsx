import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installHyChrome } from "@/lib/hyChrome";

// Inyecta las imágenes nine-patch nativas de Hytale como variables CSS (resueltas vía uiAsset:
// voxelfold-asset:// en Tauri, /hytale/ en dev) → UI nativa idéntica en app real y verificación.
installHyChrome();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
