import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./src/firebase.js";
import * as XLSX from "xlsx";

// ── UTILS ─────────────────────────────────────────────────────────────────────
const $ = (n) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
const formatMoneyInput = (v) => {
  if (v === "" || v === null || typeof v === "undefined") return "";
  const n = +v || 0;
  if (!n) return "";
  return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n)}`;
};
const parseMoneyInput = (raw) => {
  const clean = String(raw || "").replace(/[^\d]/g, "");
  return clean ? +clean : 0;
};
const uid = () => Math.random().toString(36).slice(2);
const todayStr = () => new Date().toISOString().split("T")[0];
const nowStr   = () => new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
const fmtDate  = (d) => new Date(d + "T12:00:00").toLocaleDateString("es-CO", { weekday:"short", day:"numeric", month:"short" });

const METODOS = [
  { key: "efectivo",    label: "Efectivo",    color: "#10b981", bg: "#052e16" },
  { key: "bancolombia", label: "Bancolombia", color: "#3b82f6", bg: "#0c1a3a" },
  { key: "nequi",       label: "Nequi",       color: "#a855f7", bg: "#1a0533" },
  { key: "bold",        label: "Bold",        color: "#f97316", bg: "#2d1200" },
  { key: "aliados",     label: "Aliados",     color: "#6b7280", bg: "#111827" },
];

const CAJAS_GASTO = ["efectivo", "bancolombia", "nequi", "bold", "aliados"];

const BILLETES = [100000, 50000, 20000, 10000, 5000, 2000, 1000];
const MONEDAS  = [500, 200, 100, 50];

// ── MINI COMPONENTS ───────────────────────────────────────────────────────────
const Ic = ({ d, s = 16, c = "currentColor" }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  plus:  "M12 5v14M5 12h14",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  close: "M18 6L6 18M6 6l12 12",
  check: "M20 6L9 17l-5-5",
  left:  "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  up:    "M12 19V5M5 12l7-7 7 7",
  down:  "M12 5v14M19 12l-7 7-7-7",
};

const Pill = ({ label, color, bg }) => (
  <span style={{ color, background: bg + "99", border: `1px solid ${color}33` }}
    className="text-xs px-2 py-0.5 rounded-full font-medium">{label}</span>
);

// Modal bottom-sheet
const Sheet = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    onClick={onClose}>
    <div className="bg-gray-900 rounded-t-2xl border-t border-gray-700 max-h-[85vh] overflow-y-auto"
      onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <span className="font-semibold text-white text-sm">{title}</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><Ic d={ICONS.close} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

const Lbl = ({ children }) => <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">{children}</label>;
const inp = "w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder-gray-600";
const btn = (color) => `w-full py-3 rounded-xl text-sm font-semibold transition-all text-white`;

// ════════════════════════════════════════════════════════════════════════════
// APP
// ════════════════════════════════════════════════════════════════════════════
export default function FinanceX() {
  const [tab, setTab] = useState("cajaDiaria");
  const [isFirestoreReady, setIsFirestoreReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Cargando nube...");
  const STORAGE_KEY = "financex_app_data_v1";
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [canInstallApp, setCanInstallApp] = useState(false);

  // Historial de días: { [fecha]: { ventas: [...], gastos: [...] } }
  const [historial, setHistorial] = useState({});

  const conteoInicial = () =>
    ({ ...Object.fromEntries([...BILLETES, ...MONEDAS].map(d => [d, 0])), extra: 0 });

  // Caja menor — independiente
  const [conteo, setConteo] = useState(conteoInicial());

  // Fecha activa en historial
  const [fechaVista, setFechaVista] = useState(todayStr());

  // Meses guardados: { "2025-03": { resumen, ventas, gastos } }
  const [mesesGuardados, setMesesGuardados] = useState({});

  // Sheets
  const [sheetVenta, setSheetVenta] = useState(false);

  // Forms
  const [fVenta, setFVenta] = useState({ concepto: "", fecha: todayStr(), ...Object.fromEntries(METODOS.map(m => [m.key, ""])) });
  const [fGasto, setFGasto] = useState({ concepto: "", monto: "", caja: "efectivo", categoria: "domicilio" });

  const TODAY = todayStr();

  // ── Datos del día actual ──────────────────────────────────────────────────
  const diaHoy = historial[TODAY] || { ventas: [], gastos: [] };

  // Totales de ventas por método
  const totVentas = useMemo(() =>
    Object.fromEntries(METODOS.map(m => [
      m.key, diaHoy.ventas.reduce((a, v) => a + (+v[m.key] || 0), 0)
    ])),
    [diaHoy]
  );
  const granTotal = useMemo(() => METODOS.reduce((a, m) => a + totVentas[m.key], 0), [totVentas]);

  // Totales de gastos por caja
  const totGastosPorCaja = useMemo(() =>
    Object.fromEntries(CAJAS_GASTO.map(c => [
      c, diaHoy.gastos.filter(g => g.caja === c).reduce((a, g) => a + (+g.monto || 0), 0)
    ])),
    [diaHoy]
  );
  const totGastos = useMemo(() => diaHoy.gastos.reduce((a, g) => a + (+g.monto || 0), 0), [diaHoy]);

  // Neto por método (ventas - gastos de esa caja)
  const neto = useMemo(() =>
    Object.fromEntries(METODOS.map(m => [
      m.key, totVentas[m.key] - (totGastosPorCaja[m.key] || 0)
    ])),
    [totVentas, totGastosPorCaja]
  );
  const netoTotal = useMemo(() => METODOS.reduce((a, m) => a + neto[m.key], 0), [neto]);
  const saldoTotalGlobal = useMemo(
    () =>
      Object.values(historial).reduce((acc, dia) => {
        const ventasDia = (dia.ventas || []).reduce((a, v) => a + (+v.total || 0), 0);
        const gastosDia = (dia.gastos || []).reduce((a, g) => a + (+g.monto || 0), 0);
        return acc + ventasDia - gastosDia;
      }, 0),
    [historial]
  );

  const reiniciarTodo = () => {
    const ok = window.confirm("Esto eliminara todos los datos (local y nube). Deseas continuar?");
    if (!ok) return;
    setHistorial({});
    setMesesGuardados({});
    setConteo(conteoInicial());
  };

  const reiniciarFecha = (fecha) => {
    if (!fecha) return;
    const ok = window.confirm(`Se eliminara toda la informacion del ${fecha}. Continuar?`);
    if (!ok) return;
    setHistorial(h => {
      const next = { ...h };
      delete next[fecha];
      return next;
    });
    setMesesGuardados(m => {
      const next = { ...m };
      delete next[fecha.slice(0, 7)];
      return next;
    });
  };

  useEffect(() => {
    let isActive = true;
    let localData = null;

    const cargarDesdeFirestore = async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        localData = raw ? JSON.parse(raw) : null;
        if (localData?.historial) setHistorial(localData.historial);
        if (localData?.mesesGuardados) setMesesGuardados(localData.mesesGuardados);
        if (localData?.conteo) setConteo({ ...conteoInicial(), ...localData.conteo });
      } catch (error) {
        console.error("Error leyendo almacenamiento local", error);
      }

      try {
        const snap = await getDoc(doc(db, "financex", "appData"));
        if (!isActive) return;

        if (snap.exists()) {
          const cloud = snap.data();
          const cloudUpdated = new Date(cloud.updatedAt || 0).getTime();
          const localUpdated = new Date(localData?.updatedAt || 0).getTime();
          const selected = cloudUpdated >= localUpdated ? cloud : localData;

          if (selected?.historial) setHistorial(selected.historial);
          if (selected?.mesesGuardados) setMesesGuardados(selected.mesesGuardados);
          if (selected?.conteo) setConteo({ ...conteoInicial(), ...selected.conteo });
        }

        setSyncStatus("Sincronizado");
      } catch (error) {
        console.error("Error cargando Firestore", error);
        if (isActive) setSyncStatus(localData ? "Guardado local" : "Error nube");
      } finally {
        if (isActive) setIsFirestoreReady(true);
      }
    };

    cargarDesdeFirestore();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isFirestoreReady) return;

    const payload = {
      historial,
      mesesGuardados,
      conteo,
      updatedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Error guardando almacenamiento local", error);
    }

    setSyncStatus("Guardando...");
    let cancelled = false;
    (async () => {
      try {
        await setDoc(doc(db, "financex", "appData"), payload, { merge: true });
        if (!cancelled) setSyncStatus("Sincronizado");
      } catch (error) {
        console.error("Error guardando Firestore", error);
        if (!cancelled) setSyncStatus("Guardado local");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [historial, mesesGuardados, conteo, isFirestoreReady, STORAGE_KEY]);

  useEffect(() => {
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event);
      setCanInstallApp(true);
    };

    const onInstalled = () => {
      setCanInstallApp(false);
      setDeferredInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const instalarApp = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    setCanInstallApp(false);
    setDeferredInstallPrompt(null);
  };

  // ── Acciones ──────────────────────────────────────────────────────────────
  const guardarVenta = () => {
    const total = METODOS.reduce((a, m) => a + (+fVenta[m.key] || 0), 0);
    if (!total) return;
    const fecha = fVenta.fecha || TODAY;
    const nueva = { id: uid(), hora: nowStr(), fecha, concepto: fVenta.concepto || "Ventas del día", ...Object.fromEntries(METODOS.map(m => [m.key, +fVenta[m.key] || 0])), total };
    setHistorial(h => {
      const dia = h[fecha] || { ventas: [], gastos: [] };
      return { ...h, [fecha]: { ...dia, ventas: [...dia.ventas, nueva] } };
    });
    setFVenta({ concepto: "", fecha: TODAY, ...Object.fromEntries(METODOS.map(m => [m.key, ""])) });
    setSheetVenta(false);
  };

  const guardarGasto = () => {
    if (!fGasto.concepto || !fGasto.monto) return;
    const nuevo = { id: uid(), hora: nowStr(), concepto: fGasto.concepto, monto: +fGasto.monto, caja: fGasto.caja, categoria: fGasto.categoria };
    setHistorial(h => ({ ...h, [TODAY]: { ...diaHoy, gastos: [...diaHoy.gastos, nuevo] } }));
    setFGasto({ concepto: "", monto: "", caja: "efectivo", categoria: "domicilio" });
    setSheetGasto(false);
  };

  const delVenta = (id) => setHistorial(h => ({ ...h, [TODAY]: { ...diaHoy, ventas: diaHoy.ventas.filter(v => v.id !== id) } }));
  const delGasto = (id) => setHistorial(h => ({ ...h, [TODAY]: { ...diaHoy, gastos: diaHoy.gastos.filter(g => g.id !== id) } }));

  // ── Caja menor ────────────────────────────────────────────────────────────
  const totalMenor = useMemo(() =>
    [...BILLETES, ...MONEDAS].reduce((a, d) => a + d * (conteo[d] || 0), 0) + (+conteo.extra || 0),
    [conteo]
  );

  // ── Historial nav ─────────────────────────────────────────────────────────
  const fechas = useMemo(() => Object.keys(historial).sort().reverse(), [historial]);
  const idxFecha = fechas.indexOf(fechaVista);
  const diaVista = historial[fechaVista] || { ventas: [], gastos: [] };
  const totVentaVista = METODOS.reduce((a, m) => a + diaVista.ventas.reduce((s, v) => s + (+v[m.key] || 0), 0), 0);
  const totGastoVista = diaVista.gastos.reduce((a, g) => a + (+g.monto || 0), 0);

  // ── NAV ───────────────────────────────────────────────────────────────────
  const TABS = [
    { id: "cajaDiaria", label: "Caja Diaria" },
    { id: "historial",  label: "Historial"   },
  ];

  // ── Estado gastos diarios (filas dinámicas) ───────────────────────────────
  const EMPTY_ROW = () => ({ id: uid(), caja: "efectivo", concepto: "", monto: "" });
  const [fechaGastos, setFechaGastos] = useState(todayStr());
  const [filasGastos, setFilasGastos] = useState([EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()]);

  // ══════════════════════════════════════════════════════════════════════════
  const S = { // styles
    card:    "bg-gray-800 border border-gray-700 rounded-2xl",
    section: "text-xs text-gray-500 uppercase tracking-widest font-semibold mb-2",
    row:     "flex items-center justify-between py-2.5 border-b border-gray-800 last:border-0",
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEW: CIERRE DE CAJA
  // ════════════════════════════════════════════════════════════════════════
  const ViewMayor = () => {
    const fmtC = (n) => $(n || 0);

    const registros = [
      ...diaHoy.ventas.map(v => ({ ...v, _tipo: "venta" })),
      ...diaHoy.gastos.map(g => ({ ...g, _tipo: "gasto" })),
    ].sort((a, b) => a.hora.localeCompare(b.hora));

    const tdCls = "py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden";
    const thCls = "py-1.5 text-center border-r border-gray-700/50 last:border-r-0";

    return (
      <div className={`${S.card} overflow-hidden`}>

        {/* Header */}
        <div className="px-3 pt-3 pb-2 flex items-center justify-between border-b border-gray-700">
          <span className={S.section}>
            {new Date().toLocaleDateString("es-CO", { weekday:"long", day:"numeric", month:"long" })}
          </span>
          <button onClick={() => setSheetVenta(true)}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium bg-blue-900/20 border border-blue-800/50 px-2.5 py-1 rounded-lg transition-colors">
            <Ic d={ICONS.plus} s={13} c="#60a5fa" /> Registrar
          </button>
        </div>

        {/* Tabla con overflow-x para scroll en móvil */}
        <div className="overflow-x-auto">
          <table className="border-collapse" style={{ tableLayout: "fixed", width: "100%" }}>
            <colgroup>
              <col style={{ width: "70px" }} />
              {METODOS.map(m => <col key={m.key} style={{ width: "64px" }} />)}
              <col style={{ width: "68px" }} />
            </colgroup>

            {/* Encabezados */}
            <thead>
              <tr className="bg-gray-800/70 border-b border-gray-700">
                <th className={`${thCls} text-left pl-3 text-gray-500`}>Concepto</th>
                {METODOS.map(m => (
                  <th key={m.key} className={thCls}>
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
                      <span style={{ color: m.color, fontSize: "9px" }} className="uppercase tracking-wide leading-none">
                        {m.key === "bancolombia" ? "Banco" : m.key === "aliados" ? "Aliad" : m.label.slice(0, 5)}
                      </span>
                    </div>
                  </th>
                ))}
                <th className={`${thCls} text-gray-500 pr-2`}>Total</th>
              </tr>
            </thead>

            <tbody>
              {registros.length === 0 ? (
                <tr>
                  <td colSpan={METODOS.length + 2} className="py-8 text-center text-gray-600 text-xs">
                    Sin registros — presiona Registrar
                  </td>
                </tr>
              ) : registros.map(r => {
                const isVenta = r._tipo === "venta";
                return (
                  <tr key={r.id} className="border-b border-gray-700/40 hover:bg-gray-800/40 group transition-colors">
                    {/* Concepto */}
                    <td className="py-2 pl-3 pr-1 border-r border-gray-700/50">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1 h-3 rounded-full shrink-0 ${isVenta ? "bg-emerald-500" : "bg-red-500"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-gray-300 leading-tight" style={{ fontSize: "10px" }}>{r.concepto}</div>
                          <div className="text-gray-600 leading-none mt-0.5" style={{ fontSize: "9px" }}>{r.hora}</div>
                        </div>
                        <button onClick={() => isVenta ? delVenta(r.id) : delGasto(r.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all shrink-0">
                          <Ic d={ICONS.trash} s={11} />
                        </button>
                      </div>
                    </td>
                    {/* Valores por método */}
                    {METODOS.map(m => {
                      const val = isVenta ? (r[m.key] || 0) : (r.caja === m.key ? r.monto : 0);
                      return (
                        <td key={m.key} className={`${tdCls} ${val > 0 ? (isVenta ? "text-emerald-400" : "text-red-400") : "text-gray-700"}`}>
                          {fmtC(val)}
                        </td>
                      );
                    })}
                    {/* Total fila */}
                    <td className={`${tdCls} font-bold ${isVenta ? "text-emerald-300" : "text-red-300"}`}>
                      {isVenta ? fmtC(r.total) : `−${fmtC(r.monto)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Totales */}
            {(granTotal > 0 || totGastos > 0) && (
              <tfoot>
                {/* Ingresos */}
                {granTotal > 0 && (
                  <tr className="border-t-2 border-gray-600 bg-emerald-900/20">
                    <td className="py-1.5 pl-3 pr-1 text-xs font-bold text-emerald-400 border-r border-gray-700/50">↑ Ingr.</td>
                    {METODOS.map(m => (
                      <td key={m.key} className={`${tdCls} font-bold ${totVentas[m.key] > 0 ? "text-emerald-400" : "text-gray-700"}`}>
                        {fmtC(totVentas[m.key])}
                      </td>
                    ))}
                    <td className={`${tdCls} font-bold text-emerald-400`}>{fmtC(granTotal)}</td>
                  </tr>
                )}
                {/* Egresos */}
                {totGastos > 0 && (
                  <tr className="border-t border-gray-700/60 bg-red-900/20">
                    <td className="py-1.5 pl-3 pr-1 text-xs font-bold text-red-400 border-r border-gray-700/50">↓ Egr.</td>
                    {METODOS.map(m => (
                      <td key={m.key} className={`${tdCls} font-bold ${totGastosPorCaja[m.key] > 0 ? "text-red-400" : "text-gray-700"}`}>
                        {fmtC(totGastosPorCaja[m.key])}
                      </td>
                    ))}
                    <td className={`${tdCls} font-bold text-red-400`}>−{fmtC(totGastos)}</td>
                  </tr>
                )}
                {/* Neto */}
                <tr className="border-t-2 border-gray-500 bg-gray-800/80">
                  <td className="py-1.5 pl-3 pr-1 text-xs font-bold text-white border-r border-gray-700/50">= Neto</td>
                  {METODOS.map(m => {
                    const n = (totVentas[m.key] || 0) - (totGastosPorCaja[m.key] || 0);
                    return (
                      <td key={m.key} className={`${tdCls} font-bold ${n > 0 ? "text-blue-400" : n < 0 ? "text-red-400" : "text-gray-700"}`}>
                        {n !== 0 ? fmtC(n) : "—"}
                      </td>
                    );
                  })}
                  <td className={`${tdCls} font-bold text-sm ${netoTotal >= 0 ? "text-blue-400" : "text-red-400"}`}>
                    {fmtC(netoTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEW: FONDO DE CAJA
  // ════════════════════════════════════════════════════════════════════════
  const ViewMenor = () => {
    const DenomRow = ({ d, isMoneda }) => {
      const cant = conteo[d] || 0;
      return (
        <div className="flex items-center gap-2 py-1.5 border-b border-gray-800 last:border-0">
          {/* Denominación */}
          <div className="w-20 shrink-0">
            <div className="text-xs font-semibold text-gray-200">{$(d)}</div>
          </div>
          {/* Controles */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => setConteo(c => ({ ...c, [d]: Math.max(0, (c[d] || 0) - 1) }))}
              className="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded-md flex items-center justify-center text-white text-sm font-bold leading-none transition-colors">−</button>
            <span className="text-white font-mono text-xs w-5 text-center font-bold">{cant}</span>
            <button onClick={() => setConteo(c => ({ ...c, [d]: (c[d] || 0) + 1 }))}
              className="w-6 h-6 bg-gray-700 hover:bg-gray-600 rounded-md flex items-center justify-center text-white text-sm font-bold leading-none transition-colors">+</button>
          </div>
          {/* Subtotal */}
          <div className="flex-1 text-right">
            {cant > 0
              ? <span className="text-xs font-mono text-yellow-400">{$(cant * d)}</span>
              : <span className="text-xs text-gray-700">—</span>
            }
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-3">
        {/* Total sticky */}
        <div className={`${S.card} px-4 py-3 flex items-center justify-between`}>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-widest">Fondo de Caja</div>
            <div className="text-2xl font-bold font-mono text-yellow-400 mt-0.5">{$(totalMenor)}</div>
          </div>
          <button onClick={() => setConteo(Object.fromEntries([...BILLETES, ...MONEDAS].map(d => [d, 0])))}
            className="text-xs text-gray-600 hover:text-gray-400 border border-gray-700 px-3 py-1.5 rounded-lg transition-colors">
            Limpiar
          </button>
        </div>

        {/* Billetes + Monedas en dos columnas */}
        <div className="grid grid-cols-2 gap-3">
          {/* Billetes */}
          <div className={S.card}>
            <div className="px-3 pt-3 pb-1">
              <span className={S.section}>Billetes</span>
            </div>
            <div className="px-3 pb-3">
              {BILLETES.map(d => <DenomRow key={d} d={d} />)}
            </div>
          </div>
          {/* Monedas + resumen */}
          <div className="space-y-3">
            <div className={S.card}>
              <div className="px-3 pt-3 pb-1">
                <span className={S.section}>Monedas</span>
              </div>
              <div className="px-3 pb-3">
                {MONEDAS.map(d => <DenomRow key={d} d={d} />)}
              </div>
            </div>
            {/* Resumen por tipo */}
            <div className={S.card + " px-3 py-3 space-y-1.5"}>
              <span className={S.section}>Resumen</span>
              {[
                { label: "Billetes", total: BILLETES.reduce((a, d) => a + d * (conteo[d] || 0), 0) },
                { label: "Monedas",  total: MONEDAS.reduce((a, d) => a + d * (conteo[d] || 0), 0)  },
              ].map(x => (
                <div key={x.label} className="flex justify-between text-xs">
                  <span className="text-gray-500">{x.label}</span>
                  <span className="font-mono text-gray-300">{$(x.total)}</span>
                </div>
              ))}
              <div className="border-t border-gray-700 pt-1.5 flex justify-between text-xs">
                <span className="text-gray-400 font-medium">Total</span>
                <span className="font-mono font-bold text-yellow-400">{$(totalMenor)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEW: HISTORIAL — Libro Contable
  // ════════════════════════════════════════════════════════════════════════
  const ViewHistorial = () => {
    const [mesDetalle, setMesDetalle] = useState(null);
    const [diaDetalle, setDiaDetalle] = useState(null); // fecha string
    const [mesExport, setMesExport] = useState(todayStr().slice(0, 7));

    const fmtC = n => $(n || 0);

    const toRows = (dias) => {
      const fechas = Object.keys(dias).sort();
      const rows = fechas.flatMap(fecha => {
        const dia = dias[fecha] || { ventas: [], gastos: [] };
        const ingresos = Object.fromEntries(METODOS.map(m => [
          m.key,
          dia.ventas.reduce((a, v) => a + (+v[m.key] || 0), 0),
        ]));
        const egresos = Object.fromEntries(METODOS.map(m => [
          m.key,
          dia.gastos.filter(g => g.caja === m.key).reduce((a, g) => a + (+g.monto || 0), 0),
        ]));

        const totalIngresos = METODOS.reduce((a, m) => a + (ingresos[m.key] || 0), 0);
        const totalEgresos = METODOS.reduce((a, m) => a + (egresos[m.key] || 0), 0);

        return [
          {
            Fecha: fecha,
            Tipo: "Ingresos",
            Efectivo: ingresos.efectivo || 0,
            Bancolombia: ingresos.bancolombia || 0,
            Nequi: ingresos.nequi || 0,
            Bold: ingresos.bold || 0,
            Aliados: ingresos.aliados || 0,
            Total: totalIngresos,
          },
          {
            Fecha: fecha,
            Tipo: "Egresos",
            Efectivo: egresos.efectivo || 0,
            Bancolombia: egresos.bancolombia || 0,
            Nequi: egresos.nequi || 0,
            Bold: egresos.bold || 0,
            Aliados: egresos.aliados || 0,
            Total: totalEgresos,
          },
          {
            Fecha: fecha,
            Tipo: "Saldo",
            Efectivo: (ingresos.efectivo || 0) - (egresos.efectivo || 0),
            Bancolombia: (ingresos.bancolombia || 0) - (egresos.bancolombia || 0),
            Nequi: (ingresos.nequi || 0) - (egresos.nequi || 0),
            Bold: (ingresos.bold || 0) - (egresos.bold || 0),
            Aliados: (ingresos.aliados || 0) - (egresos.aliados || 0),
            Total: totalIngresos - totalEgresos,
          },
        ];
      });

      const totalGlobal = rows.reduce((a, r) => a + (r.Tipo === "Saldo" ? +r.Total : 0), 0);
      rows.push({ Fecha: "", Tipo: "TOTAL GLOBAL", Efectivo: "", Bancolombia: "", Nequi: "", Bold: "", Aliados: "", Total: totalGlobal });
      return rows;
    };

    const exportarExcel = (dias, nombreArchivo) => {
      const rows = toRows(dias);
      if (!rows.length) return;
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Historial");
      XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
    };

    const exportarMes = () => {
      const diasMes = Object.fromEntries(
        Object.entries(historial).filter(([fecha]) => fecha.startsWith(mesExport))
      );
      if (!Object.keys(diasMes).length) return;
      exportarExcel(diasMes, `financex-${mesExport}`);
    };

    const exportarTotal = () => {
      if (!Object.keys(historial).length) return;
      exportarExcel(historial, "financex-total");
    };

    // ── Modal: movimientos de egresos de un día ────────────────────────────
    if (mesDetalle && diaDetalle) {
      const dia = mesDetalle.diasHistorial?.[diaDetalle] || { ventas:[], gastos:[] };
      const gastosDia = dia.gastos || [];
      const totalDia  = gastosDia.reduce((a,g)=>a+(+g.monto||0),0);
      const dateObj   = new Date(diaDetalle+"T12:00:00");
      const diasSem   = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
      const labelDia  = `${diasSem[dateObj.getDay()]} ${diaDetalle.slice(8)}/${diaDetalle.slice(5,7)}`;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={()=>setDiaDetalle(null)}
              className="p-2 rounded-xl bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white">
              <Ic d={ICONS.left} s={16}/>
            </button>
            <div className="flex-1">
              <div className="text-white font-bold text-sm">Egresos — {labelDia}</div>
              <div className="text-gray-600 capitalize" style={{fontSize:"10px"}}>{mesDetalle.nombre}</div>
            </div>
            {totalDia>0 && <span className="text-red-400 font-mono font-bold text-sm">−{fmtC(totalDia)}</span>}
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-2xl overflow-hidden">
            {gastosDia.length === 0 ? (
              <div className="py-10 text-center text-gray-600 text-xs">Sin egresos registrados este día</div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-900/60 border-b border-gray-700">
                    {["HORA","CONCEPTO","CAJA","MONTO"].map(h=>(
                      <th key={h} className="px-3 py-2 text-left text-gray-500 font-semibold uppercase tracking-wider border-r border-gray-700/50 last:border-r-0" style={{fontSize:"9px"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gastosDia.map((g,i)=>{
                    const m = METODOS.find(x=>x.key===g.caja)||METODOS[0];
                    return (
                      <tr key={g.id} className="border-b border-gray-700/30 last:border-b-0"
                        style={{background:i%2===0?"#1a0a0a":"#140707"}}>
                        <td className="px-3 py-2 text-gray-500 font-mono border-r border-gray-700/30" style={{fontSize:"10px"}}>{g.hora}</td>
                        <td className="px-3 py-2 text-gray-300 border-r border-gray-700/30" style={{fontSize:"11px"}}>{g.concepto}</td>
                        <td className="px-3 py-2 border-r border-gray-700/30" style={{fontSize:"10px"}}>
                          <span className="font-medium" style={{color:m.color}}>{m.label}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-red-400" style={{fontSize:"11px"}}>
                          −{fmtC(g.monto)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-600 bg-red-900/20">
                    <td colSpan={3} className="px-3 py-2 text-red-400 font-bold" style={{fontSize:"10px"}}>Total egresos del día</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-red-400" style={{fontSize:"12px"}}>−{fmtC(totalDia)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      );
    }

    // ── Modal: movimientos del mes ─────────────────────────────────────────
    if (mesDetalle) {
      const mg = mesDetalle;
      return (
        <div className="space-y-3">
          {/* Header modal */}
          <div className="flex items-center gap-3">
            <button onClick={()=>setMesDetalle(null)}
              className="p-2 rounded-xl bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white">
              <Ic d={ICONS.left} s={16}/>
            </button>
            <div className="flex-1">
              <div className="text-white font-bold text-sm capitalize">{mg.nombre}</div>
              <div className="text-gray-600" style={{fontSize:"10px"}}>Movimientos del mes</div>
            </div>
          </div>

          {/* Tabla completa de movimientos */}
          <div className="bg-gray-800 border border-gray-700 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="border-collapse" style={{tableLayout:"fixed", minWidth:380}}>
                <colgroup>
                  <col style={{width:60}}/><col style={{width:16}}/>{METODOS.map(m=><col key={m.key} style={{width:54}}/>)}
                </colgroup>
                <thead>
                  <tr className="bg-gray-800/80 border-b border-gray-700">
                    <th className="border-r border-gray-700 px-1.5 py-1.5 text-left text-gray-500 font-medium" style={{fontSize:"9px"}}>DÍA</th>
                    <th className="border-r border-gray-700" style={{width:16}}></th>
                    {METODOS.map(m=>(
                      <th key={m.key} className="border-r border-gray-700 last:border-r-0 text-center py-1.5 px-0.5">
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="w-1.5 h-1.5 rounded-full" style={{background:m.color}}/>
                          <span style={{color:m.color,fontSize:"9px"}} className="font-semibold uppercase leading-none">
                            {m.key==="bancolombia"?"Banco":m.key==="aliados"?"Aliad":m.label.slice(0,5)}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mg.filas.length===0 ? (
                    <tr><td colSpan={METODOS.length+2} className="py-8 text-center text-gray-600 text-xs">Sin movimientos</td></tr>
                  ) : mg.filas.map(fila=>{
                    const isIngreso = fila.tipo==="ingreso";
                    const clickable = !isIngreso && (mg.diasHistorial?.[fila.fecha]?.gastos?.length > 0);
                    return (
                      <tr key={`${fila.fecha}-${fila.tipo}`}
                        onClick={clickable ? ()=>setDiaDetalle(fila.fecha) : undefined}
                        className={`border-b border-gray-700/30 last:border-b-0 transition-all
                          ${clickable ? "cursor-pointer hover:bg-red-900/30" : "hover:brightness-110"}`}
                        style={{background:isIngreso?"#0d1f0d":"#1a0a0a"}}>
                        <td className="border-r border-gray-700/50 px-1.5 py-1">
                          <div className="flex items-center gap-1">
                            <span className="font-semibold" style={{fontSize:"10px",color:isIngreso?"#6ee7b7":"#9ca3af"}}>{fila.label}</span>
                            {clickable && <span className="text-red-700 font-bold" style={{fontSize:"10px"}}>›</span>}
                          </div>
                        </td>
                        <td className="border-r border-gray-700/50 text-center py-1">
                          <span style={{fontSize:"10px"}} className={isIngreso?"text-emerald-500":"text-red-500"}>{isIngreso?"↑":"↓"}</span>
                        </td>
                        {METODOS.map(m=>{
                          const val=fila.vals[m.key]||0;
                          return (
                            <td key={m.key} className="border-r border-gray-700/30 last:border-r-0 text-center font-mono px-0.5 py-1"
                              style={{fontSize:"10px",color:val>0?(isIngreso?"#6ee7b7":"#fca5a5"):"#374151"}}>
                              {val>0?fmtC(val):"—"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-600 bg-emerald-900/20">
                    <td colSpan={2} className="border-r border-gray-700/50 px-1.5 py-1.5 text-emerald-400 font-bold" style={{fontSize:"9px"}}>↑ Total Ingresos</td>
                    {METODOS.map(m=><td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold py-1.5" style={{fontSize:"10px",color:mg.totV[m.key]>0?"#6ee7b7":"#374151"}}>{fmtC(mg.totV[m.key])}</td>)}
                  </tr>
                  <tr className="border-t border-gray-700/50 bg-red-900/20">
                    <td colSpan={2} className="border-r border-gray-700/50 px-1.5 py-1.5 text-red-400 font-bold" style={{fontSize:"9px"}}>↓ Total Egresos</td>
                    {METODOS.map(m=><td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold py-1.5" style={{fontSize:"10px",color:mg.totG[m.key]>0?"#fca5a5":"#374151"}}>{fmtC(mg.totG[m.key])}</td>)}
                  </tr>
                  <tr className="border-t-2 border-gray-500 bg-blue-950/40">
                    <td colSpan={2} className="border-r border-gray-700/50 px-1.5 py-1.5 text-blue-300 font-bold" style={{fontSize:"9px"}}>= Saldo</td>
                    {METODOS.map(m=>{
                      const n=(mg.totV[m.key]||0)-(mg.totG[m.key]||0);
                      return <td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold py-1.5" style={{fontSize:"10px",color:n>0?"#93c5fd":n<0?"#f87171":"#374151"}}>{n!==0?fmtC(n):"—"}</td>;
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      );
    }

    // ── Libro contable ─────────────────────────────────────────────────────
    const meses = Object.values(mesesGuardados).sort((a,b)=>b.mes.localeCompare(a.mes));
    const hayMesExport = Object.keys(historial).some(fecha => fecha.startsWith(mesExport));

    return (
      <div className="space-y-2">

        {/* Título */}
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Libro Contable</span>
          <span className="text-xs text-gray-600">{meses.length} {meses.length===1?"mes":"meses"}</span>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 flex items-center gap-2 flex-wrap">
          <input
            type="month"
            value={mesExport}
            onChange={e => setMesExport(e.target.value)}
            className="bg-transparent text-xs text-gray-300 border border-gray-700 rounded-lg px-2 py-1.5"
          />
          <button
            onClick={exportarMes}
            disabled={!hayMesExport}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              hayMesExport ? "text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/20" : "text-gray-600 border-gray-700 cursor-not-allowed"
            }`}
          >
            Descargar Mes Excel
          </button>
          <button
            onClick={exportarTotal}
            disabled={!Object.keys(historial).length}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              Object.keys(historial).length ? "text-blue-300 border-blue-800/60 hover:bg-blue-900/20" : "text-gray-600 border-gray-700 cursor-not-allowed"
            }`}
          >
            Descargar Total Excel
          </button>
        </div>

        {meses.length === 0 ? (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl py-14 text-center">
            <div className="text-gray-600 text-sm mb-1">Sin registros</div>
            <div className="text-gray-700 text-xs">Guarda un mes desde Caja Diaria → Ventas del Mes</div>
          </div>
        ) : (
          <div className="bg-gray-800 border border-gray-700 rounded-2xl overflow-hidden">
            {/* Cabecera tabla */}
            <div className="grid border-b border-gray-700 bg-gray-900/60"
              style={{gridTemplateColumns:"1fr 100px 100px 100px 88px"}}>
              {["MES","INGRESOS","EGRESOS","TOTAL SALDO",""].map((h,i)=>(
                <div key={i} className={`px-3 py-2 text-gray-500 font-semibold uppercase tracking-wider ${i>0?"text-right":""}`}
                  style={{fontSize:"9px",borderRight:i<4?"1px solid #1f2937":"none"}}>
                  {h}
                </div>
              ))}
            </div>

            {/* Filas de meses */}
            {meses.map((mg, idx) => {
              const totalIngr = METODOS.reduce((a,m)=>a+(mg.totV[m.key]||0),0);
              const totalEgr  = METODOS.reduce((a,m)=>a+(mg.totG[m.key]||0),0);
              const saldo     = totalIngr - totalEgr;
              return (
                <div key={mg.mes}
                  className="grid border-b border-gray-700/50 last:border-b-0 hover:bg-gray-700/30 transition-colors"
                  style={{gridTemplateColumns:"1fr 100px 100px 100px 88px", background: idx%2===0?"#111827":"#0f172a"}}>

                  {/* Mes */}
                  <div className="px-3 py-3 flex flex-col justify-center" style={{borderRight:"1px solid #1f2937"}}>
                    <span className="text-white font-semibold capitalize text-sm">{mg.nombre}</span>
                    <span className="text-gray-600 mt-0.5" style={{fontSize:"9px"}}>Guardado {mg.savedAt}</span>
                  </div>

                  {/* Ingresos */}
                  <div className="px-3 py-3 text-right flex flex-col justify-center" style={{borderRight:"1px solid #1f2937"}}>
                    <span className="text-emerald-400 font-mono font-bold text-sm">{fmtC(totalIngr)}</span>
                    <span className="text-gray-600 mt-0.5" style={{fontSize:"9px"}}>↑ ingresos</span>
                  </div>

                  {/* Egresos */}
                  <div className="px-3 py-3 text-right flex flex-col justify-center" style={{borderRight:"1px solid #1f2937"}}>
                    <span className="text-red-400 font-mono font-bold text-sm">{fmtC(totalEgr)}</span>
                    <span className="text-gray-600 mt-0.5" style={{fontSize:"9px"}}>↓ egresos</span>
                  </div>

                  {/* Saldo */}
                  <div className="px-3 py-3 text-right flex flex-col justify-center" style={{borderRight:"1px solid #1f2937"}}>
                    <span className={`font-mono font-bold text-sm ${saldo>=0?"text-blue-400":"text-red-400"}`}>{fmtC(saldo)}</span>
                    <span className="text-gray-600 mt-0.5" style={{fontSize:"9px"}}>{saldo>=0?"superávit":"déficit"}</span>
                  </div>

                  {/* Botón */}
                  <div className="px-2 py-3 flex flex-col items-center justify-center gap-1.5">
                    <button onClick={()=>setMesDetalle(mg)}
                      className="w-full py-1.5 rounded-lg bg-gray-700 hover:bg-blue-700 text-gray-300 hover:text-white text-xs font-semibold transition-all border border-gray-600 hover:border-blue-600">
                      Ver
                    </button>
                    <button
                      onClick={() => exportarExcel(mg.diasHistorial || {}, `financex-${mg.mes}`)}
                      className="w-full py-1.5 rounded-lg bg-gray-800 hover:bg-emerald-700 text-gray-300 hover:text-white text-xs font-semibold transition-all border border-gray-600 hover:border-emerald-600"
                    >
                      Excel
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Fila totales globales */}
            {meses.length > 1 && (()=>{
              const tI = meses.reduce((a,mg)=>a+METODOS.reduce((b,m)=>b+(mg.totV[m.key]||0),0),0);
              const tE = meses.reduce((a,mg)=>a+METODOS.reduce((b,m)=>b+(mg.totG[m.key]||0),0),0);
              const tS = tI - tE;
              return (
                <div className="grid border-t-2 border-gray-600 bg-gray-900"
                  style={{gridTemplateColumns:"1fr 100px 100px 100px 88px"}}>
                  <div className="px-3 py-2.5 text-gray-400 font-bold text-xs" style={{borderRight:"1px solid #1f2937"}}>TOTAL GENERAL</div>
                  <div className="px-3 py-2.5 text-right font-mono font-bold text-emerald-400 text-xs" style={{borderRight:"1px solid #1f2937"}}>{fmtC(tI)}</div>
                  <div className="px-3 py-2.5 text-right font-mono font-bold text-red-400 text-xs" style={{borderRight:"1px solid #1f2937"}}>{fmtC(tE)}</div>
                  <div className={`px-3 py-2.5 text-right font-mono font-bold text-xs ${tS>=0?"text-blue-400":"text-red-400"}`} style={{borderRight:"1px solid #1f2937"}}>{fmtC(tS)}</div>
                  <div/>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEW: GASTOS DIARIOS
  // ════════════════════════════════════════════════════════════════════════
  const ViewGastos = () => {
    const actualizarFila = (id, campo, valor) =>
      setFilasGastos(f => f.map(r => r.id === id ? { ...r, [campo]: valor } : r));
    const agregarFila = () => setFilasGastos(f => [...f, EMPTY_ROW()]);
    const eliminarFila = (id) => setFilasGastos(f => f.filter(r => r.id !== id));

    const filasTienenDatos = filasGastos.some(r => r.concepto && r.monto);
    const totalPorCaja = useMemo(() =>
      Object.fromEntries(METODOS.map(m => [
        m.key, filasGastos.filter(r => r.caja === m.key && +r.monto > 0).reduce((a, r) => a + (+r.monto), 0)
      ])),
      [filasGastos]
    );
    const totalGeneral = Object.values(totalPorCaja).reduce((a, v) => a + v, 0);

    const guardarGastosDiarios = () => {
      const validas = filasGastos.filter(r => r.concepto.trim() && +r.monto > 0);
      if (!validas.length) return;
      const fecha = fechaGastos || TODAY;
      setHistorial(h => {
        const dia = h[fecha] || { ventas: [], gastos: [] };
        const nuevos = validas.map(r => ({
          id: uid(), hora: nowStr(), fecha,
          concepto: r.concepto.trim(), monto: +r.monto,
          caja: r.caja, categoria: "gasto diario"
        }));
        return { ...h, [fecha]: { ...dia, gastos: [...dia.gastos, ...nuevos] } };
      });
      setFilasGastos([EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()]);
    };

    return (
      <div className="space-y-3">

        {/* Header con fecha */}
        <div className={`${S.card} px-3 py-3 flex items-center justify-between`}>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-0.5">Fecha</div>
            <input type="date" value={fechaGastos} onChange={e => setFechaGastos(e.target.value)}
              className="bg-transparent text-white text-sm font-semibold focus:outline-none" />
          </div>
          {totalGeneral > 0 && (
            <div className="text-right">
              <div className="text-xs text-gray-500 mb-0.5">Total gastos</div>
              <div className="text-sm font-mono font-bold text-red-400">{$(totalGeneral)}</div>
            </div>
          )}
        </div>

        {/* Tabla de filas */}
        <div className={`${S.card} overflow-hidden`}>

          {/* Header columnas */}
          <div className="grid border-b border-gray-700 bg-gray-800/70" style={{ gridTemplateColumns: "1fr 1fr 80px 28px" }}>
            {["Método de pago", "Concepto", "Monto", ""].map((h, i) => (
              <div key={i} className="px-2 py-2 text-xs text-gray-500 font-medium border-r border-gray-700/50 last:border-r-0">{h}</div>
            ))}
          </div>

          {/* Filas */}
          {filasGastos.map((fila, idx) => {
            const m = METODOS.find(x => x.key === fila.caja) || METODOS[0];
            const disponible = (totVentas[fila.caja] || 0) - (totGastosPorCaja[fila.caja] || 0);
            return (
              <div key={fila.id} className="grid border-b border-gray-700/40 last:border-b-0 hover:bg-gray-800/30 transition-colors group"
                style={{ gridTemplateColumns: "1fr 1fr 80px 28px" }}>

                {/* Método */}
                <div className="border-r border-gray-700/50 p-1.5">
                  <select
                    className="w-full bg-transparent text-xs focus:outline-none cursor-pointer appearance-none"
                    style={{ color: m.color }}
                    value={fila.caja}
                    onChange={e => actualizarFila(fila.id, "caja", e.target.value)}>
                    {METODOS.map(mt => (
                      <option key={mt.key} value={mt.key} style={{ background: "#1f2937", color: mt.color }}>
                        {mt.label}
                      </option>
                    ))}
                  </select>
                  {disponible > 0 && (
                    <div className="text-gray-600 leading-none mt-0.5" style={{ fontSize: "9px" }}>
                      disp: {$(disponible)}
                    </div>
                  )}
                </div>

                {/* Concepto */}
                <div className="border-r border-gray-700/50 p-1.5">
                  <input
                    className="w-full bg-transparent text-white text-xs focus:outline-none placeholder-gray-700"
                    placeholder="Ej: domicilio, turno..."
                    value={fila.concepto}
                    onChange={e => actualizarFila(fila.id, "concepto", e.target.value)} />
                </div>

                {/* Monto */}
                <div className="border-r border-gray-700/50 p-1.5">
                  <input
                    type="number" inputMode="numeric"
                    className="w-full bg-transparent text-xs font-mono text-right focus:outline-none placeholder-gray-700"
                    style={{ color: fila.monto ? "#fca5a5" : undefined }}
                    placeholder="0"
                    value={fila.monto}
                    onChange={e => actualizarFila(fila.id, "monto", e.target.value)} />
                </div>

                {/* Eliminar */}
                <div className="flex items-center justify-center">
                  <button onClick={() => eliminarFila(fila.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-400 transition-all">
                    <Ic d={ICONS.trash} s={12} />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Totales por caja */}
          {totalGeneral > 0 && (
            <div className="border-t-2 border-gray-600 bg-gray-800/60 px-3 py-2 space-y-1">
              {METODOS.filter(m => totalPorCaja[m.key] > 0).map(m => (
                <div key={m.key} className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
                    <span className="text-xs" style={{ color: m.color }}>{m.label}</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-red-400">− {$(totalPorCaja[m.key])}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agregar fila + Guardar */}
        <div className="flex gap-2">
          <button onClick={agregarFila}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-2.5 rounded-xl transition-colors">
            <Ic d={ICONS.plus} s={13} /> Fila
          </button>
          <button onClick={guardarGastosDiarios} disabled={!filasTienenDatos}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2
              ${filasTienenDatos ? "bg-red-700 hover:bg-red-600 text-white" : "bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700"}`}>
            <Ic d={ICONS.check} s={15} /> Guardar en Cierre de Caja
          </button>
        </div>

      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEW: CAJA DIARIA
  // ════════════════════════════════════════════════════════════════════════
  const ViewCajaDiaria = () => {
    // Cada fila arranca con un método diferente (ciclando por METODOS)
    const EROW = (i=0) => ({ id: uid(), caja: METODOS[i % METODOS.length].key, concepto: "", monto: "" });
    const INIT_ROWS = (n=8) => Array.from({length:n}, (_,i) => EROW(i));

    // Egresos
    const [rowsG, setRowsG] = useState(INIT_ROWS());
    const [fechaG, setFechaG] = useState(todayStr());
    const updG = (id,k,v) => setRowsG(r=>r.map(x=>x.id===id?{...x,[k]:v}:x));
    const addG = () => setRowsG(r=>[...r, EROW(r.length)]);
    const delG = (id) => setRowsG(r=>r.filter(x=>x.id!==id));
    const totalG = rowsG.reduce((a,r)=>a+(+r.monto||0),0);
    const hayG   = rowsG.some(r=>r.concepto.trim()&&+r.monto>0);

    // Ingresos
    const [rowsI, setRowsI] = useState(INIT_ROWS());
    const [fechaI, setFechaI] = useState(todayStr());
    const [panelOpen, setPanelOpen] = useState({ Ingresos: true, Egresos: true });
    const updI = (id,k,v) => setRowsI(r=>r.map(x=>x.id===id?{...x,[k]:v}:x));
    const addI = () => setRowsI(r=>[...r, EROW(r.length)]);
    const delI = (id) => setRowsI(r=>r.filter(x=>x.id!==id));
    const totalI = rowsI.reduce((a,r)=>a+(+r.monto||0),0);
    const hayI   = rowsI.some(r=>+r.monto>0);

    const totGRow = useMemo(()=>Object.fromEntries(METODOS.map(m=>[m.key,rowsG.filter(r=>r.caja===m.key&&+r.monto>0).reduce((a,r)=>a+(+r.monto),0)])),[rowsG]);
    const totIRow = useMemo(()=>Object.fromEntries(METODOS.map(m=>[m.key,rowsI.filter(r=>r.caja===m.key&&+r.monto>0).reduce((a,r)=>a+(+r.monto),0)])),[rowsI]);

    // Calculadora local billetes/monedas (debajo de ventas por día)
    const DENOMS = [50,100,200,500,1000,2000,5000,10000,20000,50000,100000];
    const [showFondo, setShowFondo] = useState(false);
    const [conteoLocal, setConteoLocal] = useState(() =>
      ({ ...Object.fromEntries(DENOMS.map(d => [d, conteo[d] || 0])), extra: conteo.extra || 0 })
    );
    const fmtDenom = n => n>=1000?`$${n/1000}k`:`$${n}`;
    const fmtVal = n => $(n || 0);
    const totalConteo = DENOMS.reduce((a,d)=>a+d*(conteoLocal[d]||0),0) + (conteoLocal["extra"]||0);
    const totalMonedas = [50,100,200,500].reduce((a,d)=>a+d*(conteoLocal[d]||0),0);
    const GI_ROW = (concepto = "") => ({ id: uid(), concepto, monto: "" });
    const initGastosInternos = () => [GI_ROW("Domicilios"), GI_ROW("Turno"), GI_ROW()];
    const [rowsGI, setRowsGI] = useState(initGastosInternos());
    const [savedConteoMsg, setSavedConteoMsg] = useState(false);
    const updGI = (id,k,v) => setRowsGI(r=>r.map(x=>x.id===id?{...x,[k]:v}:x));
    const addGI = () => setRowsGI(r=>[...r, GI_ROW()]);
    const limpiarGI = () => setRowsGI(initGastosInternos());
    const totalGI = rowsGI.reduce((a,r)=>a+(+r.monto||0),0);

    useEffect(() => {
      setConteoLocal(prev => ({
        ...prev,
        ...Object.fromEntries(DENOMS.map(d => [d, conteo[d] || 0])),
        extra: conteo.extra || 0,
      }));
    }, [conteo]);

    const registrarTodo = () => {
      const validasI = rowsI.filter(r => +r.monto > 0);
      const validasG = rowsG.filter(r => r.concepto.trim() && +r.monto > 0);
      if (!validasI.length && !validasG.length) return;
      const fecha = fechaI || fechaG || TODAY;
      setHistorial(h => {
        const dia = h[fecha] || { ventas: [], gastos: [] };
        const nuevasVentas = validasI.length > 0 ? [...dia.ventas, {
          id: uid(), hora: nowStr(), fecha,
          concepto: "Ventas del día",
          ...Object.fromEntries(METODOS.map(m => [m.key, validasI.filter(r=>r.caja===m.key).reduce((a,r)=>a+(+r.monto),0)])),
          total: validasI.reduce((a,r) => a+(+r.monto), 0)
        }] : dia.ventas;
        const nuevosGastos = validasG.length > 0
          ? [...dia.gastos, ...validasG.map(r => ({ id:uid(), hora:nowStr(), fecha, concepto:r.concepto.trim(), monto:+r.monto, caja:r.caja, categoria:"gasto diario" }))]
          : dia.gastos;
        return { ...h, [fecha]: { ventas: nuevasVentas, gastos: nuevosGastos } };
      });
      setRowsI(INIT_ROWS());
      setRowsG(INIT_ROWS());
    };

    // Tabla derecha: fila ingreso muestra día (ej: "Miércoles"), fila egreso muestra fecha (ej: "11/03")
    const diasSemana = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
    const [mesFiltro, setMesFiltro] = useState(todayStr().slice(0,7)); // "2025-03"

    const filasVentas = useMemo(() => {
      return Object.keys(historial).filter(f=>f.startsWith(mesFiltro)).sort().flatMap(fecha => {
        const dia = historial[fecha];
        const ingresos = Object.fromEntries(METODOS.map(m=>[m.key, dia.ventas.reduce((a,v)=>a+(+v[m.key]||0),0)]));
        const egresos  = Object.fromEntries(METODOS.map(m=>[m.key, dia.gastos.filter(g=>g.caja===m.key).reduce((a,g)=>a+(+g.monto||0),0)]));
        const tieneI = METODOS.some(m=>ingresos[m.key]>0);
        const tieneE = METODOS.some(m=>egresos[m.key]>0);
        if (!tieneI && !tieneE) return [];
        const dateObj = new Date(fecha + "T12:00:00");
        const labelIngreso = diasSemana[dateObj.getDay()];
        const labelEgreso  = fecha.slice(5).replace("-","/");
        return [
          { fecha, tipo:"ingreso", label:labelIngreso, vals:ingresos },
          { fecha, tipo:"egreso",  label:labelEgreso,  vals:egresos  },
        ];
      });
    }, [historial, mesFiltro]);

    // Totales filtrados por mes
    const mesEntradas = useMemo(()=>Object.entries(historial).filter(([f])=>f.startsWith(mesFiltro)).map(([,v])=>v),[historial,mesFiltro]);
    const totV = useMemo(()=>Object.fromEntries(METODOS.map(m=>[m.key,mesEntradas.flatMap(d=>d.ventas).reduce((a,v)=>a+(+v[m.key]||0),0)])),[mesEntradas]);
    const totG = useMemo(()=>Object.fromEntries(METODOS.map(m=>[m.key,mesEntradas.flatMap(d=>d.gastos).filter(g=>g.caja===m.key).reduce((a,g)=>a+(+g.monto||0),0)])),[mesEntradas]);

    const fmtK = n => $(n || 0);

    const togglePanel = (label) =>
      setPanelOpen((p) => ({ ...p, [label]: !p[label] }));

    const guardarConteoNaranja = () => {
      const next = { ...conteo };
      [...BILLETES, ...MONEDAS].forEach((d) => {
        next[d] = +conteoLocal[d] || 0;
      });
      next.extra = +conteoLocal.extra || 0;
      setConteo(next);
      setSavedConteoMsg(true);
      setTimeout(() => setSavedConteoMsg(false), 1200);
      setShowFondo(false);
    };

    const editarMontoDiario = (fecha, tipo, metodo, valor) => {
      const monto = Math.max(0, +valor || 0);
      setHistorial(h => {
        const dia = h[fecha] || { ventas: [], gastos: [] };

        if (tipo === "ingreso") {
          const totalesActuales = Object.fromEntries(
            METODOS.map(m => [
              m.key,
              dia.ventas.reduce((a, v) => a + (+v[m.key] || 0), 0),
            ])
          );
          const nuevosTotales = { ...totalesActuales, [metodo]: monto };
          const total = METODOS.reduce((a, m) => a + (nuevosTotales[m.key] || 0), 0);
          const ventas =
            total > 0
              ? [{
                  id: dia.ventas[0]?.id || uid(),
                  hora: nowStr(),
                  fecha,
                  concepto: dia.ventas[0]?.concepto || "Ventas del dia",
                  ...nuevosTotales,
                  total,
                }]
              : [];

          return { ...h, [fecha]: { ...dia, ventas } };
        }

        const totalesGasto = Object.fromEntries(
          METODOS.map(m => [
            m.key,
            dia.gastos.filter(g => g.caja === m.key).reduce((a, g) => a + (+g.monto || 0), 0),
          ])
        );
        const nuevosGastosPorMetodo = { ...totalesGasto, [metodo]: monto };
        const gastosRearmados = METODOS.filter(m => nuevosGastosPorMetodo[m.key] > 0).map(m => {
          const previo = dia.gastos.find(g => g.caja === m.key);
          return {
            id: previo?.id || uid(),
            hora: nowStr(),
            fecha,
            concepto: previo?.concepto || "Gasto diario",
            monto: nuevosGastosPorMetodo[m.key],
            caja: m.key,
            categoria: previo?.categoria || "gasto diario",
          };
        });

        return { ...h, [fecha]: { ...dia, gastos: gastosRearmados } };
      });
    };

    // Estilos tabla
    const th = "border border-gray-700 text-center py-1 px-1 font-semibold";
    const td = "border border-gray-700/50 text-center font-mono py-1 px-0.5 text-xs";

    return (
      <div className="space-y-3">

        {/* Fecha única compartida */}
        <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">Fecha</span>
          <input type="date" value={fechaI} onChange={e=>{ setFechaI(e.target.value); setFechaG(e.target.value); }}
            className="bg-transparent text-white text-sm font-semibold focus:outline-none flex-1" />
          <button
            onClick={() => setShowFondo(v => !v)}
            className="text-xs text-orange-300 hover:text-orange-200 border border-orange-800/60 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            Fondo: {$(totalMenor)}
          </button>
          <button
            onClick={() => reiniciarFecha(fechaI)}
            className="text-xs text-red-400 hover:text-red-300 border border-red-800/60 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            Reiniciar Fecha
          </button>
        </div>

        {/* Layout: [ingresos | egresos] | ventas */}
        <div className="flex gap-2 overflow-x-auto pb-1">

          {/* Columna izquierda: ambas tablas + botón registrar */}
          <div className="shrink-0 flex flex-col gap-2" style={{width:360}}>
            <div className="flex gap-2">
              {[
                {
                  label:"Ingresos", color:"#6ee7b7",
                  rows:rowsI, upd:updI, add:addI, del:delI,
                  total:totalI, totRow:totIRow,
                  totalLabel:"Total ingresos", totalColor:"text-emerald-400",
                  rowBgEven:"#0d1a11", rowBgOdd:"#0a1208",
                  montoColor:"#6ee7b7", sinConcepto: true,
                },
                {
                  label:"Egresos", color:"#fca5a5",
                  rows:rowsG, upd:updG, add:addG, del:delG,
                  total:totalG, totRow:totGRow,
                  totalLabel:"Total egresos", totalColor:"text-red-400",
                  rowBgEven:"#1a0d0d", rowBgOdd:"#120a0a",
                  montoColor:"#fca5a5", sinConcepto: false,
                }
              ].map(cfg => (
                <div key={cfg.label} className="flex-1 min-w-0">
                  <div className="rounded-t-xl border border-gray-700 border-b-0 px-2 py-1.5 bg-gray-800 flex items-center justify-between">
                    <button
                      onClick={() => togglePanel(cfg.label)}
                      className="flex items-center gap-1"
                    >
                      <span className="text-xs font-bold uppercase tracking-wider" style={{color:cfg.color}}>{cfg.label}</span>
                      <Ic d={panelOpen[cfg.label] ? ICONS.up : ICONS.down} s={10} c={cfg.color} />
                    </button>
                    {cfg.total > 0 && <span className="text-xs font-mono" style={{color:cfg.color}}>{$(cfg.total)}</span>}
                  </div>
                  {panelOpen[cfg.label] && (
                  <>
                  <div className="border border-gray-700 rounded-b-xl overflow-hidden">
                    <table className="w-full border-collapse" style={{tableLayout:"fixed"}}>
                      <colgroup>
                        {cfg.sinConcepto
                          ? <><col style={{width:"55%"}}/><col style={{width:"45%"}}/></>
                          : <><col style={{width:"38%"}}/><col style={{width:"34%"}}/><col style={{width:"28%"}}/></>
                        }
                      </colgroup>
                      <thead>
                        <tr className="bg-gray-800/80">
                          {(cfg.sinConcepto ? ["MÉTODO","MONTO"] : ["MÉTODO","CONCEPTO","MONTO"]).map(h=>(
                            <th key={h} className="border-b border-r border-gray-700 last:border-r-0 text-left px-1.5 py-1 text-gray-500 font-medium" style={{fontSize:"9px"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cfg.rows.map((r,i)=>{
                          const m=METODOS.find(x=>x.key===r.caja)||METODOS[0];
                          return (
                            <tr key={r.id} className="group border-b border-gray-700/30 last:border-b-0 hover:bg-gray-800/30 transition-colors"
                              style={{background:i%2===0?cfg.rowBgEven:cfg.rowBgOdd}}>
                              <td className="border-r border-gray-700/40 px-0.5 py-0.5">
                                <select value={r.caja} onChange={e=>cfg.upd(r.id,"caja",e.target.value)}
                                  className="w-full bg-transparent focus:outline-none cursor-pointer" style={{color:m.color,fontSize:"10px"}}>
                                  {METODOS.map(mt=><option key={mt.key} value={mt.key} style={{background:"#1f2937",color:mt.color}}>{mt.label.slice(0,6)}</option>)}
                                </select>
                              </td>
                              {!cfg.sinConcepto && (
                                <td className="border-r border-gray-700/40 px-0.5 py-0.5">
                                  <input className="w-full bg-transparent text-gray-200 focus:outline-none placeholder-gray-700"
                                    style={{fontSize:"10px"}} placeholder="concepto…"
                                    value={r.concepto} onChange={e=>cfg.upd(r.id,"concepto",e.target.value)}/>
                                </td>
                              )}
                              <td className="px-0.5 py-0.5 relative">
                                <input type="text" inputMode="numeric"
                                  className="w-full bg-transparent font-mono text-right focus:outline-none placeholder-gray-700"
                                  style={{fontSize:"10px",color:r.monto?cfg.montoColor:undefined}}
                                  placeholder="$ 0"
                                  value={formatMoneyInput(r.monto)}
                                  onChange={e=>cfg.upd(r.id,"monto",parseMoneyInput(e.target.value))}/>
                                <button onClick={()=>cfg.del(r.id)}
                                  className="absolute right-0 top-0 bottom-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all pr-0.5">
                                  <Ic d={ICONS.trash} s={9}/>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-600 bg-gray-800/80">
                          <td colSpan={cfg.sinConcepto ? 1 : 2} className="border-r border-gray-700/50 px-1.5 py-1 font-bold text-gray-400" style={{fontSize:"9px"}}>{cfg.totalLabel}</td>
                          <td className={`px-1.5 py-1 text-right font-bold font-mono ${cfg.totalColor}`} style={{fontSize:"10px"}}>{cfg.total>0?$(cfg.total):"—"}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {/* Totales por caja */}
                  {METODOS.some(m=>cfg.totRow[m.key]>0) && (
                    <div className="mt-1 border border-gray-700 rounded-xl overflow-hidden">
                      {METODOS.filter(m=>cfg.totRow[m.key]>0).map((m,i)=>(
                        <div key={m.key} className="flex items-center justify-between px-2 py-0.5 border-b border-gray-700/30 last:border-b-0"
                          style={{background:i%2===0?"#111827":"#0f172a"}}>
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full" style={{background:m.color}}/>
                            <span style={{color:m.color,fontSize:"9px"}}>{m.label}</span>
                          </div>
                          <span className="font-mono font-bold" style={{fontSize:"9px",color:cfg.montoColor}}>{$(cfg.totRow[m.key])}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={cfg.add} className="w-full mt-1 text-gray-600 hover:text-gray-400 border border-gray-700/50 py-1 rounded-lg transition-colors flex items-center justify-center gap-1" style={{fontSize:"10px"}}>
                    <Ic d={ICONS.plus} s={10}/> fila
                  </button>
                  </>
                  )}
                </div>
              ))}
            </div>

            {/* Botón Registrar — debajo de ambas tablas, ancho completo */}
            <button onClick={registrarTodo} disabled={!hayI && !hayG}
              className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2
                ${(hayI||hayG) ? "bg-blue-700 hover:bg-blue-600 text-white" : "bg-gray-800 text-gray-600 cursor-not-allowed border border-gray-700"}`}>
              <Ic d={ICONS.check} s={15} c={(hayI||hayG)?"#fff":"#4b5563"}/> Registrar
            </button>

            {/* ── GASTOS INTERNOS ── */}
            <div className="mt-1">
              <div className="rounded-t-xl border border-gray-700 border-b-0 px-2 py-1.5 bg-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-400">Gastos Internos</span>
                  <span className="text-xs font-mono text-gray-500" style={{color:"#10b981"}}>Efectivo</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {totalGI > 0 && <span className="text-xs font-mono text-orange-400">{$(totalGI)}</span>}
                  <button onClick={limpiarGI} className="text-gray-600 hover:text-orange-400 transition-colors" title="Limpiar">
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div className="border border-gray-700 rounded-b-xl overflow-hidden">
                <table className="w-full border-collapse" style={{tableLayout:"fixed"}}>
                  <colgroup><col style={{width:"30%"}}/><col style={{width:"45%"}}/><col style={{width:"25%"}}/></colgroup>
                  <thead>
                    <tr className="bg-gray-800/80">
                      {["MÉTODO","CONCEPTO","MONTO"].map(h=>(
                        <th key={h} className="border-b border-r border-gray-700 last:border-r-0 text-left px-1.5 py-1 text-gray-500 font-medium" style={{fontSize:"9px"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsGI.map((r,i)=>(
                      <tr key={r.id} className="group border-b border-gray-700/30 last:border-b-0 hover:bg-gray-800/30 transition-colors"
                        style={{background:i%2===0?"#1a1100":"#120d00"}}>
                        <td className="border-r border-gray-700/40 px-1.5 py-0.5">
                          <span style={{color:"#10b981", fontSize:"10px"}} className="font-medium">Efectivo</span>
                        </td>
                        <td className="border-r border-gray-700/40 px-0.5 py-0.5">
                          <input className="w-full bg-transparent text-gray-200 focus:outline-none placeholder-gray-700"
                            style={{fontSize:"10px"}} placeholder="concepto…"
                            value={r.concepto} onChange={e=>updGI(r.id,"concepto",e.target.value)}/>
                        </td>
                        <td className="px-0.5 py-0.5 relative">
                          <input type="text" inputMode="numeric"
                            className="w-full bg-transparent font-mono text-right focus:outline-none placeholder-gray-700"
                            style={{fontSize:"10px", color:r.monto?"#fb923c":undefined}}
                            placeholder="$ 0"
                            value={formatMoneyInput(r.monto)}
                            onChange={e=>updGI(r.id,"monto",parseMoneyInput(e.target.value))}/>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-600 bg-gray-800/80">
                      <td colSpan={2} className="border-r border-gray-700/50 px-1.5 py-1 font-bold text-gray-400" style={{fontSize:"9px"}}>Total gastos internos</td>
                      <td className="px-1.5 py-1 text-right font-bold font-mono text-orange-400" style={{fontSize:"10px"}}>{totalGI>0?$(totalGI):"—"}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <button onClick={addGI} className="w-full mt-1 text-gray-600 hover:text-orange-400 border border-gray-700/50 py-1 rounded-lg transition-colors flex items-center justify-center gap-1" style={{fontSize:"10px"}}>
                <Ic d={ICONS.plus} s={10}/> fila
              </button>
            </div>
          </div>

          {/* ── DERECHA: VENTAS ── */}
          <div className="flex-1 min-w-0" style={{minWidth:320}}>

            {/* Header */}
            <div className="rounded-t-xl border border-gray-700 border-b-0 px-2 py-1.5 bg-gray-800 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider shrink-0">Ventas del Mes</span>
              <input type="month" value={mesFiltro} onChange={e=>setMesFiltro(e.target.value)}
                className="bg-transparent text-gray-400 focus:outline-none text-right"
                style={{fontSize:"10px", maxWidth:100}}/>
              <button
                onClick={()=>{
                  if (!filasVentas.length) return;
                  const nombreMes = new Date(mesFiltro+"-01T12:00:00").toLocaleDateString("es-CO",{month:"long",year:"numeric"});
                  setMesesGuardados(mg=>({
                    ...mg,
                    [mesFiltro]: {
                      mes: mesFiltro,
                      nombre: nombreMes,
                      savedAt: new Date().toLocaleString("es-CO"),
                      filas: filasVentas,
                      totV: {...totV},
                      totG: {...totG},
                      diasHistorial: Object.fromEntries(
                        Object.entries(historial).filter(([f])=>f.startsWith(mesFiltro))
                      ),
                    }
                  }));
                  setTab("historial");
                }}
                disabled={!filasVentas.length}
                className={`shrink-0 px-2 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1
                  ${filasVentas.length ? "bg-emerald-700 hover:bg-emerald-600 text-white" : "bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed"}`}>
                <Ic d={ICONS.check} s={11} c={filasVentas.length?"#fff":"#4b5563"}/> Guardar
              </button>
            </div>

            <div className="border border-gray-700 rounded-b-xl overflow-hidden overflow-x-auto">
              <table className="border-collapse" style={{tableLayout:"fixed", width:"100%", minWidth:320}}>
                <colgroup>
                  <col style={{width:58}}/>
                  <col style={{width:18}}/>
                  {METODOS.map(m=><col key={m.key} style={{width:54}}/>)}
                </colgroup>
                <thead>
                  <tr className="bg-gray-800/80 border-b border-gray-700">
                    <th className="border-r border-gray-700 text-left px-1.5 py-1 text-gray-500 font-medium" style={{fontSize:"9px"}}>FECHA</th>
                    <th className="border-r border-gray-700 text-center px-0 py-1 text-gray-600 font-medium" style={{fontSize:"9px"}}></th>
                    {METODOS.map(m=>(
                      <th key={m.key} className="border-r border-gray-700 last:border-r-0 text-center py-1 px-0.5">
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="w-1.5 h-1.5 rounded-full" style={{background:m.color}}/>
                          <span style={{color:m.color,fontSize:"9px"}} className="font-semibold uppercase leading-none">
                            {m.key==="bancolombia"?"Banco":m.key==="aliados"?"Aliad":m.label.slice(0,5)}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filasVentas.length===0 ? (
                    <tr style={{background:"#0f172a"}}>
                      <td colSpan={METODOS.length+2} className="py-6 text-center text-gray-600 text-xs">Sin registros</td>
                    </tr>
                  ) : (() => {
                    // Agrupar pares por fecha para aplicar rowspan y bordes
                    let lastFecha = null;
                    return filasVentas.map((fila, i) => {
                      const isIngreso = fila.tipo === "ingreso";
                      const isNewFecha = fila.fecha !== lastFecha;
                      if (isIngreso) lastFecha = fila.fecha;
                      const bg = isIngreso ? "#0d1f0d" : "#1f0d0d";
                      return (
                        <tr key={`${fila.fecha}-${fila.tipo}`}
                          className={`border-b ${isIngreso ? "border-gray-700/60" : "border-gray-700/20"} last:border-b-0 hover:brightness-125 transition-all`}
                          style={{background:bg}}>
                          {/* Fecha/Día — ingreso muestra nombre del día, egreso muestra fecha */}
                          <td className="border-r border-gray-700/50 px-1 py-0.5">
                            {isIngreso ? (
                              <div className="text-emerald-400 font-semibold" style={{fontSize:"9px"}}>
                                {fila.label}
                              </div>
                            ) : (
                              <div className="text-gray-500 font-mono" style={{fontSize:"9px"}}>
                                {fila.label}
                              </div>
                            )}
                          </td>
                          {/* Etiqueta ↑/↓ */}
                          <td className="border-r border-gray-700/50 text-center px-0 py-0.5">
                            <span style={{fontSize:"9px"}} className={isIngreso?"text-emerald-500":"text-red-500"}>
                              {isIngreso?"↑":"↓"}
                            </span>
                          </td>
                          {/* Valores por método */}
                          {METODOS.map(m=>{
                            const val = fila.vals[m.key]||0;
                            return (
                              <td key={m.key} className="border-r border-gray-700/30 last:border-r-0 px-0.5 py-0.5">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="w-full bg-transparent text-center font-mono focus:outline-none"
                                  style={{fontSize:"10px", color: val>0?(isIngreso?"#6ee7b7":"#fca5a5"):"#6b7280"}}
                                  value={formatMoneyInput(val)}
                                  placeholder="$ 0"
                                  onChange={e => editarMontoDiario(fila.fecha, fila.tipo, m.key, parseMoneyInput(e.target.value))}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  })()}

                  {/* Filas vacías */}
                  {Array.from({length:Math.max(0,10-filasVentas.length)}).map((_,i)=>(
                    <tr key={`empty${i}`} style={{background:i%2===0?"#0f172a":"#111827"}}>
                      <td className="border-r border-gray-700/30 py-1" style={{height:18}}/>
                      <td className="border-r border-gray-700/30"/>
                      {METODOS.map(m=><td key={m.key} className="border-r border-gray-700/20 last:border-r-0"/>)}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* Ingresos totales */}
                  <tr className="border-t-2 border-gray-600 bg-emerald-900/20">
                    <td className="border-r border-gray-700/50 px-1 py-1 text-emerald-400 font-bold" style={{fontSize:"9px"}}>Total Ingresos</td>
                    <td className="border-r border-gray-700/50 text-center" style={{fontSize:"9px"}}><span className="text-emerald-500">↑</span></td>
                    {METODOS.map(m=>(
                      <td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold"
                        style={{fontSize:"10px",color:totV[m.key]>0?"#6ee7b7":"#374151"}}>
                        {totV[m.key]>0?fmtK(totV[m.key]):"—"}
                      </td>
                    ))}
                  </tr>
                  {/* Egresos totales */}
                  <tr className="border-t border-gray-700/50 bg-red-900/20">
                    <td className="border-r border-gray-700/50 px-1 py-1 text-red-400 font-bold" style={{fontSize:"9px"}}>Total Egresos</td>
                    <td className="border-r border-gray-700/50 text-center" style={{fontSize:"9px"}}><span className="text-red-500">↓</span></td>
                    {METODOS.map(m=>(
                      <td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold"
                        style={{fontSize:"10px",color:totG[m.key]>0?"#fca5a5":"#374151"}}>
                        {totG[m.key]>0?fmtK(totG[m.key]):"—"}
                      </td>
                    ))}
                  </tr>
                  {/* Total Saldo */}
                  <tr className="border-t-2 border-gray-500 bg-gray-800/80">
                    <td className="border-r border-gray-700/50 px-1 py-1 text-white font-bold" style={{fontSize:"9px"}}>Total Saldo</td>
                    <td className="border-r border-gray-700/50 text-center" style={{fontSize:"9px"}}><span className="text-blue-400">=</span></td>
                    {METODOS.map(m=>{
                      const n=(totV[m.key]||0)-(totG[m.key]||0);
                      return (
                        <td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold"
                          style={{fontSize:"10px",color:n>0?"#93c5fd":n<0?"#f87171":"#374151"}}>
                          {n!==0?fmtK(n):"—"}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Saldo total global */}
                  {(() => {
                    const totalIngr = METODOS.reduce((a,m)=>a+(totV[m.key]||0),0);
                    const totalEgr  = METODOS.reduce((a,m)=>a+(totG[m.key]||0),0);
                    const saldo = totalIngr - totalEgr;
                    return (
                      <tr className="border-t border-blue-800/50 bg-blue-950/40">
                        <td colSpan={2} className="border-r border-gray-700/50 px-1 py-1 text-blue-300 font-bold" style={{fontSize:"9px"}}>
                          Saldo Total
                        </td>
                        <td colSpan={METODOS.length} className="px-2 py-1 text-right font-mono font-bold"
                          style={{fontSize:"11px", color: saldo>0?"#93c5fd":saldo<0?"#f87171":"#374151"}}>
                          {saldo!==0 ? fmtK(saldo) : "—"}
                        </td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>

            {/* ── CALCULADORA BILLETES Y MONEDAS ── */}
            {showFondo && (
            <div className="mt-2 border border-gray-700 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="border-collapse" style={{tableLayout:"fixed", minWidth:"100%"}}>
                  <colgroup>
                    {DENOMS.map(d=><col key={d} style={{width:62}}/>)}
                    <col style={{width:72}}/>
                  </colgroup>
                  <thead>
                    <tr style={{background:"#7c3500"}}>
                      {DENOMS.map(d=>(
                        <th key={d} className="border-r border-orange-900/50 last:border-r-0 text-center py-1 px-0.5 font-bold"
                          style={{fontSize:"9px",color:"#fed7aa"}}>
                          {fmtDenom(d)}
                        </th>
                      ))}
                      <th className="text-center py-1 px-1 font-bold" style={{fontSize:"9px",color:"#fed7aa",background:"#5c2800"}}>MONEDAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{background:"#374151"}}>
                      {DENOMS.map(d=>(
                        <td key={d} className="border-r border-gray-600/50 last:border-r-0 px-0.5 py-0.5">
                          <input type="number" inputMode="numeric" min="0"
                            className="w-full bg-transparent text-center font-mono focus:outline-none text-white placeholder-gray-500"
                            style={{fontSize:"10px"}} placeholder="0"
                            value={conteoLocal[d]||""}
                            onChange={e=>setConteoLocal(c=>({...c,[d]:+e.target.value||0}))}/>
                        </td>
                      ))}
                      <td className="px-0.5 py-0.5" style={{background:"#4b3000"}}>
                        <input type="number" inputMode="numeric" min="0"
                          className="w-full bg-transparent text-center font-mono focus:outline-none text-orange-300 placeholder-orange-900"
                          style={{fontSize:"10px"}} placeholder="0"
                          value={conteoLocal["extra"]||""}
                          onChange={e=>setConteoLocal(c=>({...c,extra:+e.target.value||0}))}/>
                      </td>
                    </tr>
                    <tr style={{background:"#92400e"}}>
                      {DENOMS.map(d=>{
                        const sub=d*(conteoLocal[d]||0);
                        return (
                          <td key={d} className="border-r border-orange-900/50 last:border-r-0 text-center py-1 px-0.5 font-mono font-bold"
                            style={{fontSize:"9px",color:sub>0?"#fff":"#a16207"}}>
                            {sub>0?fmtVal(sub):"$0"}
                          </td>
                        );
                      })}
                      <td className="text-right px-1 py-1 font-mono font-bold" style={{fontSize:"10px",color:conteoLocal["extra"]>0?"#fff":"#a16207",background:"#6b2a00"}}>
                        {conteoLocal["extra"]>0?fmtVal(conteoLocal["extra"]):"$0"}
                      </td>
                    </tr>
                    <tr style={{background:"#7c2d12"}}>
                      <td colSpan={DENOMS.length} className="border-r border-orange-900/50 px-2 py-1 text-orange-200 font-bold text-right" style={{fontSize:"9px"}}>
                        TOTAL
                      </td>
                      <td className="px-1 py-1" style={{fontSize:"12px"}}>
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono font-bold text-white">{fmtVal(totalConteo)||"$0"}</span>
                          <button
                            onClick={guardarConteoNaranja}
                            className="px-1.5 py-0.5 rounded bg-orange-700 hover:bg-orange-600 text-white text-[9px] font-semibold leading-none"
                          >
                            {savedConteoMsg ? "Guardado" : "Guardar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            )}

          </div>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-gray-950 text-white" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-gray-950/95 border-b border-gray-800 px-4 py-3 flex items-center justify-between" style={{ backdropFilter: "blur(10px)" }}>
        <div className="flex items-center gap-2">
          <img src="/Financex.png" alt="FinanceX" className="w-7 h-7 rounded-lg object-cover border border-gray-700" />
          <span className="text-sm font-bold text-white">FinanceX</span>
          <span className="text-xs text-gray-600 ml-1">{new Date().toLocaleDateString("es-CO", { day:"numeric", month:"short" })}</span>
          <span className="text-xs text-gray-500 ml-2">{syncStatus}</span>
        </div>
        <div className="flex items-center gap-3">
          {canInstallApp && (
            <button
              onClick={instalarApp}
              className="text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-800/60 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              Instalar App
            </button>
          )}
          <button
            onClick={reiniciarTodo}
            className="text-xs text-red-400 hover:text-red-300 border border-red-800/60 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            Reiniciar Todo
          </button>
          <div className="text-xs text-gray-500 font-mono">
            Neto: <span className={saldoTotalGlobal >= 0 ? "text-emerald-400" : "text-red-400"}>{$(saldoTotalGlobal)}</span>
          </div>
        </div>
      </header>

      <div className="px-2 py-3 mx-auto w-full max-w-7xl">
        <div className="flex gap-3 items-start">
          {/* TABS LATERAL COLAPSABLE */}
          <aside className={`${sidebarCollapsed ? 'w-16' : 'w-36'} shrink-0 sticky top-[64px] transition-all`}>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex flex-col">
              <button
                onClick={() => setSidebarCollapsed(c => !c)}
                className="w-full flex items-center justify-center py-2 border-b border-gray-800 text-gray-400 hover:text-white transition-colors"
                style={{ fontSize: '16px' }}
              >
                <Ic d={sidebarCollapsed ? ICONS.right : ICONS.left} s={18} />
              </button>
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-start'} px-3 py-3 text-xs font-semibold transition-all border-l-2 ${
                    tab === t.id
                      ? "border-blue-500 bg-blue-950/40 text-white"
                      : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/70"
                  }`}
                  style={{ minHeight: '48px' }}
                >
                  <Ic d={TAB_ICONS[t.id]} s={18} c={tab === t.id ? '#3b82f6' : '#6b7280'} />
                  {!sidebarCollapsed && <span className="ml-2">{t.label}</span>}
                </button>
              ))}
            </div>
          </aside>

          {/* CONTENT */}
          <main className="flex-1 min-w-0 pb-8">
            {tab === "cajaDiaria" && <ViewCajaDiaria />}
            {tab === "historial"  && <ViewHistorial />}
          </main>
        </div>
      </div>

      {/* ═══ SHEET UNIFICADO ══════════════════════════════════════════════ */}
      {sheetVenta && (
        <Sheet title="Registrar Movimientos" onClose={() => setSheetVenta(false)}>
          <div className="space-y-3">

            {/* Fecha + Concepto */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Lbl>Fecha</Lbl>
                <input type="date" className={inp} value={fVenta.fecha || TODAY}
                  onChange={e => setFVenta(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <Lbl>Concepto</Lbl>
                <input className={inp} placeholder="Cierre del día..." value={fVenta.concepto}
                  onChange={e => setFVenta(p => ({ ...p, concepto: e.target.value }))} />
              </div>
            </div>

            {/* Tabla unificada ingresos + egresos */}
            <div className="rounded-xl border border-gray-700 overflow-hidden">

              {/* Headers de columnas */}
              <div className="grid border-b border-gray-700 bg-gray-800/80"
                style={{ gridTemplateColumns: `64px repeat(${METODOS.length}, 1fr)` }}>
                <div className="py-1.5 px-2 border-r border-gray-700" />
                {METODOS.map(m => (
                  <div key={m.key} className="flex flex-col items-center py-1.5 px-1 border-r border-gray-700 last:border-r-0">
                    <div className="w-1.5 h-1.5 rounded-full mb-0.5" style={{ background: m.color }} />
                    <span style={{ color: m.color, fontSize: "10px" }} className="font-semibold leading-none">
                      {m.key === "bancolombia" ? "Banco" : m.key === "aliados" ? "Aliad" : m.label.slice(0, 5)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Fila INGRESOS */}
              <div className="grid border-b border-gray-700"
                style={{ gridTemplateColumns: `64px repeat(${METODOS.length}, 1fr)` }}>
                <div className="flex items-center justify-center border-r border-gray-700 py-2 px-1 bg-emerald-900/30">
                  <span className="text-emerald-400 font-bold leading-none" style={{ fontSize: "10px", writingMode: "horizontal-tb" }}>↑ Ingreso</span>
                </div>
                {METODOS.map(m => (
                  <div key={m.key} className="border-r border-gray-700 last:border-r-0" style={{ background: m.bg + "55" }}>
                    <input type="number" inputMode="numeric"
                      className="w-full bg-transparent text-emerald-300 text-xs font-mono text-center py-2.5 px-0.5 focus:outline-none placeholder-gray-700 focus:bg-emerald-900/20"
                      placeholder="0" value={fVenta[m.key] || ""}
                      onChange={e => setFVenta(p => ({ ...p, [m.key]: e.target.value }))} />
                  </div>
                ))}
              </div>

              {/* Fila EGRESOS */}
              <div className="grid" style={{ gridTemplateColumns: `64px repeat(${METODOS.length}, 1fr)` }}>
                <div className="flex items-center justify-center border-r border-gray-700 py-2 px-1 bg-red-900/30">
                  <span className="text-red-400 font-bold leading-none" style={{ fontSize: "10px" }}>↓ Egreso</span>
                </div>
                {METODOS.map(m => (
                  <div key={m.key} className="border-r border-gray-700 last:border-r-0" style={{ background: m.bg + "33" }}>
                    <input type="number" inputMode="numeric"
                      className="w-full bg-transparent text-red-300 text-xs font-mono text-center py-2.5 px-0.5 focus:outline-none placeholder-gray-700 focus:bg-red-900/20"
                      placeholder="0" value={fGasto[`monto_${m.key}`] || ""}
                      onChange={e => setFGasto(p => ({ ...p, [`monto_${m.key}`]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>

            {/* Concepto gasto + categoría — solo si hay algún egreso */}
            {METODOS.some(m => +fGasto[`monto_${m.key}`] > 0) && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Lbl>Concepto egreso</Lbl>
                  <input className={inp} placeholder="Ej: Domicilio, turno..." value={fGasto.concepto}
                    onChange={e => setFGasto(p => ({ ...p, concepto: e.target.value }))} />
                </div>
                <div>
                  <Lbl>Categoría</Lbl>
                  <select className={inp} value={fGasto.categoria} onChange={e => setFGasto(p => ({ ...p, categoria: e.target.value }))}>
                    {["domicilio","turno","insumo","servicio","nómina","arriendo","publicidad","otro"].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Resumen neto */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Ingresos", val: METODOS.reduce((a, m) => a + (+fVenta[m.key] || 0), 0), color: "text-emerald-400" },
                { label: "Egresos",  val: METODOS.reduce((a, m) => a + (+fGasto[`monto_${m.key}`] || 0), 0), color: "text-red-400" },
                { label: "Neto",     val: METODOS.reduce((a, m) => a + (+fVenta[m.key] || 0) - (+fGasto[`monto_${m.key}`] || 0), 0),
                  color: METODOS.reduce((a, m) => a + (+fVenta[m.key] || 0) - (+fGasto[`monto_${m.key}`] || 0), 0) >= 0 ? "text-blue-400" : "text-red-400" },
              ].map(x => (
                <div key={x.label} className="bg-gray-800 border border-gray-700 rounded-xl p-2.5 text-center">
                  <div className="text-xs text-gray-500 mb-0.5">{x.label}</div>
                  <div className={`font-mono font-bold text-xs ${x.color}`}>{$(x.val)}</div>
                </div>
              ))}
            </div>

            <button onClick={() => {
              const totalIngreso = METODOS.reduce((a, m) => a + (+fVenta[m.key] || 0), 0);
              const totalEgreso  = METODOS.reduce((a, m) => a + (+fGasto[`monto_${m.key}`] || 0), 0);
              if (!totalIngreso && !totalEgreso) return;
              const fecha = fVenta.fecha || TODAY;
              setHistorial(h => {
                const dia = h[fecha] || { ventas: [], gastos: [] };
                const nuevasVentas = totalIngreso > 0
                  ? [...dia.ventas, { id: uid(), hora: nowStr(), fecha, concepto: fVenta.concepto || "Ventas del día", ...Object.fromEntries(METODOS.map(m => [m.key, +fVenta[m.key] || 0])), total: totalIngreso }]
                  : dia.ventas;
                const nuevosGastos = METODOS.filter(m => +fGasto[`monto_${m.key}`] > 0).reduce((arr, m) => [
                  ...arr,
                  { id: uid(), hora: nowStr(), fecha, concepto: fGasto.concepto || "Egreso", monto: +fGasto[`monto_${m.key}`], caja: m.key, categoria: fGasto.categoria }
                ], dia.gastos);
                return { ...h, [fecha]: { ventas: nuevasVentas, gastos: nuevosGastos } };
              });
              setFVenta({ concepto: "", fecha: TODAY, ...Object.fromEntries(METODOS.map(m => [m.key, ""])) });
              setFGasto({ concepto: "", monto: "", caja: "efectivo", categoria: "domicilio" });
              setSheetVenta(false);
            }} className="w-full py-3 rounded-xl text-sm font-semibold bg-blue-700 hover:bg-blue-600 text-white transition-all">
              <span className="flex items-center justify-center gap-2"><Ic d={ICONS.check} s={15} /> Guardar</span>
            </button>

          </div>
        </Sheet>
      )}
    </div>
  );
}
