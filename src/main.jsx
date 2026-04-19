import React from "react";
import ReactDOM from "react-dom/client";
import FinanceX from "../FinanceX.jsx";
import "./firebase.js";

const CURRENT_CACHE = "financex-cache-v3";

async function limpiarSWsViejos() {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return false;

  // Si ya limpiamos en esta sesión, no volver a hacerlo (evita bucle de reloads)
  if (sessionStorage.getItem("sw-limpiado") === CURRENT_CACHE) return false;

  const cacheKeys = await caches.keys();
  const hayViejos = cacheKeys.some((k) => k !== CURRENT_CACHE);

  if (hayViejos) {
    sessionStorage.setItem("sw-limpiado", CURRENT_CACHE);
    // Desregistrar TODOS los service workers activos
    const registros = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registros.map((r) => r.unregister()));
    // Borrar todos los cachés viejos
    await Promise.all(cacheKeys.map((k) => caches.delete(k)));
    // Recargar una sola vez para obtener contenido fresco
    window.location.reload();
    return true;
  }

  return false;
}

async function iniciarApp() {
  const recargando = await limpiarSWsViejos();
  if (recargando) return; // La página se va a recargar, no renderizar aún

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("Service Worker error:", err);
      });
    });
  }

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <FinanceX />
    </React.StrictMode>
  );
}

iniciarApp();
