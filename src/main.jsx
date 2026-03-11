import React from "react";
import ReactDOM from "react-dom/client";
import FinanceX from "../FinanceX.jsx";
import "./firebase.js";

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
