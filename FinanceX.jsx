import { useEffect, useMemo, useRef, useState } from "react";
import { collection, addDoc, doc, deleteDoc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./src/firebase.js";
import ViewMetricas from "./src/ViewMetricas.jsx";
import * as XLSX from "xlsx";

// ── UTILS ─────────────────────────────────────────────────────────────────────
const STORAGE_KEY = "financex_app_data_v1";
const _fmtCOP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const _fmtNum = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const $ = (n) => _fmtCOP.format(n || 0);
const formatMoneyInput = (v) => {
  if (v === "" || v === null || typeof v === "undefined") return "";
  const n = +v || 0;
  if (!n) return "";
  return `$ ${_fmtNum.format(n)}`;
};
const parseMoneyInput = (raw) => {
  const clean = String(raw || "").replace(/[^\d]/g, "");
  return clean ? +clean : 0;
};
const uid = () => Math.random().toString(36).slice(2);

// Normaliza texto: primera letra mayúscula, resto minúsculas, trim
const normalizar = (texto) => {
  if (!texto) return texto;
  const t = texto.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};

// Detección fuzzy de conceptos similares (typos, plurales, tildes, guiones)
const sinTildes = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[-\s]+/g,' ').trim();
const levenshtein = (a, b) => {
  const m=a.length, n=b.length;
  if(!m) return n; if(!n) return m;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
};
const conceptoSimilar = (texto, lista) => {
  if(!texto?.trim() || !lista?.length) return null;
  const a = sinTildes(texto);
  let mejor=null, mejorDist=Infinity;
  for(const c of lista){
    const b = sinTildes(c);
    if(a===b) return null; // idéntico normalizado → sin aviso
    const dist = levenshtein(a, b);
    const maxD = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.35));
    if(dist<=maxD && dist<mejorDist){ mejor=c; mejorDist=dist; }
  }
  return mejor;
};

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

const CATEGORIAS_EGRESO = ["Insumos", "Nómina", "Servicios Públicos", "Marketing", "Mantenimiento", "Otros"];

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
  pencil: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  cashRegister: "M4 4h16v2H4V4zm2 2v2h12V6H6zm0 4v8h12v-8H6zm2 2h8v4H8v-4zM8 14v2h8v-2H8z", // caja registradora
  notebook: "M4 4h12v16H4V4zm2 2v12h8V6H6zm10 0v14H6v2h10V6z", // libreta
};

const Pill = ({ label, color, bg }) => (
  <span style={{ color, background: bg + "99", border: `1px solid ${color}33` }}
    className="text-xs px-2 py-0.5 rounded-full font-medium">{label}</span>
);

// Modal bottom-sheet
const Sheet = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    onClick={onClose}>
    <div className="rounded-t-2xl border-t border-gray-800/60 max-h-[85vh] overflow-y-auto" style={{background:"#16161D"}}
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
const inp = "w-full bg-[#16161D] border border-gray-800/40 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/70 focus:ring-2 focus:ring-orange-500/15 transition-all placeholder-gray-600";
// ════════════════════════════════════════════════════════════════════════════
// APP
// ════════════════════════════════════════════════════════════════════════════
export default function FinanceX() {
    // ...existing code...
  const [tab, setTab] = useState("cajaDiaria");
  const [isFirestoreReady, setIsFirestoreReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Cargando nube...");
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [canInstallApp, setCanInstallApp] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);

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
  const [mostrarRecuperar, setMostrarRecuperar] = useState(false);
  const [backup, setBackup] = useState(null);
  const [sincroBloqueada, setSincroBloqueada] = useState(false);
  const lastSavedAt = useRef(null); // evita bucle infinito onSnapshot ↔ setDoc
  const isSaving = useRef(false); // flag: estamos escribiendo en Firestore ahora mismo
  const [mostrarVisualizador, setMostrarVisualizador] = useState(false);

  // Sheets
  const [sheetVenta, setSheetVenta] = useState(false);
  const [sheetGasto, setSheetGasto] = useState(false);

  // Forms
  const [fVenta, setFVenta] = useState({ concepto: "", fecha: todayStr(), ...Object.fromEntries(METODOS.map(m => [m.key, ""])) });
  const [fGasto, setFGasto] = useState({ concepto: "", monto: "", caja: "efectivo", categoria: "Otros", descripcion: "" });

  const TODAY = todayStr();
  const BACKUP_KEY = "financex_backup_datos";

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
  const netoTotal = useMemo(() => granTotal - totGastos, [granTotal, totGastos]);

  // Saldo histórico acumulado (ingresos - egresos de todos los días)
  const saldoHistorico = useMemo(() => {
    let totalIngresos = 0;
    let totalEgresos = 0;
    Object.values(historial).forEach(dia => {
      METODOS.forEach(m => {
        totalIngresos += dia.ventas?.reduce((a, v) => a + (+v[m.key] || 0), 0) || 0;
      });
      totalEgresos += dia.gastos?.reduce((a, g) => a + (+g.monto || 0), 0) || 0;
    });
    return totalIngresos - totalEgresos;
  }, [historial]);
  const saldoTotalGlobal = useMemo(
    () =>
      Object.values(historial).reduce((acc, dia) => {
        const ventasDia = (dia.ventas || []).reduce((a, v) => a + METODOS.reduce((s, m) => s + (+v[m.key] || 0), 0), 0);
        const gastosDia = (dia.gastos || []).reduce((a, g) => a + (+g.monto || 0), 0);
        return acc + ventasDia - gastosDia;
      }, 0),
    [historial]
  );

  // Saldo solo del mes actual (para Neto en header)
  const saldoMesActual = useMemo(() => {
    const mesActual = todayStr().slice(0, 7);
    return Object.entries(historial)
      .filter(([f]) => f.startsWith(mesActual))
      .reduce((acc, [, dia]) => {
        const ingr = (dia.ventas || []).reduce((a, v) => a + METODOS.reduce((s, m) => s + (+v[m.key] || 0), 0), 0);
        const egr  = (dia.gastos || []).reduce((a, g) => a + (+g.monto || 0), 0);
        return acc + ingr - egr;
      }, 0);
  }, [historial]);

  const recuperarDatos = () => {
    if (!backup) return;
    
    if (backup.historial) setHistorial(backup.historial);
    if (backup.mesesGuardados) setMesesGuardados(backup.mesesGuardados);
    if (backup.conteo) setConteo({ ...conteoInicial(), ...backup.conteo });
    
    setSincroBloqueada(false);
    setMostrarRecuperar(false);
  };

  const descargarBackup = async () => {
    if (exportingBackup) return;
    setExportingBackup(true);
    try {
    // Intentar obtener datos frescos desde Firestore para máxima completitud
    let datosHistorial = historial;
    let datosMeses = mesesGuardados;
    try {
      const snap = await getDoc(doc(db, "financex", "appData"));
      if (snap.exists()) {
        const d = snap.data();
        if (d.historial && Object.keys(d.historial).length >= Object.keys(historial).length) {
          datosHistorial = d.historial;
        }
        if (d.mesesGuardados) datosMeses = d.mesesGuardados;
      }
    } catch (_) { /* usar datos locales */ }

    // Hoja 1: Resumen general
    const totalIngr = Object.values(datosHistorial).reduce((a, dia) =>
      a + METODOS.reduce((b, m) => b + dia.ventas.reduce((s, v) => s + (+v[m.key] || 0), 0), 0), 0);
    const totalEgr = Object.values(datosHistorial).reduce((a, dia) =>
      a + dia.gastos.reduce((s, g) => s + (+g.monto || 0), 0), 0);
    const resumen = [{
      "Período": "RESUMEN GENERAL",
      "Total Días": Object.keys(datosHistorial).length,
      "Total Meses": Object.keys(datosMeses).length,
      "Total Ingresos": totalIngr,
      "Total Egresos": totalEgr,
      "Saldo General": totalIngr - totalEgr,
      "Generado": new Date().toLocaleString('es-CO'),
    }];

    // Hoja 2: Historial diario resumido
    const filasHistorial = Object.entries(datosHistorial)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, dia]) => {
        const ingresos = METODOS.reduce((a, m) => a + dia.ventas.reduce((s, v) => s + (+v[m.key] || 0), 0), 0);
        const egresos = dia.gastos.reduce((s, g) => s + (+g.monto || 0), 0);
        return {
          "Fecha": fecha,
          "Ingresos": ingresos,
          "Egresos": egresos,
          "Saldo": ingresos - egresos,
          "# Movimientos": (dia.ventas?.length || 0) + (dia.gastos?.length || 0),
        };
      });

    // Hoja 3: TODOS los movimientos con campos completos
    const filasMovimientos = [];
    Object.entries(datosHistorial)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([fecha, dia]) => {
        dia.ventas?.forEach(v => {
          METODOS.forEach(m => {
            const monto = +v[m.key] || 0;
            if (monto > 0) {
              filasMovimientos.push({
                "Fecha": fecha,
                "Hora": v.hora || "-",
                "Tipo": "Ingreso",
                "Categoría": "Venta",
                "Descripción": v.concepto || "-",
                "Método": m.label,
                "Monto": monto,
              });
            }
          });
        });
        dia.gastos?.forEach(g => {
          filasMovimientos.push({
            "Fecha": fecha,
            "Hora": g.hora || "-",
            "Tipo": "Egreso",
            "Categoría": g.categoria || "-",
            "Descripción": g.concepto || "-",
            "Método": METODOS.find(m => m.key === g.caja)?.label || g.caja || "-",
            "Monto": g.monto || 0,
          });
        });
      });

    // Hoja 4: Detalle por método de pago
    const filasMetodos = [];
    Object.entries(datosHistorial).forEach(([fecha, dia]) => {
      METODOS.forEach(m => {
        const ventas = dia.ventas.reduce((a, v) => a + (+v[m.key] || 0), 0);
        const gastos = dia.gastos.filter(g => g.caja === m.key).reduce((a, g) => a + (+g.monto || 0), 0);
        if (ventas > 0 || gastos > 0) {
          filasMetodos.push({
            "Fecha": fecha, "Método": m.label,
            "Ingresos": ventas, "Egresos": gastos, "Neto": ventas - gastos,
          });
        }
      });
    });

    const ws1 = XLSX.utils.json_to_sheet(resumen);
    const ws2 = XLSX.utils.json_to_sheet(filasHistorial);
    const ws3 = XLSX.utils.json_to_sheet(filasMovimientos);
    const ws4 = XLSX.utils.json_to_sheet(filasMetodos);

    ws1['!cols'] = [{wch:22},{wch:12},{wch:12},{wch:16},{wch:16},{wch:16},{wch:26}];
    ws2['!cols'] = [{wch:12},{wch:14},{wch:14},{wch:12},{wch:14}];
    ws3['!cols'] = [{wch:12},{wch:8},{wch:10},{wch:18},{wch:28},{wch:16},{wch:14}];
    ws4['!cols'] = [{wch:12},{wch:15},{wch:14},{wch:14},{wch:14}];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Resumen");
    XLSX.utils.book_append_sheet(wb, ws2, "Historial Diario");
    XLSX.utils.book_append_sheet(wb, ws3, "Movimientos Completo");
    XLSX.utils.book_append_sheet(wb, ws4, "Por Método");

    XLSX.writeFile(wb, `FinanceX-${new Date().toISOString().split('T')[0]}.xlsx`);
    } finally {
      setExportingBackup(false);
    }
  };

  const habilitarSincroDatos = () => {
    setSincroBloqueada(false);
    setSyncStatus("Sincronización habilitada");
  };

  // ════ COMPONENTE: VISUALIZADOR DE DATOS (EN TIEMPO REAL) ════
  const VisualizadorDatos = () => {
    const [tab, setTab] = useState("resumen");
    
    // Cálculos en tiempo real basados en historial actual
    const totalIngresos = useMemo(() => 
      Object.values(historial).reduce((a, d) => a + d.ventas.reduce((s, v) => s + (v.total || 0), 0), 0),
      [historial]
    );
    
    const totalEgresos = useMemo(() => 
      Object.values(historial).reduce((a, d) => a + d.gastos.reduce((s, g) => s + (g.monto || 0), 0), 0),
      [historial]
    );
    
    const saldoFinal = totalIngresos - totalEgresos;
    
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-5xl w-full my-4 shadow-2xl">
          
          {/* Header */}
          <div className="border-b border-gray-700 px-6 py-4 flex items-center justify-between bg-gradient-to-r from-gray-900 to-gray-800">
            <div>
              <h2 className="text-2xl font-bold text-white">📊 Dashboard Financiero</h2>
              <p className="text-xs text-gray-400 mt-1">Datos actualizados en tiempo real</p>
            </div>
            <button 
              onClick={() => setMostrarVisualizador(false)}
              className="text-gray-400 hover:text-white text-2xl transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Resumen rápido en tarjetas */}
          <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-gray-700">
            <div className="bg-emerald-900/20 border border-emerald-700/50 rounded-lg px-3 py-2">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">??  TOTAL INGRESOS</div>
              <div className="text-2xl font-bold text-emerald-400">{$(totalIngresos)}</div>
            </div>
            
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg px-3 py-2">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">??  TOTAL EGRESOS</div>
              <div className="text-2xl font-bold text-red-400">{$(totalEgresos)}</div>
            </div>
            
            <div className={`bg-blue-900/20 border border-blue-700/50 rounded-lg px-3 py-2 ${saldoFinal >= 0 ? "border-blue-700/50" : "border-red-700/50"}`}>
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">?? SALDO NETO</div>
              <div className={`text-2xl font-bold ${saldoFinal >= 0 ? "text-blue-400" : "text-red-400"}`}>{$(saldoFinal)}</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">?? MOVIMIENTOS</div>
              <div className="text-2xl font-bold text-gray-200">{Object.keys(historial).length}</div>
              <div className="text-xs text-gray-500">días</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-700 px-6 flex gap-2 bg-gray-800/50 overflow-x-auto">
            {[
              { id: "resumen", label: "📈 Resumen", count: 1 },
              { id: "diario", label: "📅 Diario", count: Object.keys(historial).length },
              { id: "metodos", label: "💳 Métodos", count: METODOS.length },
              { id: "gastos", label: "🔴 Gastos", count: Object.values(historial).reduce((a, d) => a + (d.gastos?.length || 0), 0) },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id 
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-gray-400 hover:text-gray-300"
                }`}
              >
                {t.label} <span className="text-xs text-gray-500">({t.count})</span>
              </button>
            ))}
          </div>

          {/* Contenido */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            
            {/* RESUMEN */}
            {tab === "resumen" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Tarjetas de resumen */}
                <div className="space-y-3">
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                    <div className="text-gray-500 text-xs uppercase mb-3">📊 Resumen General</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Total Días:</span>
                        <span className="text-white font-semibold">{Object.keys(historial).length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Total Meses:</span>
                        <span className="text-white font-semibold">{Object.keys(mesesGuardados).length}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-700 pt-2 mt-2">
                        <span className="text-gray-400">Generado:</span>
                        <span className="text-gray-300 text-xs">{new Date().toLocaleString('es-CO')}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Gráfico circular de ingresos/egresos */}
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                  <div className="text-gray-500 text-xs uppercase mb-3">💰 Distribución</div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between mb-1 text-sm">
                        <span className="text-emerald-400">Ingresos</span>
                        <span className="font-mono">{$(totalIngresos)}</span>
                      </div>
                      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 transition-all duration-300"
                          style={{ width: totalIngresos + totalEgresos > 0 ? `${(totalIngresos / (totalIngresos + totalEgresos)) * 100}%` : "0%" }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1 text-sm">
                        <span className="text-red-400">Egresos</span>
                        <span className="font-mono">{$(totalEgresos)}</span>
                      </div>
                      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-red-500 transition-all duration-300"
                          style={{ width: totalIngresos + totalEgresos > 0 ? `${(totalEgresos / (totalIngresos + totalEgresos)) * 100}%` : "0%" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* HISTORIAL DIARIO */}
            {tab === "diario" && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-800">
                      <th className="border border-gray-700 px-3 py-2 text-left text-gray-400 font-semibold">Fecha</th>
                      <th className="border border-gray-700 px-3 py-2 text-right text-emerald-400 font-semibold">Ingresos</th>
                      <th className="border border-gray-700 px-3 py-2 text-right text-red-400 font-semibold">Egresos</th>
                      <th className="border border-gray-700 px-3 py-2 text-right text-blue-400 font-semibold">?? SALDO</th>
                      <th className="border border-gray-700 px-3 py-2 text-center text-gray-400 font-semibold"># Mov</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(historial).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-500">Sin registros aún</td>
                      </tr>
                    ) : Object.entries(historial)
                      .sort(([a], [b]) => b.localeCompare(a))
                      .map(([fecha, dia]) => {
                        const ingresos = METODOS.reduce((a, m) => a + dia.ventas.reduce((s, v) => s + (+v[m.key] || 0), 0), 0);
                        const egresos = METODOS.reduce((a, m) => a + dia.gastos.filter(g => g.caja === m.key).reduce((s, g) => s + (+g.monto || 0), 0), 0);
                        const saldo = ingresos - egresos;
                        return (
                          <tr key={fecha} className="border-b border-gray-700 hover:bg-gray-800/50 transition-colors">
                            <td className="border border-gray-700 px-3 py-2 font-mono text-gray-300">{fecha}</td>
                            <td className="border border-gray-700 px-3 py-2 text-right text-emerald-400 font-mono">{$(ingresos)}</td>
                            <td className="border border-gray-700 px-3 py-2 text-right text-red-400 font-mono">{$(egresos)}</td>
                            <td className={`border border-gray-700 px-3 py-2 text-right font-mono font-bold ${saldo >= 0 ? "text-blue-400" : "text-red-400"}`}>
                              {$(saldo)}
                            </td>
                            <td className="border border-gray-700 px-3 py-2 text-center text-gray-400">{(dia.ventas?.length || 0) + (dia.gastos?.length || 0)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {/* POR MÉTODO */}
            {tab === "metodos" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {METODOS.map(m => {
                  const totalVentas = Object.values(historial).reduce((a, d) => a + d.ventas.reduce((s, v) => s + (+v[m.key] || 0), 0), 0);
                  const totalGastos = Object.values(historial).reduce((a, d) => a + d.gastos.filter(g => g.caja === m.key).reduce((s, g) => s + (+g.monto || 0), 0), 0);
                  const neto = totalVentas - totalGastos;
                  
                  return (
                    <div key={m.key} className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-3 h-3 rounded-full" style={{ background: m.color }} />
                        <div className="font-bold text-white flex-1">{m.label}</div>
                        <div className={`text-sm font-mono font-bold ${neto >= 0 ? "text-blue-400" : "text-red-400"}`}>
                          {$(neto)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-gray-500 mb-1">Ingresos</div>
                          <div className="text-emerald-400 font-mono font-semibold">{$(totalVentas)}</div>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Egresos</div>
                          <div className="text-red-400 font-mono font-semibold">{$(totalGastos)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* GASTOS */}
            {tab === "gastos" && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-800">
                      <th className="border border-gray-700 px-2 py-2 text-left text-gray-400">Fecha</th>
                      <th className="border border-gray-700 px-2 py-2 text-left text-gray-400">Hora</th>
                      <th className="border border-gray-700 px-2 py-2 text-left text-gray-400">?? CONCEPTO</th>
                      <th className="border border-gray-700 px-2 py-2 text-left text-gray-400">Método</th>
                      <th className="border border-gray-700 px-2 py-2 text-right text-gray-400">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(historial).flatMap(([fecha, dia]) => 
                      dia.gastos?.map(g => ({ fecha, ...g })) || []
                    ).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-500">Sin gastos registrados</td>
                      </tr>
                    ) : Object.entries(historial)
                      .flatMap(([fecha, dia]) => 
                        dia.gastos?.map(g => ({ fecha, ...g })) || []
                      )
                      .sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`))
                      .map((g, i) => (
                        <tr key={i} className="border-b border-gray-700 hover:bg-gray-800/50">
                          <td className="border border-gray-700 px-2 py-1 font-mono">{g.fecha}</td>
                          <td className="border border-gray-700 px-2 py-1">{g.hora}</td>
                          <td className="border border-gray-700 px-2 py-1 truncate">{g.concepto}</td>
                          <td className="border border-gray-700 px-2 py-1">
                            <span style={{ color: METODOS.find(m => m.key === g.caja)?.color }}>
                              {METODOS.find(m => m.key === g.caja)?.label || g.caja}
                            </span>
                          </td>
                          <td className="border border-gray-700 px-2 py-1 text-right text-red-400 font-mono font-semibold">−{$(g.monto)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-700 px-6 py-4 bg-gray-800/50 flex gap-2 justify-end">
            <button
              onClick={() => descargarBackup()}
              className="bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              📊 Descargar EXCEL
            </button>
            <button
              onClick={() => setMostrarVisualizador(false)}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  };

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

    // 1. Cargar datos locales inmediatamente
    const raw = localStorage.getItem(STORAGE_KEY);
    const localData = raw ? JSON.parse(raw) : null;
    if (localData?.historial) {
      setHistorial(localData.historial);
      setBackup(localData);
    }
    if (localData?.mesesGuardados) setMesesGuardados(localData.mesesGuardados);
    if (localData?.conteo) setConteo({ ...conteoInicial(), ...localData.conteo });

    // 2. Suscribir a Firestore en tiempo real con onSnapshot
    let unsub = null;
    try {
      unsub = onSnapshot(
        doc(db, "financex", "appData"),
        (snap) => {
          if (!isActive) return;
          if (snap.exists()) {
            const cloud = snap.data();
            // Ignorar si este snapshot fue provocado por nuestro propio setDoc
            if (isSaving.current) return;
            if (cloud.updatedAt && cloud.updatedAt === lastSavedAt.current) return;
            const esValidoCloud = cloud?.historial && Object.keys(cloud.historial || {}).length > 0;
            const cloudModerno = new Date(cloud.updatedAt || 0).getTime();
            const localModerno = new Date(localData?.updatedAt || 0).getTime();
            if (esValidoCloud && cloudModerno > localModerno) {
              if (cloud.historial) setHistorial(cloud.historial);
              if (cloud.mesesGuardados) setMesesGuardados(cloud.mesesGuardados);
              if (cloud.conteo) setConteo({ ...conteoInicial(), ...cloud.conteo });
            } else if (!esValidoCloud && localData?.historial) {
              console.warn("⚠️ Nube VACÍA pero hay datos locales - BLOQUEANDO SINCRONIZACIÓN");
              setSincroBloqueada(true);
              setMostrarRecuperar(true);
            }
            setSyncStatus("✓ Sincronizado");
          }
          setIsFirestoreReady(true);
        },
        (fbError) => {
          console.error("Error Firestore:", fbError);
          if (isActive) {
            setSyncStatus(localData ? "Modo offline (datos locales)" : "Error nube");
            alert("Error de conexión con la nube. Verifica tu sesión");
            setIsFirestoreReady(true);
          }
        }
      );
    } catch (e) {
      console.error("Error iniciando onSnapshot:", e);
      if (isActive) {
        setSyncStatus("Error nube");
        setIsFirestoreReady(true);
      }
    }

    return () => {
      isActive = false;
      if (unsub) unsub();
    };
  }, []);

  useEffect(() => {
    if (!isFirestoreReady) return;
    if (sincroBloqueada) return; // NO sincronizar si está bloqueada

    const payload = {
      historial,
      mesesGuardados,
      conteo,
      updatedAt: new Date().toISOString(),
    };

    // Guardar SIEMPRE en localStorage (es el respaldo)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      localStorage.setItem(BACKUP_KEY, JSON.stringify(payload)); // Backup adicional
    } catch (error) {
      console.error("Error guardando almacenamiento local", error);
    }

    // Guardar en Firestore CON VALIDACIÓN
    setSyncStatus("Guardando...");
    let cancelled = false;
    
    // PROTECCIÓN: No guardar si los datos se ven vacíos/corruptos
    const tieneDatos = Object.keys(historial || {}).length > 0;
    
    (async () => {
      try {
        // Solo guardar en Firestore si hay datos válidos
        if (tieneDatos) {
          lastSavedAt.current = payload.updatedAt; // registrar antes de escribir
          isSaving.current = true;
          await setDoc(doc(db, "financex", "appData"), payload, { merge: true });
          // Mantener el flag activo 2s para cubrir el snapshot de respuesta de Firestore
          setTimeout(() => { isSaving.current = false; }, 2000);
          if (!cancelled) setSyncStatus("✓ Sincronizado");
        } else {
          // Si está vacío, mantener localmente pero no sobrescribir nube
          if (!cancelled) setSyncStatus("Guardado local (protegido)");
        }
      } catch (error) {
        console.error("Error guardando Firestore", error);
        if (!cancelled) setSyncStatus("Guardado local (error nube)");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [historial, mesesGuardados, conteo, isFirestoreReady, sincroBloqueada]);

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
    const nueva = { id: uid(), hora: nowStr(), fecha, concepto: normalizar(fVenta.concepto) || "Ventas del día", ...Object.fromEntries(METODOS.map(m => [m.key, +fVenta[m.key] || 0])), total };
    setHistorial(h => {
      const dia = h[fecha] || { ventas: [], gastos: [] };
      return { ...h, [fecha]: { ...dia, ventas: [...dia.ventas, nueva] } };
    });
    setFVenta({ concepto: "", fecha: TODAY, ...Object.fromEntries(METODOS.map(m => [m.key, ""])) });
    setSheetVenta(false);
  };

  const guardarGasto = () => {
    if (!fGasto.concepto || !fGasto.monto) return;
    const nuevo = { id: uid(), hora: nowStr(), concepto: normalizar(fGasto.concepto), monto: +fGasto.monto, caja: fGasto.caja, categoria: normalizar(fGasto.categoria) };
    setHistorial(h => {
      const dia = h[TODAY] || { ventas: [], gastos: [] };
      return { ...h, [TODAY]: { ...dia, gastos: [...dia.gastos, nuevo] } };
    });
    setFGasto({ concepto: "", monto: "", caja: "efectivo", categoria: "domicilio" });
    setSheetGasto(false);
  };

  const delVenta = (id) => setHistorial(h => ({ ...h, [TODAY]: { ...diaHoy, ventas: diaHoy.ventas.filter(v => v.id !== id) } }));
  const delGasto = (id) => setHistorial(h => ({ ...h, [TODAY]: { ...diaHoy, gastos: diaHoy.gastos.filter(g => g.id !== id) } }));

  const handleDelete = async (id) => {
    let firestoreId = null;
    for (const fecha of Object.keys(historial)) {
      const dia = historial[fecha];
      const v = dia.ventas?.find(v => v.id === id);
      if (v) { firestoreId = v.firestoreId; break; }
      const g = dia.gastos?.find(g => g.id === id);
      if (g) { firestoreId = g.firestoreId; break; }
    }
    setHistorial(h => {
      const next = { ...h };
      for (const fecha of Object.keys(next)) {
        const dia = next[fecha];
        if (dia.ventas?.some(v => v.id === id))
          return { ...next, [fecha]: { ...dia, ventas: dia.ventas.filter(v => v.id !== id) } };
        if (dia.gastos?.some(g => g.id === id))
          return { ...next, [fecha]: { ...dia, gastos: dia.gastos.filter(g => g.id !== id) } };
      }
      return next;
    });
    if (firestoreId) {
      try { await deleteDoc(doc(db, "movimientos", firestoreId)); }
      catch (e) { console.error("Error en la operación de FinanceX:", e); }
    }
  };

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
    { id: "metricas",   label: "Métricas"    },
  ];

  // ── Estado gastos diarios (filas dinámicas) ───────────────────────────────
  const EMPTY_ROW = () => ({ id: uid(), caja: "efectivo", concepto: "", monto: "", categoria: "Otros" });
  const [fechaGastos, setFechaGastos] = useState(todayStr());
  const [filasGastos, setFilasGastos] = useState([EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()]);

  // ══════════════════════════════════════════════════════════════════════════
const S = { // styles
    card:    "bg-[#111116] border border-gray-800/30 rounded-2xl shadow-lg",
    section: "text-xs text-gray-500 uppercase tracking-widest font-semibold mb-2",
    row:     "flex items-center justify-between py-2.5 border-b border-gray-800/40 last:border-0",
    btn:     {
      primary: "bg-gradient-to-r from-blue-900/90 to-violet-900/90 hover:from-blue-800/90 hover:to-violet-800/90 border border-blue-700/30 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
      success: "bg-emerald-800/80 hover:bg-emerald-700/80 border border-emerald-700/30 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
      danger:  "bg-red-800/80 hover:bg-red-700/80 border border-red-700/30 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
      ghost:   "bg-white/[0.05] hover:bg-white/[0.08] border border-gray-700/40 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
    },
    table: {
      header: "bg-[#111116] border-b border-gray-800/40",
      cell:   "border border-gray-800/40 px-3 py-2.5 text-xs",
      row:    "border-b border-gray-800/30 hover:bg-white/[0.025] transition-colors",
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEW: CIERRE DE CAJA (CON RESUMEN VISUAL)
  // ════════════════════════════════════════════════════════════════════════
  const ViewMayor = () => {
    const fmtC = (n) => $(n || 0);

    const registros = [
      ...diaHoy.ventas.map(v => ({ ...v, _tipo: "venta" })),
      ...diaHoy.gastos.map(g => ({ ...g, _tipo: "gasto" })),
    ].sort((a, b) => a.hora.localeCompare(b.hora));

    return (
      <div className="space-y-4">
        {/* RESUMEN EN TARJETAS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={`${S.card} px-4 py-3`}>
            <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">?? INGRESOS</div>
            <div className="text-2xl font-bold text-emerald-400">{fmtC(granTotal)}</div>\n            <div className="text-gray-600 text-xs mt-1">{diaHoy.ventas?.length || 0} transacciones</div>
          </div>
          
          <div className={`${S.card} px-4 py-3`}>
            <div className="text-gray-500 text-x uppercase tracking-wider text-xs mb-1">?? EGRESOS</div>
            <div className="text-2xl font-bold text-red-400">−{fmtC(totGastos)}</div>
            <div className="text-gray-600 text-xs mt-1">{diaHoy.gastos?.length || 0} transacciones</div>
          </div>
          
          <div className={`${S.card} px-4 py-3`}>
            <div className="text-gray-500 text-x uppercase tracking-wider text-xs mb-1">?? SALDO NETO</div>
            <div className={`text-2xl font-bold mt-1 ${netoTotal >= 0 ? "text-blue-400" : "text-red-400"}`}>
              {fmtC(netoTotal)}
            </div>
          </div>

          <div className={`${S.card} px-4 py-3 col-span-2 md:col-span-1`}>
            <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">?? DESDE INICIO</div>
            <div className={`text-2xl font-bold mt-1 ${saldoTotalGlobal >= 0 ? "text-blue-400" : "text-red-400"}`}>
              {fmtC(saldoTotalGlobal)}
            </div>
          </div>
        </div>

        {/* TABLA DE MOVIMIENTOS */}
        <div className={`${S.card} overflow-hidden`}>

        {/* Header */}
        <div className="px-3 pt-3 pb-2 flex items-center justify-between border-b border-gray-700">
          <span className={S.section}>
              {new Date().toLocaleDateString("es-CO", { weekday:"long", day:"numeric", month:"long" })}
              <HoraBogotaRealtime />
            </span>



// Componente para mostrar la hora en tiempo real en zona Bogotá
function HoraBogotaRealtime() {
  const [hora, setHora] = useState("");
  useEffect(() => {
    const update = () => {
      const now = new Date();
      // Bogotá UTC-5
      const bogota = new Date(now.getTime() - (now.getTimezoneOffset() * 60000) - (5 * 60 * 60 * 1000));
      setHora(
        bogota.toLocaleTimeString("es-CO", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <span style={{ marginLeft: 8, fontSize: 12, color: "#60a5fa", fontVariant: "tabular-nums" }}>
      {hora}
    </span>
  );
}
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
                <th className="py-1.5 text-center border-r border-gray-700/50 last:border-r-0 text-left pl-3 text-gray-500">?? CONCEPTO</th>
                {METODOS.map(m => (
                  <th key={m.key} className="py-1.5 text-center border-r border-gray-700/50 last:border-r-0">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
                      <span style={{ color: m.color, fontSize: "9px" }} className="uppercase tracking-wide leading-none">
                        {m.key === "bancolombia" ? "Banco" : m.key === "aliados" ? "Aliad" : m.label.slice(0, 5)}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="py-1.5 text-center border-r border-gray-700/50 last:border-r-0 text-gray-500 pr-2">Total</th>
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
                        <td key={m.key} className={`py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden ${val > 0 ? (isVenta ? "text-emerald-400" : "text-red-400") : "text-gray-700"}`}>
                          {fmtC(val)}
                        </td>
                      );
                    })}
                    {/* Total fila */}
                    <td className={`py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden font-bold ${isVenta ? "text-emerald-300" : "text-red-300"}`}>
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
                      <td key={m.key} className={`py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden font-bold ${totVentas[m.key] > 0 ? "text-emerald-400" : "text-gray-700"}`}>
                        {fmtC(totVentas[m.key])}
                      </td>
                    ))}
                    <td className="py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden font-bold text-emerald-400">{fmtC(granTotal)}</td>
                  </tr>
                )}
                {/* Egresos */}
                {totGastos > 0 && (
                  <tr className="border-t border-gray-700/60 bg-red-900/20">
                    <td className="py-1.5 pl-3 pr-1 text-xs font-bold text-red-400 border-r border-gray-700/50">↓ Egr.</td>
                    {METODOS.map(m => (
                      <td key={m.key} className={`py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden font-bold ${totGastosPorCaja[m.key] > 0 ? "text-red-400" : "text-gray-700"}`}>
                        {fmtC(totGastosPorCaja[m.key])}
                      </td>
                    ))}
                    <td className="py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden font-bold text-red-400">−{fmtC(totGastos)}</td>
                  </tr>
                )}
                {/* Neto */}
                <tr className="border-t-2 border-gray-500 bg-gray-800/80">
                  <td className="py-1.5 pl-3 pr-1 text-xs font-bold text-white border-r border-gray-700/50">= Neto</td>
                  {METODOS.map(m => {
                    const n = (totVentas[m.key] || 0) - (totGastosPorCaja[m.key] || 0);
                    return (
                      <td key={m.key} className={`py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden font-bold ${n > 0 ? "text-blue-400" : n < 0 ? "text-red-400" : "text-gray-700"}`}>
                        {n !== 0 ? fmtC(n) : "—"}
                      </td>
                    );
                  })}
                  <td className={`py-1.5 text-center text-xs font-mono border-r border-gray-700/50 last:border-r-0 overflow-hidden font-bold text-sm ${netoTotal >= 0 ? "text-blue-400" : "text-red-400"}`}>
                    {fmtC(netoTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // VIEW:   FONDO DE CAJA
  // ════════════════════════════════════════════════════════════════════════
  const ViewMenor = () => {
    const billeteTotal = BILLETES.reduce((a, d) => a + d * (conteo[d] || 0), 0);
    const monedaTotal = MONEDAS.reduce((a, d) => a + d * (conteo[d] || 0), 0);
    
    const DenomRow = ({ d }) => {
      const cant = conteo[d] || 0;
      return (
        <div className="flex items-center gap-2 py-2 border-b border-gray-700/50 last:border-0">
          <div className="w-24 shrink-0">
            <div className="text-xs font-semibold text-gray-300">{$(d)}</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setConteo(c => ({ ...c, [d]: Math.max(0, (c[d] || 0) - 1) }))}
              className="w-7 h-7 bg-gray-700 hover:bg-gray-600 rounded flex items-center justify-center text-white text-xs font-bold transition-colors">
              −
            </button>
            <span className="text-white font-mono text-sm w-6 text-center font-bold">{cant}</span>
            <button onClick={() => setConteo(c => ({ ...c, [d]: (c[d] || 0) + 1 }))}
              className="w-7 h-7 bg-gray-700 hover:bg-gray-600 rounded flex items-center justify-center text-white text-xs font-bold transition-colors">
              +
            </button>
          </div>
          <div className="flex-1 text-right">
            {cant > 0 ? (
              <span className="text-xs font-mono text-yellow-400 font-bold">{$(cant * d)}</span>
            ) : (
              <span className="text-xs text-gray-600">—</span>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        {/* Tarjeta de total */}
        <div className={`${S.card} px-4 py-3 flex items-center justify-between`}>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">   FONDO DE CAJA</div>
            <div className="text-3xl font-bold font-mono text-yellow-400">{$(totalMenor)}</div>
          </div>
          <button onClick={() => setConteo(Object.fromEntries([...BILLETES, ...MONEDAS].map(d => [d, 0])))}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-colors">
            🗑️ Limpiar
          </button>
        </div>

        {/* Grid: Billetes | Monedas */}
        <div className="grid grid-cols-2 gap-3">
          {/* BILLETES */}
          <div className={`${S.card} overflow-hidden flex flex-col`}>
            <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">📄 Billetes</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">{$(billeteTotal)}</div>
            </div>
            <div className="px-3 py-2 flex-1 overflow-y-auto">
              {BILLETES.map(d => <DenomRow key={d} d={d} />)}
            </div>
          </div>

          {/* MONEDAS + RESUMEN */}
          <div className="space-y-3 flex flex-col">
            <div className={`${S.card} overflow-hidden flex-1`}>
              <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">🪙 Monedas</div>
                <div className="text-xl font-bold text-blue-400 mt-1">{$(monedaTotal)}</div>
              </div>
              <div className="px-3 py-2 overflow-y-auto max-h-48">
                {MONEDAS.map(d => <DenomRow key={d} d={d} />)}
              </div>
            </div>

            {/* RESUMEN */}
            <div className={S.card}>
              <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
                <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">📊 Resumen</div>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-xs">Billetes</span>
                  <span className="font-mono text-emerald-400 font-bold">{$(billeteTotal)}</span>
                </div>
                <div className="flex justify-between items-center border-b border-gray-700 pb-2">
                  <span className="text-gray-400 text-xs">Monedas</span>
                  <span className="font-mono text-blue-400 font-bold">{$(monedaTotal)}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-gray-300 text-xs font-semibold">Total</span>
                  <span className="font-mono text-yellow-400 font-bold text-lg">{$(totalMenor)}</span>
                </div>
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
    // Estados y hooks al inicio
    const [mesExport, setMesExport] = useState(todayStr().slice(0, 7));
    const [mesDetalle, setMesDetalle] = useState(null);
    const [diaDetalle, setDiaDetalle] = useState(null); // fecha string
    const [filtroTemporal, setFiltroTemporal] = useState("mes");
    const [diaExpandido, setDiaExpandido] = useState(null);
    const fmtC = n => $(n || 0);
    // Única declaración de diasFiltrados, protegida
    const diasFiltrados = useMemo(() => {
      if (!historial || typeof historial !== 'object' || !mesExport) return [];
      return Object.entries(historial)
        .filter(([fecha]) => typeof mesExport === 'string' && fecha.startsWith(mesExport))
        .map(([fecha, dia]) => ({ fecha, ...dia }));
    }, [historial, mesExport]);
    const entradasFiltradas = useMemo(() => {
      const hoy = new Date(); hoy.setHours(0,0,0,0);
      return Object.entries(historial || {}).filter(([fecha]) => {
        const d = new Date(fecha + "T12:00:00");
        if (filtroTemporal === "3dias") return (hoy - d) / 86400000 <= 2;
        if (filtroTemporal === "semana") {
          const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
          return d >= lunes;
        }
        if (filtroTemporal === "mes") return fecha.startsWith(new Date().toISOString().slice(0,7));
        if (filtroTemporal === "año") return fecha.startsWith(String(new Date().getFullYear()));
        return true;
      }).sort(([a],[b]) => b.localeCompare(a));
    }, [historial, filtroTemporal]);
    const totalFiltrados = useMemo(() =>
      entradasFiltradas.reduce((acc, [, dia]) => {
        const ingr = (dia.ventas||[]).reduce((s,v) => s + METODOS.reduce((a,m) => a + (+v[m.key]||0), 0), 0);
        const egr  = (dia.gastos||[]).reduce((s,g) => s + (+g.monto||0), 0);
        return { ingr: acc.ingr + ingr, egr: acc.egr + egr };
      }, { ingr: 0, egr: 0 }),
    [entradasFiltradas]);
    // Memo para meses
    const meses = useMemo(() => Object.values(mesesGuardados).sort((a,b)=>b.mes.localeCompare(a.mes)), [mesesGuardados]);
    // Memo para exportación
    const hayMesExport = useMemo(() => {
      if (!mesExport || typeof mesExport !== 'string') return false;
      return Object.keys(historial).some(fecha => fecha.startsWith(mesExport));
    }, [historial, mesExport]);

    // Mostrar ingresos y egresos por día
    const toRows = (dias) => {
      const fechas = Object.keys(dias).sort();
      return fechas.map(fecha => {
        const dia = dias[fecha] || { ventas: [], gastos: [] };
        const ingresos = METODOS.reduce((a, m) => a + dia.ventas.reduce((s, v) => s + (+v[m.key] || 0), 0), 0);
        const egresos = METODOS.reduce((a, m) => a + dia.gastos.filter(g => g.caja === m.key).reduce((s, g) => s + (+g.monto || 0), 0), 0);
        return {
          fecha,
          ingresos,
          egresos,
          saldo: ingresos - egresos,
        };
      });
    };

    const exportarExcel = (dias, nombreArchivo) => {
      // Hoja 1: resumen por día
      const rowsResumen = toRows(dias);
      // Hoja 2: movimientos detallados con Fecha, Tipo, Categoría, Descripción, Método, Monto
      const rowsDetalle = [];
      Object.entries(dias)
        .sort(([a],[b]) => a.localeCompare(b))
        .forEach(([fecha, dia]) => {
          dia.ventas?.forEach(v => {
            METODOS.forEach(m => {
              const monto = +v[m.key] || 0;
              if (monto > 0) rowsDetalle.push({ Fecha: fecha, Hora: v.hora || "-", Tipo: "Ingreso", Categoría: "Venta", Descripción: v.concepto || "-", Método: m.label, Monto: monto });
            });
          });
          dia.gastos?.forEach(g => {
            rowsDetalle.push({ Fecha: fecha, Hora: g.hora || "-", Tipo: "Egreso", Categoría: g.categoria || "-", Descripción: g.concepto || "-", Método: METODOS.find(m => m.key === g.caja)?.label || g.caja || "-", Monto: g.monto || 0 });
          });
        });
      if (!rowsDetalle.length && !rowsResumen.length) return;
      const ws1 = XLSX.utils.json_to_sheet(rowsResumen);
      const ws2 = XLSX.utils.json_to_sheet(rowsDetalle);
      ws1['!cols'] = [{wch:12},{wch:14},{wch:14},{wch:12},{wch:14}];
      ws2['!cols'] = [{wch:12},{wch:8},{wch:10},{wch:18},{wch:28},{wch:16},{wch:14}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, "Historial");
      XLSX.utils.book_append_sheet(wb, ws2, "Movimientos Detalle");
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
                    <td colSpan={3} className="px-3 py-2 text-red-400 font-bold" style={{fontSize:"10px"}}>??  TOTAL EGRESOS DEL D�A</td>
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
                    <td colSpan={2} className="border-r border-gray-700/50 px-1.5 py-1.5 text-emerald-400 font-bold" style={{fontSize:"9px"}}>??  TOTAL INGRESOS</td>
                    {METODOS.map(m=><td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold py-1.5" style={{fontSize:"10px",color:mg.totV[m.key]>0?"#6ee7b7":"#374151"}}>{fmtC(mg.totV[m.key])}</td>)}
                  </tr>
                  <tr className="border-t border-gray-700/50 bg-red-900/20">
                    <td colSpan={2} className="border-r border-gray-700/50 px-1.5 py-1.5 text-red-400 font-bold" style={{fontSize:"9px"}}>??  TOTAL EGRESOS</td>
                    {METODOS.map(m=><td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold py-1.5" style={{fontSize:"10px",color:mg.totG[m.key]>0?"#fca5a5":"#374151"}}>{fmtC(mg.totG[m.key])}</td>)}
                  </tr>
                  <tr className="border-t-2 border-gray-500 bg-blue-950/40">
                    <td colSpan={2} className="border-r border-gray-700/50 px-1.5 py-1.5 text-blue-300 font-bold" style={{fontSize:"9px"}}>?? SALDO</td>
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

    // ── Vista principal ────────────────────────────────────────────────────

    return (
      <div className="space-y-4">

        {/* ── FILTROS TEMPORALES + CONTROLES EXPORT ── */}
        <div className={`${S.card} px-4 py-3 space-y-3`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-600 uppercase tracking-wider shrink-0">Período:</span>
            {[
              {key:"3dias",  label:"Últimos 3 días"},
              {key:"semana", label:"Esta semana"},
              {key:"mes",    label:"Este mes"},
              {key:"año",    label:"Año en curso"},
            ].map(f => (
              <button key={f.key}
                onClick={() => setFiltroTemporal(f.key)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  filtroTemporal === f.key
                    ? "bg-blue-700 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap border-t border-gray-800/50 pt-3">
            <input
              type="month"
              value={mesExport}
              onChange={e => setMesExport(e.target.value)}
              className="bg-[#111116] border border-gray-800/50 rounded-lg text-gray-300 text-xs px-2 py-1.5 focus:outline-none focus:border-blue-600/60 w-auto shrink-0"
              style={{minWidth:0, maxWidth:136}}
            />
            <button
              onClick={exportarMes}
              disabled={!hayMesExport}
              className={`text-xs px-3 py-2 rounded-lg font-semibold transition-colors ${
                hayMesExport ? "bg-emerald-700 hover:bg-emerald-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
            >
              📊 Mes Excel
            </button>
            <button
              onClick={exportarTotal}
              disabled={!Object.keys(historial).length}
              className={`text-xs px-3 py-2 rounded-lg font-semibold transition-colors ${
                Object.keys(historial).length ? "bg-blue-700 hover:bg-blue-600 text-white" : "bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
            >
              📈 Total Excel
            </button>
          </div>
        </div>

        {/* ── RESUMEN DEL PERÍODO ── */}
        {entradasFiltradas.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-3 py-2.5 text-center">
              <div className="text-emerald-400 font-mono font-bold text-sm">{fmtC(totalFiltrados.ingr)}</div>
              <div className="text-gray-600 text-xs mt-0.5">Ingresos</div>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded-xl px-3 py-2.5 text-center">
              <div className="text-red-400 font-mono font-bold text-sm">{fmtC(totalFiltrados.egr)}</div>
              <div className="text-gray-600 text-xs mt-0.5">Egresos</div>
            </div>
            <div className={`${(totalFiltrados.ingr-totalFiltrados.egr)>=0?"bg-blue-900/20 border-blue-700/30":"bg-red-900/20 border-red-700/30"} border rounded-xl px-3 py-2.5 text-center`}>
              <div className={`font-mono font-bold text-sm ${(totalFiltrados.ingr-totalFiltrados.egr)>=0?"text-blue-400":"text-red-400"}`}>{fmtC(totalFiltrados.ingr-totalFiltrados.egr)}</div>
              <div className="text-gray-600 text-xs mt-0.5">Neto</div>
            </div>
          </div>
        )}

        {/* ── AUDITORÍA POR DÍA ── */}
        {entradasFiltradas.length === 0 ? (
          <div className={`${S.card} py-10 text-center`}>
            <div className="text-gray-600 text-sm">Sin entradas para el período seleccionado</div>
          </div>
        ) : (
          <div className={`${S.card} overflow-hidden`}>
            <table className="w-full border-collapse" style={{tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:100}}/><col style={{width:88}}/><col style={{width:88}}/><col style={{width:88}}/><col/><col style={{width:24}}/>
              </colgroup>
              <thead>
                <tr className="bg-gray-900/60 border-b border-gray-700">
                  {["Fecha","Ingresos","Egresos","Neto","Día",""].map(h=>(
                    <th key={h} className="px-2 py-2 text-left text-gray-500 font-semibold uppercase tracking-wider border-r border-gray-700/50 last:border-r-0" style={{fontSize:"9px"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entradasFiltradas.flatMap(([fecha, dia]) => {
                  const ingr = (dia.ventas||[]).reduce((s,v) => s + METODOS.reduce((a,m) => a + (+v[m.key]||0), 0), 0);
                  const egr  = (dia.gastos||[]).reduce((s,g) => s + (+g.monto||0), 0);
                  const neto = ingr - egr;
                  const gastos = dia.gastos || [];
                  const expanded = diaExpandido === fecha;
                  const dObj = new Date(fecha + "T12:00:00");
                  const nomDia = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"][dObj.getDay()];
                  const mainRow = (
                    <tr key={fecha}
                      className="border-b border-gray-700/30 hover:bg-gray-800/20 transition-colors"
                      style={{background: expanded ? "#111820" : undefined}}>
                      <td className="px-2 py-1.5 text-gray-400 font-mono border-r border-gray-700/30" style={{fontSize:"10px"}}>{fecha}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-400 border-r border-gray-700/30" style={{fontSize:"10px"}}>{ingr>0?fmtC(ingr):"—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-red-400 border-r border-gray-700/30" style={{fontSize:"10px"}}>{egr>0?fmtC(egr):"—"}</td>
                      <td className={`px-2 py-1.5 text-right font-mono font-bold border-r border-gray-700/30 ${neto>=0?"text-blue-400":"text-red-400"}`} style={{fontSize:"10px"}}>{fmtC(neto)}</td>
                      <td className="px-2 py-1.5 text-gray-300 font-semibold border-r border-gray-700/30" style={{fontSize:"10px"}}>{nomDia}</td>
                      <td className="px-1 py-1.5 text-center">
                        {gastos.length > 0 && (
                          <button
                            onClick={() => setDiaExpandido(expanded ? null : fecha)}
                            className="text-gray-500 hover:text-blue-400 transition-colors"
                            title={expanded ? "Ocultar egresos" : "Ver detalle egresos"}>
                            <Ic d={expanded ? ICONS.up : ICONS.down} s={10}/>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                  if (!expanded || gastos.length === 0) return [mainRow];
                  return [mainRow, ...gastos.map(g => {
                    const m = METODOS.find(x=>x.key===g.caja)||METODOS[0];
                    return (
                      <tr key={`${fecha}-eg-${g.id}`}
                        className="border-b border-gray-700/20"
                        style={{background:"#1a0808"}}>
                        <td className="pl-5 pr-1 py-1 text-gray-600 font-mono border-r border-gray-700/20" style={{fontSize:"9px"}}>↳ {g.hora||"—"}</td>
                        <td colSpan={2} className="px-2 py-1 text-gray-300 border-r border-gray-700/20 truncate" style={{fontSize:"9px"}}>{g.concepto||"—"}</td>
                        <td className="px-2 py-1 text-right font-mono text-red-400 border-r border-gray-700/20" style={{fontSize:"9px"}}>−{fmtC(g.monto)}</td>
                        <td className="px-2 py-1 border-r border-gray-700/20" style={{fontSize:"9px"}}>
                          <span style={{color:m.color}}>{m.label}</span>
                          {g.categoria && <span className="text-gray-700 ml-1">· {g.categoria}</span>}
                        </td>
                        <td/>
                      </tr>
                    );
                  })];
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── LIBRO CONTABLE (MESES GUARDADOS) ── */}
        {meses.length > 0 && (
          <div className="space-y-2">
            <div className="px-4 py-3 bg-gradient-to-r from-gray-900 to-gray-800 border border-gray-700 rounded-t-2xl">
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-1">📖 Libro Contable</div>
              <div className="text-sm text-gray-400">{meses.length} {meses.length===1?"mes guardado":"meses guardados"}</div>
            </div>

            {meses.map((mg) => {
              const totalIngr = METODOS.reduce((a,m)=>a+(mg.totV[m.key]||0),0);
              const totalEgr  = METODOS.reduce((a,m)=>a+(mg.totG[m.key]||0),0);
              const saldo     = totalIngr - totalEgr;
              return (
                <div key={mg.mes}
                  className={`${S.card} px-4 py-3 flex items-center justify-between gap-3 hover:border-blue-600/50 transition-all group`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-bold capitalize text-sm mb-0.5">{mg.nombre}</div>
                    <div className="text-xs text-gray-500">Guardado {mg.savedAt}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-emerald-400 font-mono font-bold text-xs">{fmtC(totalIngr)}</div>
                      <div className="text-gray-600 text-xs mt-0.5">Ingr.</div>
                    </div>
                    <div className="bg-red-900/20 border border-red-700/30 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-red-400 font-mono font-bold text-xs">{fmtC(totalEgr)}</div>
                      <div className="text-gray-600 text-xs mt-0.5">Egr.</div>
                    </div>
                    <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-2 py-1.5 text-center">
                      <div className={`font-mono font-bold text-xs ${saldo>=0?"text-blue-400":"text-red-400"}`}>{fmtC(saldo)}</div>
                      <div className="text-gray-600 text-xs mt-0.5">{saldo>=0?"Sup":"Def"}</div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={()=>setMesDetalle(mg)}
                      className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold transition-colors">
                      Ver
                    </button>
                    <button
                      onClick={() => exportarExcel(mg.diasHistorial || {}, `financex-${mg.mes}`)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors">
                      Excel
                    </button>
                  </div>
                </div>
              );
            })}

            {meses.length > 1 && (
              <div className={S.card}>
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-gray-400 text-xs uppercase tracking-wider font-semibold">🎯 Total General</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-emerald-400 font-mono font-bold text-sm">
                        {$(
                          meses.reduce((a,mg)=>a+METODOS.reduce((b,m)=>b+(mg.totV[m.key]||0),0),0)
                        )}
                      </div>
                    </div>
                    <div className="bg-red-900/20 border border-red-700/30 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-red-400 font-mono font-bold text-sm">
                        {$(
                          meses.reduce((a,mg)=>a+METODOS.reduce((b,m)=>b+(mg.totG[m.key]||0),0),0)
                        )}
                      </div>
                    </div>
                    <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-2 py-1.5 text-center">
                      <div className="text-blue-400 font-mono font-bold text-sm">
                        {$(
                          meses.reduce((a,mg)=>a+METODOS.reduce((b,m)=>b+(mg.totV[m.key]||0),0),0) -
                          meses.reduce((a,mg)=>a+METODOS.reduce((b,m)=>b+(mg.totG[m.key]||0),0),0)
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };


  // 
  // VIEW: GASTOS DIARIOS
  // 
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
          concepto: normalizar(r.concepto), monto: +r.monto,
          caja: r.caja, categoria: "Gasto diario"
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
            {["?? M�TODO DE PAGO", "?? CONCEPTO", "?? MONTO", ""].map((h, i) => (
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
    // ...existing code...

    // Guardado automático temporal para ingresos y egresos
    const TEMP_FORM_KEY = "financex_temp_form_v1";
    // Cada fila arranca con un método diferente (ciclando por METODOS)
    const EROW = (i=0) => ({ id: uid(), caja: METODOS[i % METODOS.length].key, concepto: "", monto: "", categoria: "Otros" });
    const INIT_ROWS = (n=8) => Array.from({length:n}, (_,i) => EROW(i));
    // Egresos
    const [rowsG, setRowsG] = useState(INIT_ROWS());
    const [fechaG, setFechaG] = useState(todayStr());
    // Ingresos
    const [rowsI, setRowsI] = useState(INIT_ROWS());
    const [fechaI, setFechaI] = useState(todayStr());
    // Gastos internos
    const GI_ROW = (concepto = "") => ({ id: uid(), concepto, monto: "" });
    const initGastosInternos = () => [GI_ROW("Domicilios"), GI_ROW("Turno"), GI_ROW()];
    const [rowsGI, setRowsGI] = useState(initGastosInternos());
    const [savedConteoMsg, setSavedConteoMsg] = useState(false);
    // Panel ingresos/egresos
    const [panelOpen, setPanelOpen] = useState({ Ingresos: true, Egresos: true });
    const [editandoMov, setEditandoMov] = useState(null);
    const [editCampos, setEditCampos] = useState({});
    const [filaDesplegada, setFilaDesplegada] = useState(null);
    const [verMesCompleto, setVerMesCompleto] = useState(false);
    // Avisos fuzzy de similitud en conceptos
    const [avisoRow, setAvisoRow] = useState({});
    const [avisoRowGI, setAvisoRowGI] = useState({});
    const [avisoFGasto, setAvisoFGasto] = useState(null);
    // Guardado automático temporal en Firebase para gastos internos
    useEffect(() => {
      const tempGI = {
        rowsGI,
      };
      setDoc(doc(db, "financex_temp", "gastosInternos"), tempGI, { merge: true });
    }, [rowsGI]);
    // Restaurar gastos internos desde Firebase al abrir la app
    useEffect(() => {
      (async () => {
        try {
          const snap = await getDoc(doc(db, "financex_temp", "gastosInternos"));
          if (snap.exists()) {
            const tempGI = snap.data();
            if (tempGI.rowsGI) setRowsGI(tempGI.rowsGI);
          }
        } catch {}
      })();
    }, []);
    // Guardado automático temporal en Firebase
    useEffect(() => {
      const temp = {
        rowsI,
        rowsG,
        fechaI,
        fechaG,
      };
      // Guardar en Firebase (colección temporal)
      setDoc(doc(db, "financex_temp", "formData"), temp, { merge: true });
    }, [rowsI, rowsG, fechaI, fechaG]);
    // Restaurar datos temporales desde Firebase al abrir la app
    useEffect(() => {
      (async () => {
        try {
          const snap = await getDoc(doc(db, "financex_temp", "formData"));
          if (snap.exists()) {
            const temp = snap.data();
            if (temp.rowsI) setRowsI(temp.rowsI);
            if (temp.rowsG) setRowsG(temp.rowsG);
            if (temp.fechaI) setFechaI(temp.fechaI);
            if (temp.fechaG) setFechaG(temp.fechaG);
          }
        } catch {}
      })();
    }, []);
    useEffect(() => {
      const tempRaw = localStorage.getItem(TEMP_FORM_KEY);
      if (tempRaw) {
        try {
          const temp = JSON.parse(tempRaw);
          if (temp.rowsI) setRowsI(temp.rowsI);
          if (temp.rowsG) setRowsG(temp.rowsG);
          if (temp.fechaI) setFechaI(temp.fechaI);
          if (temp.fechaG) setFechaG(temp.fechaG);
        } catch {}
      }
    }, []);

    // Guardado manual de ingresos/egresos
    const [savedTempMsg, setSavedTempMsg] = useState(false);
    const [savedMsg, setSavedMsg] = useState(false);
    const guardarTemporal = () => {
      const temp = {
        rowsI,
        rowsG,
        fechaI,
        fechaG,
      };
      localStorage.setItem(TEMP_FORM_KEY, JSON.stringify(temp));
      setSavedTempMsg(true);
      setTimeout(() => setSavedTempMsg(false), 1200);
    };

    // Al registrar, limpiar datos temporales
    const limpiarTempForm = () => {
      localStorage.removeItem(TEMP_FORM_KEY);
    };

    // Egresos
    const updG = (id,k,v) => setRowsG(r=>r.map(x=>x.id===id?{...x,[k]:v}:x));
    const addG = () => setRowsG(r=>[...r, EROW(r.length)]);
    const delG = (id) => setRowsG(r=>r.filter(x=>x.id!==id));
    const totalG = useMemo(()=>rowsG.reduce((a,r)=>a+(+r.monto||0),0),[rowsG]);
    const hayG   = useMemo(()=>rowsG.some(r=>r.concepto.trim()&&+r.monto>0),[rowsG]);

    // ...existing code...
    const updI = (id,k,v) => setRowsI(r=>r.map(x=>x.id===id?{...x,[k]:v}:x));
    const addI = () => setRowsI(r=>[...r, EROW(r.length)]);
    const delI = (id) => setRowsI(r=>r.filter(x=>x.id!==id));
    const totalI = useMemo(()=>rowsI.reduce((a,r)=>a+(+r.monto||0),0),[rowsI]);
    const hayI   = useMemo(()=>rowsI.some(r=>+r.monto>0),[rowsI]);

    const totGRow = useMemo(()=>Object.fromEntries(METODOS.map(m=>[m.key,rowsG.filter(r=>r.caja===m.key&&+r.monto>0).reduce((a,r)=>a+(+r.monto),0)])),[rowsG]);
    const totIRow = useMemo(()=>Object.fromEntries(METODOS.map(m=>[m.key,rowsI.filter(r=>r.caja===m.key&&+r.monto>0).reduce((a,r)=>a+(+r.monto),0)])),[rowsI]);
    const conceptosEgreso = useMemo(() => {
      const set = new Set();
      Object.values(historial).forEach(dia => {
        dia.gastos?.forEach(g => { if (g.concepto?.trim()) set.add(normalizar(g.concepto)); });
      });
      // Deduplicar fuzzy: si dos conceptos son muy parecidos, mantener solo uno
      const todos = [...set].filter(Boolean).sort();
      const unicos = [];
      for (const c of todos) {
        const a = sinTildes(c);
        const yaExiste = unicos.some(u => {
          const b = sinTildes(u);
          if (a === b) return true;
          const dist = levenshtein(a, b);
          const maxD = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.35));
          return dist <= maxD;
        });
        if (!yaExiste) unicos.push(c);
      }
      return unicos;
    }, [historial]);

    const conceptosIngreso = useMemo(() => {
      const set = new Set();
      Object.values(historial).forEach(dia => {
        dia.ventas?.forEach(v => { if (v.concepto?.trim()) set.add(normalizar(v.concepto)); });
      });
      const todos = [...set].filter(Boolean).sort();
      const unicos = [];
      for (const c of todos) {
        const a = sinTildes(c);
        const yaExiste = unicos.some(u => {
          const b = sinTildes(u);
          if (a === b) return true;
          const dist = levenshtein(a, b);
          const maxD = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.35));
          return dist <= maxD;
        });
        if (!yaExiste) unicos.push(c);
      }
      return unicos;
    }, [historial]);

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
    // ...existing code...
    const updGI = (id,k,v) => setRowsGI(r=>r.map(x=>x.id===id?{...x,[k]:v}:x));
    const addGI = () => setRowsGI(r=>[...r, GI_ROW()]);
    const limpiarGI = () => setRowsGI(initGastosInternos());
    const totalGI = useMemo(()=>rowsGI.reduce((a,r)=>a+(+r.monto||0),0),[rowsGI]);

    useEffect(() => {
      setConteoLocal(prev => ({
        ...prev,
        ...Object.fromEntries(DENOMS.map(d => [d, conteo[d] || 0])),
        extra: conteo.extra || 0,
      }));
    }, [conteo]);

    const registrarTodo = async () => {
      const validasI = rowsI.filter(r => +r.monto > 0);
      const validasG = rowsG.filter(r => r.concepto.trim() && +r.monto > 0);
      if (!validasI.length && !validasG.length) return;
      const fecha = fechaI || fechaG || TODAY;

      // Guardar ingreso en Firebase
      let ventaFirestoreId = null;
      const ventaTotal = validasI.reduce((a, r) => a + Number(r.monto), 0);
      if (validasI.length > 0) {
        try {
          const ref = await addDoc(collection(db, "movimientos"), {
            tipo: "ingreso", monto: Number(ventaTotal), categoria: "Ventas",
            descripcion: "Ventas del día", fecha: serverTimestamp(), owner: "Johan",
          });
          ventaFirestoreId = ref.id;
        } catch (e) { console.error("Error en la operación de FinanceX:", e); }
      }

      // Guardar egresos en Firebase y obtener IDs
      const gastosConIds = await Promise.all(
        validasG.map(async r => {
          let firestoreId = null;
          try {
            const ref = await addDoc(collection(db, "movimientos"), {
              tipo: "egreso", monto: Number(r.monto),
              categoria: r.categoria || "Otros",
              descripcion: r.concepto.trim(),
              fecha: serverTimestamp(), owner: "Johan",
            });
            firestoreId = ref.id;
          } catch (e) { console.error("Error en la operación de FinanceX:", e); }
          return {
            id: uid(), hora: nowStr(), fecha,
            concepto: r.concepto.trim(), descripcion: r.concepto.trim(),
            monto: Number(r.monto), caja: r.caja,
            categoria: r.categoria || "Otros", firestoreId,
          };
        })
      );

      setHistorial(h => {
        const dia = h[fecha] || { ventas: [], gastos: [] };
        const nuevasVentas = validasI.length > 0 ? [...dia.ventas, {
          id: uid(), hora: nowStr(), fecha,
          concepto: "Ventas del día", descripcion: "Ventas del día",
          ...Object.fromEntries(METODOS.map(m => [m.key, validasI.filter(r => r.caja === m.key).reduce((a, r) => a + Number(r.monto), 0)])),
          total: ventaTotal, firestoreId: ventaFirestoreId,
        }] : dia.ventas;
        const nuevosGastos = validasG.length > 0
          ? [...dia.gastos, ...gastosConIds]
          : dia.gastos;
        return { ...h, [fecha]: { ventas: nuevasVentas, gastos: nuevosGastos } };
      });
      setRowsI(INIT_ROWS());
      setRowsG(INIT_ROWS());
      limpiarTempForm();
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 1200);
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

    const filasVentasMostradas = useMemo(() => {
      const fechasUnicas = [...new Set(filasVentas.map(f => f.fecha))];
      const fechasMostrar = verMesCompleto ? fechasUnicas : fechasUnicas.slice(-7);
      const set = new Set(fechasMostrar);
      return filasVentas.filter(f => set.has(f.fecha));
    }, [filasVentas, verMesCompleto]);

    // Totales filtrados por mes
    const mesEntradas = useMemo(()=>Object.entries(historial).filter(([f])=>f.startsWith(mesFiltro)).map(([,v])=>v),[historial,mesFiltro]);

    // Totales históricos acumulados por método de pago (ingresos - egresos)
    const saldoHistoricoPorMetodo = useMemo(() => {
      const totIngresos = Object.fromEntries(METODOS.map(m => [m.key, 0]));
      const totEgresos = Object.fromEntries(METODOS.map(m => [m.key, 0]));
      Object.values(historial).forEach(dia => {
        METODOS.forEach(m => {
          totIngresos[m.key] += (dia.ventas || []).reduce((a, v) => a + (+v[m.key] || 0), 0);
        });
        (dia.gastos || []).forEach(g => {
          if (totEgresos[g.caja] !== undefined) {
            totEgresos[g.caja] += +g.monto || 0;
          }
        });
      });
      return Object.fromEntries(METODOS.map(m => [m.key, totIngresos[m.key] - totEgresos[m.key]]));
    }, [historial]);

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

    // Movimientos recientes de la fecha activa
    const movimientosActivos = useMemo(() => {
      const dia = historial[fechaI] || { ventas: [], gastos: [] };
      return [
        ...dia.ventas.map(v => ({ ...v, _tipo: "venta" })),
        ...dia.gastos.map(g => ({ ...g, _tipo: "gasto" })),
      ].sort((a, b) => (b.hora || "00:00:00").localeCompare(a.hora || "00:00:00")).slice(0, 25);
    }, [historial, fechaI]);

    const balanceFecha = useMemo(() => {
      const dia = historial[fechaI] || { ventas: [], gastos: [] };
      const ingr = dia.ventas.reduce((a, v) => a + Number(v.total || 0), 0);
      const egr  = dia.gastos.reduce((a, g) => a + Number(g.monto || 0), 0);
      return { ingr, egr, neto: ingr - egr };
    }, [historial, fechaI]);

    const eliminarEntradaDia = (fecha, tipo, id) => {
      setHistorial(h => {
        const dia = h[fecha] || { ventas: [], gastos: [] };
        const key = tipo === "ingreso" ? "ventas" : "gastos";
        return { ...h, [fecha]: { ...dia, [key]: dia[key].filter(item => item.id !== id) } };
      });
    };

    const editarMovGuardado = (mov) => {
      const fecha = mov.fecha;
      const tipo = mov._tipo === "venta" ? "ventas" : "gastos";
      setHistorial(h => {
        const dia = h[fecha] || { ventas: [], gastos: [] };
        return { ...h, [fecha]: { ...dia, [tipo]: dia[tipo].map(item =>
          item.id !== mov.id ? item :
          tipo === "ventas" ? { ...item, concepto: normalizar(editCampos.concepto) } :
          { ...item, concepto: normalizar(editCampos.concepto), monto: +editCampos.monto || item.monto }
        )}};
      });
      setEditandoMov(null);
    };

    return (
      <div className="space-y-3">
        <style>{`.fodexa-scroll::-webkit-scrollbar{width:3px}.fodexa-scroll::-webkit-scrollbar-track{background:transparent}.fodexa-scroll::-webkit-scrollbar-thumb{background:#25252E;border-radius:4px}.fodexa-scroll::-webkit-scrollbar-thumb:hover{background:#374151}`}</style>

        {/* ── TARJETAS BALANCE FODEXA ── */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label:"Ingresos del día", val:balanceFecha.ingr, icon:ICONS.up,    color:"#10b981", bg:"#061a0f", border:"#10b98130" },
            { label:"Egresos del día",  val:balanceFecha.egr,  icon:ICONS.down,  color:"#f87171", bg:"#1a0606", border:"#f8717130" },
            { label:"Neto del día",     val:balanceFecha.neto, icon:ICONS.check,
              color: balanceFecha.neto >= 0 ? "#60a5fa" : "#f87171",
              bg:    balanceFecha.neto >= 0 ? "#060f1a" : "#1a0606",
              border:balanceFecha.neto >= 0 ? "#60a5fa30" : "#f8717130",
              gradient: balanceFecha.neto >= 0 },
          ].map(c => (
            <div key={c.label}
              className="rounded-2xl px-3 py-2.5 flex items-center gap-2.5 transition-all duration-300 ease-in-out hover:brightness-110 hover:scale-[1.02]"
              style={{background:c.bg, border:`1px solid ${c.border}`, backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", boxShadow:`0 0 28px ${c.border}55, inset 0 1px 0 rgba(255,255,255,0.04)`}}>  
              <div className="rounded-xl p-1.5 shrink-0" style={{background:c.color+"18"}}>
                <Ic d={c.icon} s={14} c={c.color}/>
              </div>
              <div className="min-w-0 flex-1">
                <div className="uppercase tracking-widest text-gray-500" style={{fontSize:"8px"}}>{c.label}</div>
                <div className="font-mono font-bold truncate"
                  style={c.gradient
                    ? {fontSize:"13px", background:"linear-gradient(135deg,#60a5fa,#818cf8)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text"}
                    : {color:c.color, fontSize:"13px"}}>
                  {$(c.val)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Fecha única compartida */}
        <div className="flex items-center gap-3 rounded-xl px-3 py-2" style={{background:"#16161D", border:"1px solid rgba(55,65,81,0.35)"}}>
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

        {/* Layout: [registro 30%] | [movimientos 70%] */}
        <div className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-[490px_1fr] lg:overflow-visible lg:gap-3">

          {/* Columna izquierda: ambas tablas + botón registrar */}
          <div className="shrink-0 flex flex-col gap-2 rounded-2xl p-2" style={{minWidth:360, background:"#0d0d10", border:"1px solid rgba(255,255,255,0.04)", boxShadow:"inset 0 1px 0 rgba(255,255,255,0.03)"}}>
            <datalist id="datalist-conceptos-egreso">
              {conceptosEgreso.map(c => <option key={c} value={c}/>)}
            </datalist>
            <datalist id="datalist-conceptos-ingreso">
              {conceptosIngreso.map(c => <option key={c} value={c}/>)}
            </datalist>
            <div className="flex gap-2">
              {[
                {
                  label:"Ingresos", color:"#6ee7b7",
                  rows:rowsI, upd:updI, add:addI, del:delI,
                  total:totalI, totRow:totIRow,
                  totalLabel:"??  TOTAL INGRESOS", totalColor:"text-emerald-400",
                  rowBgEven:"#0d1a11", rowBgOdd:"#0a1208",
                  montoColor:"#6ee7b7", sinConcepto: true,
                },
                {
                  label:"Egresos", color:"#fca5a5",
                  rows:rowsG, upd:updG, add:addG, del:delG,
                  total:totalG, totRow:totGRow,
                  totalLabel:"??  TOTAL EGRESOS", totalColor:"text-red-400",
                  rowBgEven:"#1a0d0d", rowBgOdd:"#120a0a",
                  montoColor:"#fca5a5", sinConcepto: false, tieneCategoria: true,
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
                          ? <><col style={{width:"46%"}}/><col style={{width:"54%"}}/></>
                          : <><col style={{width:"22%"}}/><col style={{width:"42%"}}/><col style={{width:"36%"}}/></>
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
                                  <input list="datalist-conceptos-egreso"
                                    className="w-full bg-transparent text-gray-200 focus:outline-none placeholder-gray-700"
                                    style={{fontSize:"10px"}} placeholder="concepto…"
                                    value={r.concepto}
                                    onChange={e=>{cfg.upd(r.id,"concepto",e.target.value); setAvisoRow(a=>({...a,[r.id]:null}));}}
                                    onBlur={e=>{const sug=conceptoSimilar(e.target.value,conceptosEgreso); setAvisoRow(a=>({...a,[r.id]:sug||null}));}}/>
                                  {avisoRow[r.id] && (
                                    <div style={{fontSize:"9px",color:"#fbbf24",marginTop:1,lineHeight:1.3}}>
                                      ¿Quisiste decir <b style={{color:"#f59e0b"}}>"{avisoRow[r.id]}"</b>?{' '}
                                      <span style={{cursor:"pointer",textDecoration:"underline"}} onMouseDown={e=>{e.preventDefault();cfg.upd(r.id,"concepto",avisoRow[r.id]);setAvisoRow(a=>({...a,[r.id]:null}));}}>Usar</span>
                                      {' · '}
                                      <span style={{cursor:"pointer",textDecoration:"underline"}} onMouseDown={e=>{e.preventDefault();setAvisoRow(a=>({...a,[r.id]:null}));}}>No</span>
                                    </div>
                                  )}
                                  {cfg.tieneCategoria && (r.categoria && r.categoria !== "Otros") && (
                                    <select
                                      className="w-full bg-transparent text-gray-500 focus:outline-none cursor-pointer appearance-none"
                                      style={{fontSize:"9px",marginTop:1}}
                                      value={r.categoria || "Otros"}
                                      onChange={e=>cfg.upd(r.id,"categoria",e.target.value)}>
                                      {CATEGORIAS_EGRESO.map(c=><option key={c} value={c} style={{background:"#1f2937",color:"#d1d5db"}}>{c}</option>)}
                                    </select>
                                  )}
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
            <div className="flex gap-2 mt-2">
              <button onClick={guardarTemporal}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 bg-yellow-700 hover:bg-yellow-600 text-white">
                <Ic d={ICONS.check} s={15} c="#fff"/> Guardar temporal
              </button>
              <button onClick={registrarTodo} disabled={(!hayI && !hayG) || savedMsg}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ease-in-out flex items-center justify-center gap-2
                  ${savedMsg
                    ? "bg-emerald-700 text-white scale-[0.98] shadow-lg shadow-emerald-900/50"
                    : (hayI||hayG)
                      ? "bg-gradient-to-r from-blue-900 to-violet-900 hover:from-blue-800 hover:to-violet-800 border border-blue-700/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-900/40 active:translate-y-0 text-white"
                      : "bg-[#16161D] text-gray-600 cursor-not-allowed border border-gray-800/50"}`}>
                <Ic d={ICONS.check} s={15} c={(savedMsg||hayI||hayG)?"#fff":"#4b5563"}/>
                {savedMsg ? "¡Guardado!" : "Registrar"}
              </button>
            </div>
            {savedTempMsg && (
              <div className="mt-1 text-xs text-yellow-300 font-mono text-center">Guardado temporal realizado</div>
            )}

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
                  <colgroup><col style={{width:"24%"}}/><col style={{width:"43%"}}/><col style={{width:"33%"}}/></colgroup>
                  <thead>
                    <tr className="bg-gray-800/80">
                      { ["MÉTODO","CONCEPTO","MONTO"].map(h=>(
                        <th key={h} className="border-b border-r border-gray-700 last:border-r-0 text-left px-1.5 py-1 text-gray-500 font-medium" style={{fontSize:"9px"}}>{h}</th>
                      )) }
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
                          <input list="datalist-conceptos-egreso"
                            className="w-full bg-transparent text-gray-200 focus:outline-none placeholder-gray-700"
                            style={{fontSize:"10px"}} placeholder="concepto…"
                            value={r.concepto}
                            onChange={e=>{updGI(r.id,"concepto",e.target.value); setAvisoRowGI(a=>({...a,[r.id]:null}));}}
                            onBlur={e=>{const sug=conceptoSimilar(e.target.value,conceptosEgreso); setAvisoRowGI(a=>({...a,[r.id]:sug||null}));}}/>
                          {avisoRowGI[r.id] && (
                            <div style={{fontSize:"9px",color:"#fbbf24",marginTop:1,lineHeight:1.3}}>
                              ¿Quisiste decir <b style={{color:"#f59e0b"}}>"{avisoRowGI[r.id]}"</b>?{' '}
                              <span style={{cursor:"pointer",textDecoration:"underline"}} onMouseDown={e=>{e.preventDefault();updGI(r.id,"concepto",avisoRowGI[r.id]);setAvisoRowGI(a=>({...a,[r.id]:null}));}}>Usar</span>
                              {' · '}
                              <span style={{cursor:"pointer",textDecoration:"underline"}} onMouseDown={e=>{e.preventDefault();setAvisoRowGI(a=>({...a,[r.id]:null}));}}>No</span>
                            </div>
                          )}
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
              <div className="flex gap-2 mt-2">
                <button onClick={() => {
                  // Guardado temporal de gastos internos
                  setDoc(doc(db, "financex_temp", "gastosInternos"), { rowsGI }, { merge: true });
                  setSavedConteoMsg(true);
                  setTimeout(() => setSavedConteoMsg(false), 1200);
                }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 bg-yellow-700 hover:bg-yellow-600 text-white">
                  <Ic d={ICONS.check} s={15} c="#fff"/> Guardar temporal
                </button>
                <button onClick={() => {
                  // Registrar gastos internos en historial
                  const fechaHoy = new Date().toISOString().split('T')[0];
                  const validasGI = rowsGI.filter(r => r.concepto.trim() && +r.monto > 0);
                  if (!validasGI.length) return;
                  setHistorial(h => {
                    const dia = h[fechaHoy] || { ventas: [], gastos: [] };
                    const nuevosGastos = [...dia.gastos, ...validasGI.map(r => ({
                      id: uid(), hora: nowStr(), fecha: fechaHoy, concepto: r.concepto.trim(), monto: +r.monto, caja: "Efectivo", categoria: "gasto interno"
                    }))];
                    return { ...h, [fechaHoy]: { ...dia, gastos: nuevosGastos } };
                  });
                  setRowsGI(initGastosInternos());
                  setSavedConteoMsg(true);
                  setTimeout(() => setSavedConteoMsg(false), 1200);
                }} className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white">
                  <Ic d={ICONS.check} s={15} c="#fff"/> Registrar
                </button>
                <button onClick={addGI} className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 text-gray-600 hover:text-orange-400 border border-gray-700/50" style={{fontSize:"10px"}}>
                  <Ic d={ICONS.plus} s={10}/> fila
                </button>
              </div>
              {savedConteoMsg && (
                <div className="mt-1 text-xs text-yellow-300 font-mono text-center">Guardado temporal realizado</div>
              )}
            </div>
          </div>

          {/* ── DERECHA: VENTAS ── */}
          <div className="flex-1 min-w-0" style={{minWidth:320}}>

            {/* Header */}
            <div className="rounded-t-xl border border-gray-800/60 border-b-0 px-2 py-1.5 flex items-center justify-between gap-2" style={{background:"#16161D"}}>
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider shrink-0">Ventas</span>
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
                  <col style={{width:20}}/>
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
                    <th className="border-gray-700" style={{width:20}}/>
                  </tr>
                </thead>
                <tbody>
                  {filasVentas.length===0 ? (
                    <tr style={{background:"#0f172a"}}>
                      <td colSpan={METODOS.length+3} className="py-6 text-center text-gray-600 text-xs">Sin registros</td>
                    </tr>
                  ) : (() => {
                    // Agrupar pares por fecha para aplicar rowspan y bordes
                    let lastFecha = null;
                    return filasVentasMostradas.flatMap((fila, i) => {
                      const isIngreso = fila.tipo === "ingreso";
                      const isNewFecha = fila.fecha !== lastFecha;
                      if (isIngreso) lastFecha = fila.fecha;
                      const bg = isIngreso ? "#0d1f0d" : "#1f0d0d";
                      const desplegKey = `${fila.fecha}-${fila.tipo}`;
                      const isDesplegado = filaDesplegada === desplegKey;
                      const entradas = isIngreso
                        ? (historial[fila.fecha]?.ventas || [])
                        : (historial[fila.fecha]?.gastos || []);
                      const rows = [
                        <tr key={desplegKey}
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
                          {/* Botón desglose ▼ */}
                          <td className="text-center px-0 py-0.5">
                            {entradas.length > 0 ? (
                              <button
                                onClick={() => setFilaDesplegada(isDesplegado ? null : desplegKey)}
                                className={`transition-all ${isDesplegado ? (isIngreso?"text-emerald-400":"text-red-400") : "text-gray-700 hover:text-gray-400"}`}
                                title="Ver desglose">
                                <Ic d={isDesplegado ? ICONS.up : ICONS.down} s={9}/>
                              </button>
                            ) : <span style={{color:"#1f2937",fontSize:"8px"}}>—</span>}
                          </td>
                        </tr>
                      ];
                      if (isDesplegado) {
                        rows.push(
                          <tr key={`${desplegKey}-detail`} style={{background: isIngreso ? "#061406" : "#140606"}}>
                            <td colSpan={METODOS.length + 3} className="px-3 py-2">
                              <div className="flex flex-col gap-0.5">
                                <div className="text-gray-600 font-semibold uppercase tracking-widest mb-1" style={{fontSize:"8px"}}>
                                  {isIngreso ? "Ventas registradas" : "Gastos registrados"} — {fila.fecha}
                                </div>
                                {entradas.map(item => {
                                  const total = isIngreso
                                    ? METODOS.reduce((a, m) => a + (+item[m.key] || 0), 0)
                                    : +item.monto || 0;
                                  return (
                                    <div key={item.id} className="flex items-center gap-2 border-b border-gray-800/40 py-0.5 last:border-b-0">
                                      <span className="text-gray-600 font-mono shrink-0" style={{fontSize:"9px"}}>{item.hora}</span>
                                      <span className="text-gray-300 flex-1 truncate" style={{fontSize:"9px"}}>{item.concepto || item.descripcion || "—"}</span>
                                      {!isIngreso && <span className="text-gray-500 shrink-0" style={{fontSize:"9px"}}>{item.caja}</span>}
                                      <span className={`font-mono font-bold shrink-0 ${isIngreso?"text-emerald-400":"text-red-400"}`} style={{fontSize:"9px"}}>
                                        {$(total)}
                                      </span>
                                      <button
                                        onClick={() => eliminarEntradaDia(fila.fecha, fila.tipo, item.id)}
                                        className="text-gray-700 hover:text-red-400 transition-all shrink-0"
                                        title="Eliminar entrada">
                                        <Ic d={ICONS.trash} s={9}/>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      return rows;
                    });
                  })()}

                  {/* Filas vacías */}
                  {Array.from({length:Math.max(0,10-filasVentasMostradas.length)}).map((_,i)=>(
                    <tr key={`empty${i}`} style={{background:i%2===0?"#0f172a":"#111827"}}>
                      <td className="border-r border-gray-700/30 py-1" style={{height:18}}/>
                      <td className="border-r border-gray-700/30"/>
                      {METODOS.map(m=><td key={m.key} className="border-r border-gray-700/20 last:border-r-0"/>)}
                      <td/>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* Ingresos totales */}
                  <tr className="border-t-2 border-gray-600 bg-emerald-900/20">
                    <td className="border-r border-gray-700/50 px-1 py-1 text-emerald-400 font-bold" style={{fontSize:"9px"}}>??  TOTAL INGRESOS</td>
                    <td className="border-r border-gray-700/50 text-center" style={{fontSize:"9px"}}><span className="text-emerald-500">↑</span></td>
                    {METODOS.map(m=>(
                      <td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold"
                        style={{fontSize:"10px",color:totV[m.key]>0?"#6ee7b7":"#374151"}}>
                        {totV[m.key]>0?fmtK(totV[m.key]):"—"}
                      </td>
                    ))}
                    <td/>
                  </tr>
                  {/* Egresos totales */}
                  <tr className="border-t border-gray-700/50 bg-red-900/20">
                    <td className="border-r border-gray-700/50 px-1 py-1 text-red-400 font-bold" style={{fontSize:"9px"}}>??  TOTAL EGRESOS</td>
                    <td className="border-r border-gray-700/50 text-center" style={{fontSize:"9px"}}><span className="text-red-500">↓</span></td>
                    {METODOS.map(m=>(
                      <td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold"
                        style={{fontSize:"10px",color:totG[m.key]>0?"#fca5a5":"#374151"}}>
                        {totG[m.key]>0?fmtK(totG[m.key]):"—"}
                      </td>
                    ))}
                    <td/>
                  </tr>
                  {/* Total Saldo (histórico acumulado por método) */}
                  <tr className="border-t-2 border-gray-500 bg-gray-800/80">
                    <td className="border-r border-gray-700/50 px-1 py-1 text-white font-bold" style={{fontSize:"9px"}}>Total Saldo</td>
                    <td className="border-r border-gray-700/50 text-center" style={{fontSize:"9px"}}><span className="text-blue-400">=</span></td>
                    {METODOS.map(m=>{
                      const n = saldoHistoricoPorMetodo[m.key] || 0;
                      return (
                        <td key={m.key} className="border-r border-gray-700/40 last:border-r-0 text-center font-mono font-bold"
                          style={{fontSize:"10px",color:n>0?"#93c5fd":n<0?"#f87171":"#374151"}}>
                          {n!==0?fmtK(n):"—"}
                        </td>
                      );
                    })}
                    <td/>
                  </tr>
                  {/* Saldo del mes (única fila) */}
                  <tr className="border-t border-blue-800/50 bg-blue-950/40">
                    <td colSpan={2} className="border-r border-gray-700/50 px-1 py-1 text-blue-300 font-bold" style={{fontSize:"9px"}}>
                      Saldo Total
                    </td>
                    <td colSpan={METODOS.length + 1} className="px-2 py-1 text-right font-mono font-bold"
                      style={{fontSize:"11px", color: saldoHistorico>0?"#93c5fd":saldoHistorico<0?"#f87171":"#374151"}}>
                      {saldoHistorico!==0 ? fmtK(saldoHistorico) : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ── TOGGLE VER MES COMPLETO ── */}
            {(() => {
              const totalDias = new Set(filasVentas.map(f => f.fecha)).size;
              const diasOcultos = totalDias - Math.min(7, totalDias);
              if (totalDias <= 7) return null;
              return (
                <button
                  onClick={() => setVerMesCompleto(v => !v)}
                  className="w-full mt-1 py-1.5 flex items-center justify-center gap-1.5 text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 rounded-lg transition-all"
                  style={{fontSize:"10px"}}>
                  <Ic d={verMesCompleto ? ICONS.up : ICONS.down} s={9}/>
                  {verMesCompleto
                    ? "Ver menos (últimos 7 días)"
                    : `Ver mes completo (${diasOcultos} días más)`}
                </button>
              );
            })()}

            {/* ── CALCULADORA BILLETES Y MONEDAS (modal) ── */}
            {showFondo && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.7)"}} onClick={()=>setShowFondo(false)}>
            <div className="rounded-2xl overflow-hidden shadow-2xl" style={{background:"#111118",border:"1px solid rgba(124,53,0,0.6)",maxWidth:"98vw"}} onClick={e=>e.stopPropagation()}>
              {/* Header modal */}
              <div className="flex items-center justify-between px-4 py-2.5" style={{background:"#7c3500"}}>
                <span className="text-orange-100 font-bold text-sm tracking-wide">Fondo de Caja</span>
                <button onClick={()=>setShowFondo(false)} className="text-orange-200 hover:text-white text-lg leading-none">&times;</button>
              </div>
              <div className="p-3 overflow-x-auto">
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
            </div>
            )}

          </div>
        </div>

        {/* ── MOVIMIENTOS RECIENTES ── */}
        <div className="mt-1">
          <div className="rounded-t-xl border border-gray-800/60 border-b-0 px-3 py-2 flex items-center justify-between" style={{background:"#16161D"}}>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Movimientos Recientes</span>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono" style={{color:"#6ee7b7"}}>↑ {$(balanceFecha.ingr)}</span>
              <span className="text-xs font-mono text-red-400">↓ {$(balanceFecha.egr)}</span>
              <span className={`text-xs font-mono font-bold ${balanceFecha.neto >= 0 ? "text-blue-400" : "text-red-400"}`}>
                = {$(balanceFecha.neto)}
              </span>
            </div>
          </div>
          <div className="border border-gray-800/60 rounded-b-xl overflow-hidden">
            <div className="overflow-y-auto max-h-[600px] fodexa-scroll" style={{scrollbarWidth:"thin",scrollbarColor:"#25252E transparent"}}>
            <table className="w-full border-collapse" style={{tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:46}}/><col style={{width:62}}/><col/><col style={{width:110}}/><col style={{width:76}}/><col style={{width:52,minWidth:52,maxWidth:52}}/>
              </colgroup>
              <thead>
                <tr className="sticky top-0 z-10 border-b border-gray-800/70" style={{background:"#1a1a21"}}>
                  {["Hora","Tipo","Descripción","Categoría","Monto",""].map(h=>(
                    <th key={h} className="px-2 py-1.5 text-left text-gray-500 font-semibold uppercase tracking-wider border-r border-gray-800/40 last:border-r-0" style={{fontSize:"9px"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movimientosActivos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-14 text-center">
                      <div className="flex flex-col items-center gap-3 opacity-40 select-none">
                        <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="16" rx="2"/>
                          <path d="M3 9h18M8 4v5M16 4v5"/>
                        </svg>
                        <span className="text-gray-500 text-xs font-medium tracking-widest uppercase">No hay movimientos registrados hoy</span>
                      </div>
                    </td>
                  </tr>
                ) : movimientosActivos.map(mov => {
                  const isIngreso = mov._tipo === "venta";
                  return (
                    <tr key={mov.id}
                      className="border-b border-gray-800/15 last:border-b-0 hover:bg-white/[0.025] transition-all duration-300 ease-in-out group"
                      style={{background: isIngreso ? "#0a1a0a" : "#1a0a0a"}}>
                      <td className="px-2 py-1.5 text-gray-500 font-mono border-r border-gray-800/40" style={{fontSize:"10px"}}>{mov.hora}</td>
                      <td className="px-2 py-1.5 border-r border-gray-800/40">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${isIngreso ? "text-emerald-400 bg-emerald-900/30" : "text-red-400 bg-red-900/30"}`}
                          style={{fontSize:"9px"}}>
                          {isIngreso ? "↑ Ingreso" : "↓ Egreso"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-sm text-gray-300 truncate border-r border-gray-800/40">
                        {editandoMov === mov.id
                          ? <input autoFocus className="w-full bg-transparent text-sm text-gray-200 focus:outline-none border-b border-blue-500/50" value={editCampos.concepto} onChange={e=>setEditCampos(c=>({...c,concepto:e.target.value}))}/>
                          : (mov.concepto || mov.descripcion || "—")}
                      </td>
                      <td className="px-2 py-1.5 border-r border-gray-800/40">
                        <span className="bg-[#0f1629] border border-blue-800/50 px-2 py-0.5 rounded-full font-medium text-blue-200 uppercase tracking-wide" style={{fontSize:"9px"}}>
                          {mov.categoria || (isIngreso ? "Ventas" : "—")}
                        </span>
                      </td>
                      <td className={`px-2 py-1.5 text-right font-mono font-bold border-r border-gray-800/40 ${isIngreso ? "text-emerald-400" : "text-red-400"}`} style={{fontSize:"11px"}}>
                        {editandoMov === mov.id
                          ? <input type="number" className="w-full bg-transparent text-right font-mono font-bold focus:outline-none border-b border-blue-500/50" style={{color:isIngreso?"#34d399":"#f87171",fontSize:"11px"}} value={editCampos.monto} onChange={e=>setEditCampos(c=>({...c,monto:e.target.value}))}/>
                          : (isIngreso ? `+${$(Number(mov.total || 0))}` : `−${$(Number(mov.monto || 0))}`)}
                      </td>
                      <td className="px-1 py-1.5 text-center overflow-hidden" style={{width:52,minWidth:52,maxWidth:52}}>
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          {editandoMov === mov.id ? (
                            <button
                              onClick={() => editarMovGuardado(mov)}
                              className="text-gray-600 hover:text-emerald-400 transition-all"
                              title="Guardar cambios">
                              <Ic d={ICONS.check} s={11}/>
                            </button>
                          ) : (
                            <button
                              onClick={() => { setEditandoMov(mov.id); setEditCampos({ concepto: mov.concepto || mov.descripcion || "", monto: mov.total || mov.monto || 0 }); }}
                              className="text-gray-600 hover:text-blue-400 transition-all"
                              title="Editar movimiento">
                              <Ic d={ICONS.pencil} s={11}/>
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(mov.id)}
                            className="text-gray-600 hover:text-red-400 transition-all"
                            title="Eliminar movimiento">
                            <Ic d={ICONS.trash} s={11}/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  // Estado para colapsar barra lateral
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Iconos personalizados para cada pestaña
  const TAB_ICONS = {
    cajaDiaria: ICONS.cashRegister,
    historial: ICONS.notebook,
    metricas: ICONS.check,
  };
  return (
    <div className="h-screen w-screen bg-[#08080A] text-white flex flex-col overflow-hidden" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* HEADER */}
      <header className="shrink-0 z-30 border-b border-gray-800/30 px-4 py-3 flex items-center justify-between" style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", background: "rgba(8,8,10,0.97)" }}>
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
            onClick={() => setMostrarVisualizador(true)}
            className="text-xs text-purple-400 hover:text-purple-300 border border-purple-800/60 px-2.5 py-1.5 rounded-lg transition-colors"
            title="Ver datos en tablas"
          >
            📊 Ver Datos
          </button>
          <button
            onClick={descargarBackup}
            disabled={exportingBackup}
            className={`text-xs border px-2.5 py-1.5 rounded-lg transition-colors ${exportingBackup ? "border-gray-700/40 text-gray-500 cursor-not-allowed" : "text-blue-400 hover:text-blue-300 border-blue-800/60"}`}
            title="Descargar respaldo EXCEL"
          >
            {exportingBackup ? "⏳ Preparando..." : "💾 Excel"}
          </button>
          <button
            onClick={reiniciarTodo}
            className="text-xs text-red-400 hover:text-red-300 border border-red-800/60 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            Reiniciar Todo
          </button>
          <div className="text-xs text-gray-500 font-mono">
            Neto: <span className={saldoMesActual >= 0 ? "text-emerald-400" : "text-red-400"}>{$(saldoMesActual)}</span>
          </div>
        </div>
      </header>

      {/* ⚠️ ALERTA SINCRONIZACIÓN BLOQUEADA */}
      {sincroBloqueada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.8)" }}>
          <div className="bg-gray-900 border-2 border-yellow-600 rounded-2xl p-6 max-w-md mx-4 shadow-2xl">
            <div className="text-yellow-500 font-bold text-lg mb-3">⚠️ Sincronización Bloqueada</div>
            <div className="text-gray-300 text-sm mb-4 space-y-2">
              <p>Se detectó un problema: <strong>los datos en la nube parecen vacíos o corruptos</strong>.</p>
              <p>Para evitar pérdida de datos, la sincronización automática ha sido <strong>bloqueada</strong>.</p>
              <p className="text-yellow-400">✓ Tus datos locales están <strong>protegidos y seguros</strong>.</p>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 mb-4 text-xs text-gray-400 max-h-40 overflow-y-auto">
              <div className="font-mono mb-2">📊 Resumen de datos locales:</div>
              <div>Días registrados: {Object.keys(historial).length}</div>
              <div>Meses guardados: {Object.keys(mesesGuardados).length}</div>
              <div>Última sincronización: {new Date().toLocaleString('es-CO')}</div>
            </div>
            <div className="flex gap-2 flex-col">
              <button
                onClick={recuperarDatos}
                className="w-full py-2.5 rounded-xl bg-green-700 hover:bg-green-600 text-white font-semibold transition-colors"
              >
                ✓ Usar Datos Locales
              </button>
              <button
                onClick={descargarBackup}
                className="w-full py-2.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-white font-semibold transition-colors"
              >
                ↓ Descargar Backup JSON
              </button>
              <button
                onClick={habilitarSincroDatos}
                className="w-full py-2.5 rounded-xl border border-yellow-600 text-yellow-400 hover:bg-yellow-900/20 font-semibold transition-colors text-sm"
              >
                ⚡ Habilitar Sincronización (con cuidado)
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-3 text-center">
              💾 Los datos se guardan automáticamente en tu navegador
            </div>
          </div>
        </div>
      )}

      {/* 💡 BANNER de recuperación rápida SI has descargado datos */}
      {!sincroBloqueada && Object.keys(historial).length > 0 && (
        <div className="bg-blue-900/30 border-b border-blue-700/50 px-4 py-2 flex items-center justify-between gap-2">
          <div className="text-xs text-blue-300 flex-1">
            📌 <strong>{Object.keys(historial).length}</strong> días registrados | <strong>{Object.keys(mesesGuardados).length}</strong> meses guardados
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMostrarVisualizador(true)}
              className="text-xs bg-purple-700 hover:bg-purple-600 text-white px-3 py-1 rounded-lg transition-colors shrink-0"
              title="Ver datos en tablas"
            >
              📊 Ver
            </button>
            <button
              onClick={descargarBackup}
              disabled={exportingBackup}
              className={`text-xs px-3 py-1 rounded-lg transition-colors shrink-0 ${exportingBackup ? "bg-gray-700 text-gray-500 cursor-not-allowed" : "bg-blue-700 hover:bg-blue-600 text-white"}`}
              title="Descargar en Excel"
            >
              {exportingBackup ? "⏳..." : "💾 Excel"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* TABS LATERAL COLAPSABLE */}
        <aside className={`${sidebarCollapsed ? 'w-16' : 'w-36'} shrink-0 flex flex-col transition-all duration-300 border-r border-gray-800/30`} style={{background:"#0d0d10"}}>
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className="w-full flex items-center justify-center py-3 border-b border-gray-800/40 text-gray-500 hover:text-white transition-colors"
            style={{ fontSize: '18px' }}
          >
            <Ic d={sidebarCollapsed ? ICONS.right : ICONS.left} s={18} />
          </button>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-start'} px-3 py-3.5 text-sm font-semibold transition-all border-l-2 ${
                tab === t.id
                  ? "border-blue-500/80 text-white" 
                  : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]"
              }`}
              style={{ letterSpacing: '0.5px', background: tab === t.id ? 'rgba(59,130,246,0.07)' : undefined }}
            >
              <Ic d={TAB_ICONS[t.id]} s={20} c={tab === t.id ? '#3b82f6' : '#6b7280'} />
              {!sidebarCollapsed && <span className="ml-3 font-medium text-sm">{t.label}</span>}
            </button>
          ))}
        </aside>

        {/* CONTENT */}
        <main className="flex-1 min-w-0 overflow-y-auto" style={{background:"#08080A"}}>
          <div className="px-3 py-3 pb-8">
            {tab === "cajaDiaria" && <ViewCajaDiaria />}
            {tab === "historial"  && <ViewHistorial />}
            {tab === "metricas"   && <ViewMetricas historial={historial} />}
          </div>
        </main>
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
                    <input type="number" inputMode="numeric" min="0"
                      className="w-full bg-transparent text-emerald-300 text-xs font-mono text-center py-2.5 px-0.5 focus:outline-none placeholder-gray-700 focus:bg-emerald-900/20"
                      placeholder="0" value={fVenta[m.key] || ""}
                      onKeyDown={e=>e.key==="-"&&e.preventDefault()}
                      onChange={e => setFVenta(p => ({ ...p, [m.key]: Math.max(0,+e.target.value||0)||"" }))} />
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
                    <input type="number" inputMode="numeric" min="0"
                      className="w-full bg-transparent text-red-300 text-xs font-mono text-center py-2.5 px-0.5 focus:outline-none placeholder-gray-700 focus:bg-red-900/20"
                      placeholder="0" value={fGasto[`monto_${m.key}`] || ""}
                      onKeyDown={e=>e.key==="-"&&e.preventDefault()}
                      onChange={e => setFGasto(p => ({ ...p, [`monto_${m.key}`]: Math.max(0,+e.target.value||0)||"" }))} />
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
                    onChange={e => { setFGasto(p => ({ ...p, concepto: e.target.value })); setAvisoFGasto(null); }}
                    onBlur={e => { const sug=conceptoSimilar(e.target.value,conceptosEgreso); setAvisoFGasto(sug||null); }} />
                  {avisoFGasto && (
                    <div style={{fontSize:"11px",color:"#fbbf24",marginTop:3}}>
                      ¿Quisiste decir <b style={{color:"#f59e0b"}}>"{avisoFGasto}"</b>?{' '}
                      <span style={{cursor:"pointer",textDecoration:"underline"}} onMouseDown={e=>{e.preventDefault();setFGasto(p=>({...p,concepto:avisoFGasto}));setAvisoFGasto(null);}}>Usar</span>
                      {' · '}
                      <span style={{cursor:"pointer",textDecoration:"underline"}} onMouseDown={e=>{e.preventDefault();setAvisoFGasto(null);}}>Ignorar</span>
                    </div>
                  )}
                </div>
                <div>
                  <Lbl>Categoría</Lbl>
                  <select className={inp} value={fGasto.categoria} onChange={e => setFGasto(p => ({ ...p, categoria: e.target.value }))}>
                    {CATEGORIAS_EGRESO.map(c => (
                      <option key={c} value={c} style={{background:"#1f2937",color:"#d1d5db"}}>{c}</option>
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

            <button onClick={async () => {
              const totalIngreso = METODOS.reduce((a, m) => a + (+fVenta[m.key] || 0), 0);
              const totalEgreso  = METODOS.reduce((a, m) => a + (+fGasto[`monto_${m.key}`] || 0), 0);
              if (!totalIngreso && !totalEgreso) return;
              const fecha = fVenta.fecha || TODAY;

              // Guardar ingreso en Firebase
              let ventaFSId = null;
              if (totalIngreso > 0) {
                try {
                  const ref = await addDoc(collection(db, "movimientos"), {
                    tipo: "ingreso", monto: Number(totalIngreso),
                    categoria: "Ventas", descripcion: fVenta.concepto || "Ventas del día",
                    fecha: serverTimestamp(), owner: "Johan",
                  });
                  ventaFSId = ref.id;
                } catch (e) { console.error("Error en la operación de FinanceX:", e); }
              }

              // Guardar egresos en Firebase
              const egresosFS = await Promise.all(
                METODOS.filter(m => +fGasto[`monto_${m.key}`] > 0).map(async m => {
                  let firestoreId = null;
                  try {
                    const ref = await addDoc(collection(db, "movimientos"), {
                      tipo: "egreso", monto: Number(fGasto[`monto_${m.key}`]),
                      categoria: fGasto.categoria || "Otros",
                      descripcion: fGasto.concepto || "Egreso",
                      fecha: serverTimestamp(), owner: "Johan",
                    });
                    firestoreId = ref.id;
                  } catch (e) { console.error("Error en la operación de FinanceX:", e); }
                  return { id: uid(), hora: nowStr(), fecha,
                    concepto: fGasto.concepto || "Egreso", descripcion: fGasto.concepto || "Egreso",
                    monto: Number(fGasto[`monto_${m.key}`]), caja: m.key,
                    categoria: fGasto.categoria || "Otros", firestoreId };
                })
              );

              setHistorial(h => {
                const dia = h[fecha] || { ventas: [], gastos: [] };
                const nuevasVentas = totalIngreso > 0
                  ? [...dia.ventas, { id: uid(), hora: nowStr(), fecha, concepto: fVenta.concepto || "Ventas del día",
                      descripcion: fVenta.concepto || "Ventas del día",
                      ...Object.fromEntries(METODOS.map(m => [m.key, Number(fVenta[m.key] || 0)])),
                      total: Number(totalIngreso), firestoreId: ventaFSId }]
                  : dia.ventas;
                const nuevosGastos = egresosFS.length > 0 ? [...dia.gastos, ...egresosFS] : dia.gastos;
                return { ...h, [fecha]: { ventas: nuevasVentas, gastos: nuevosGastos } };
              });
              setFVenta({ concepto: "", fecha: TODAY, ...Object.fromEntries(METODOS.map(m => [m.key, ""])) });
              setFGasto({ concepto: "", monto: "", caja: "efectivo", categoria: "Otros", descripcion: "" });
              setSheetVenta(false);
            }} className="w-full py-3 rounded-xl text-sm font-semibold bg-blue-700 hover:bg-blue-600 text-white transition-all">
              <span className="flex items-center justify-center gap-2"><Ic d={ICONS.check} s={15} /> Guardar</span>
            </button>

          </div>
        </Sheet>
      )}

      {/* VISUALIZADOR DE DATOS */}
      {mostrarVisualizador && <VisualizadorDatos />}
    </div>
  );
}




