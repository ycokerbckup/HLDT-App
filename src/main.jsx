import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Combined with skipWaiting/clients.claim in the service worker: the
// moment a new deploy's worker takes over, reload once to actually
// pick up the new JS/HTML — otherwise the tab would keep running the
// old code even though a newer version is technically active.
if ("serviceWorker" in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
