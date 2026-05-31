import React, { useMemo, useState } from "react";

const fmtMoney = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CO")}`;

const parseAmount = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const clean = String(value || "").replace(/[^\d]/g, "");
  return clean ? Number(clean) : 0;
};

const todayLocal = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const fmtDate = (value) => {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};

const diffDays = (from, to) => {
  const start = new Date(`${from}T12:00:00`).getTime();
  const end = new Date(`${to}T12:00:00`).getTime();
  return Math.round((end - start) / 86400000);
};

const fmtFrequency = (value) => {
  if (!Number.isFinite(value) || value <= 0) return "Compra única";
  if (value < 1.5) return "Casi diario";
  return `Cada ${Math.round(value)} días`;
};

const fmtRecurrence = (item) => {
  if (item.diasConCompra <= 1) return "Compra única";
  if (item.diasConCompra === 2) return "Recurrencia baja";
  return fmtFrequency(item.frecuenciaPromedio);
};

export default function ViewMetricas({ historial }) {
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState("mayor-menor");

  const metricas = useMemo(() => {
    const agrupados = {};

    Object.entries(historial || {}).forEach(([fecha, dia]) => {
      (dia?.gastos || []).forEach((gasto) => {
        const proveedor = gasto.concepto?.trim() || "Otro";
        const clave = proveedor.toLocaleLowerCase();

        if (!agrupados[clave]) {
          agrupados[clave] = {
            proveedor,
            compras: [],
          };
        }

        agrupados[clave].compras.push({
          ...gasto,
          fecha,
          monto: parseAmount(gasto.monto),
        });
      });
    });

    return Object.values(agrupados).map(({ proveedor, compras }) => {
      const comprasOrdenadas = [...compras]
        .filter(item => item.monto > 0)
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
      const total = comprasOrdenadas.reduce((sum, item) => sum + item.monto, 0);
      const fechasUnicas = [...new Set(comprasOrdenadas.map(item => item.fecha))];
      const intervalos = fechasUnicas.slice(1).map((fecha, index) => diffDays(fechasUnicas[index], fecha));
      const frecuenciaPromedio = intervalos.length
        ? intervalos.reduce((sum, value) => sum + value, 0) / intervalos.length
        : null;
      const primeraFecha = fechasUnicas[0] || null;
      const ultimaFecha = fechasUnicas[fechasUnicas.length - 1] || null;
      const promedioCompra = comprasOrdenadas.length ? total / comprasOrdenadas.length : 0;
      const compraMayor = comprasOrdenadas.reduce((max, item) => Math.max(max, item.monto), 0);
      const compraMenor = comprasOrdenadas.reduce((min, item) => Math.min(min, item.monto), comprasOrdenadas[0]?.monto ?? 0);
      const diasSinComprar = ultimaFecha ? diffDays(ultimaFecha, todayLocal()) : null;
      const cajas = [...new Set(comprasOrdenadas.map(item => item.caja).filter(Boolean))];
      const esRecurrenteFuerte = fechasUnicas.length >= 3;

      return {
        proveedor,
        total,
        cantidad: comprasOrdenadas.length,
        diasConCompra: fechasUnicas.length,
        frecuenciaPromedio,
        primeraFecha,
        ultimaFecha,
        promedioCompra,
        compraMayor,
        compraMenor,
        diasSinComprar,
        cajas,
        fechasResumen: fechasUnicas.slice(-4).reverse(),
        esRecurrenteFuerte,
      };
    }).filter(item => item.cantidad > 0);
  }, [historial]);

  const metricasFiltradas = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase();
    const filtradas = termino
      ? metricas.filter(item => item.proveedor.toLocaleLowerCase().includes(termino))
      : metricas;

    return [...filtradas].sort((a, b) => {
      if (orden === "menor-mayor") return a.total - b.total;
      if (orden === "frecuencia") {
        const scoreA = a.esRecurrenteFuerte ? 0 : 1;
        const scoreB = b.esRecurrenteFuerte ? 0 : 1;
        if (scoreA !== scoreB) return scoreA - scoreB;
        const freqA = Number.isFinite(a.frecuenciaPromedio) ? a.frecuenciaPromedio : Number.POSITIVE_INFINITY;
        const freqB = Number.isFinite(b.frecuenciaPromedio) ? b.frecuenciaPromedio : Number.POSITIVE_INFINITY;
        return freqA - freqB;
      }
      if (orden === "reciente") return (a.ultimaFecha || "").localeCompare(b.ultimaFecha || "") * -1;
      if (orden === "a-z") return a.proveedor.localeCompare(b.proveedor, "es", { sensitivity: "base" });
      if (orden === "z-a") return b.proveedor.localeCompare(a.proveedor, "es", { sensitivity: "base" });
      return b.total - a.total;
    });
  }, [busqueda, orden, metricas]);

  const resumen = useMemo(() => {
    const totalGeneral = metricas.reduce((sum, item) => sum + item.total, 0);
    const recurrentes = metricas.filter(item => item.diasConCompra > 1).length;
    const masFrecuente = [...metricas]
      .filter(item => item.esRecurrenteFuerte && Number.isFinite(item.frecuenciaPromedio))
      .sort((a, b) => {
        if (a.diasConCompra !== b.diasConCompra) return b.diasConCompra - a.diasConCompra;
        return a.frecuenciaPromedio - b.frecuenciaPromedio;
      })[0] || null;
    const mayorImpacto = [...metricas].sort((a, b) => b.total - a.total)[0] || null;

    return {
      totalGeneral,
      recurrentes,
      masFrecuente,
      mayorImpacto,
    };
  }, [metricas]);

  return (
    <div className="max-w-6xl mx-auto mt-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-blue-400">Métricas Inteligentes de Gastos</h2>
        <p className="text-sm text-gray-400">Analiza recurrencia, fechas de compra, frecuencia promedio y comportamiento de cada proveedor o concepto.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Total analizado</div>
          <div className="text-2xl font-bold text-white">{fmtMoney(resumen.totalGeneral)}</div>
          <div className="text-xs text-gray-400 mt-2">{metricas.length} proveedor(es) o concepto(s)</div>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Compras recurrentes</div>
          <div className="text-2xl font-bold text-amber-300">{resumen.recurrentes}</div>
          <div className="text-xs text-gray-400 mt-2">Con compras en más de una fecha</div>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Más frecuente</div>
          <div className="text-lg font-bold text-emerald-300">{resumen.masFrecuente?.proveedor || "-"}</div>
          <div className="text-xs text-gray-400 mt-2">{resumen.masFrecuente ? `${fmtRecurrence(resumen.masFrecuente)} · ${resumen.masFrecuente.diasConCompra} fechas` : "Sin recurrencia suficiente"}</div>
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Mayor impacto</div>
          <div className="text-lg font-bold text-red-300">{resumen.mayorImpacto?.proveedor || "-"}</div>
          <div className="text-xs text-gray-400 mt-2">{resumen.mayorImpacto ? fmtMoney(resumen.mayorImpacto.total) : "Sin datos"}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
        <div className="flex flex-col lg:flex-row gap-3 mb-4">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar proveedor o concepto específico"
            className="flex-1 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500"
          />
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white outline-none focus:border-blue-500"
          >
            <option value="mayor-menor">Total: mayor a menor</option>
            <option value="menor-mayor">Total: menor a mayor</option>
            <option value="frecuencia">Frecuencia: más seguido primero</option>
            <option value="reciente">Última compra: más reciente</option>
            <option value="a-z">Nombre: A a Z</option>
            <option value="z-a">Nombre: Z a A</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-900/80 text-gray-300">
                <th className="px-3 py-2 border border-gray-800 text-left">Proveedor/Concepto</th>
                <th className="px-3 py-2 border border-gray-800 text-right">Total</th>
                <th className="px-3 py-2 border border-gray-800 text-center">Compras</th>
                <th className="px-3 py-2 border border-gray-800 text-center">Días con compra</th>
                <th className="px-3 py-2 border border-gray-800 text-left">Frecuencia</th>
                <th className="px-3 py-2 border border-gray-800 text-left">Primera / Última</th>
                <th className="px-3 py-2 border border-gray-800 text-right">Promedio por compra</th>
                <th className="px-3 py-2 border border-gray-800 text-left">Fechas recientes</th>
              </tr>
            </thead>
            <tbody>
              {metricasFiltradas.map((item) => (
                <tr key={item.proveedor} className="bg-gray-950/60 align-top">
                  <td className="px-3 py-3 border border-gray-800">
                    <div className="font-semibold text-white">{item.proveedor}</div>
                    <div className="text-xs text-gray-500 mt-1">Cajas: {item.cajas.length ? item.cajas.join(", ") : "-"}</div>
                  </td>
                  <td className="px-3 py-3 border border-gray-800 text-right font-semibold text-red-300">{fmtMoney(item.total)}</td>
                  <td className="px-3 py-3 border border-gray-800 text-center text-white">{item.cantidad}</td>
                  <td className="px-3 py-3 border border-gray-800 text-center text-white">{item.diasConCompra}</td>
                  <td className="px-3 py-3 border border-gray-800 text-gray-200">
                    <div>{fmtRecurrence(item)}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {Number.isFinite(item.diasSinComprar) ? `${item.diasSinComprar} día(s) desde la última compra` : "Sin historial suficiente"}
                    </div>
                  </td>
                  <td className="px-3 py-3 border border-gray-800 text-gray-200">
                    <div className="text-xs text-gray-400">Primera: <span className="text-white">{fmtDate(item.primeraFecha)}</span></div>
                    <div className="text-xs text-gray-400 mt-1">Última: <span className="text-white">{fmtDate(item.ultimaFecha)}</span></div>
                  </td>
                  <td className="px-3 py-3 border border-gray-800 text-right text-gray-200">
                    <div>{fmtMoney(item.promedioCompra)}</div>
                    <div className="text-xs text-gray-500 mt-1">Min: {fmtMoney(item.compraMenor)} / Max: {fmtMoney(item.compraMayor)}</div>
                  </td>
                  <td className="px-3 py-3 border border-gray-800 text-xs text-gray-300">
                    {item.fechasResumen.length > 0 ? item.fechasResumen.map(fecha => fmtDate(fecha)).join(" · ") : "-"}
                  </td>
                </tr>
              ))}
              {metricasFiltradas.length === 0 && (
                <tr className="bg-gray-950/60">
                  <td colSpan={8} className="px-3 py-6 border border-gray-800 text-center text-gray-400">
                    No se encontraron resultados para la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
