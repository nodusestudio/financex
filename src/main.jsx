import React from "react";
import ReactDOM from "react-dom/client";
import FinanceX from "../FinanceX.jsx";
import "./firebase.js";

const CURRENT_CACHE = "financex-cache-v4";
const IS_LOCALHOST = ["localhost", "127.0.0.1"].includes(window.location.hostname);

async function limpiarTodoSW() {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return;

  const registros = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registros.map((registro) => registro.unregister()));

  const cacheKeys = await caches.keys();
  await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
}

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
  if (IS_LOCALHOST) {
    await limpiarTodoSW();
  }

  const recargando = await limpiarSWsViejos();
  if (recargando) return; // La página se va a recargar, no renderizar aún

  if (!IS_LOCALHOST && "serviceWorker" in navigator) {
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
