import React, { useMemo } from "react";

export default function ViewMetricas({ historial }) {
  // Agrupar egresos por concepto/proveedor
  const gastosPorProveedor = useMemo(() => {
    const agrupados = {};
    Object.values(historial).forEach(dia => {
      (dia.gastos || []).forEach(g => {
        const prov = g.concepto?.trim() || "Otro";
        if (!agrupados[prov]) agrupados[prov] = [];
        agrupados[prov].push(g);
      });
    });
    return agrupados;
  }, [historial]);

  // Calcular totales por proveedor
  const totales = Object.entries(gastosPorProveedor).map(([prov, gastos]) => ({
    proveedor: prov,
    total: gastos.reduce((a, g) => a + (+g.monto || 0), 0),
    cantidad: gastos.length,
    detalles: gastos,
  }));

  return (
    <div className="max-w-3xl mx-auto mt-6">
      <h2 className="text-xl font-bold mb-4 text-blue-400">Métricas de Gastos</h2>
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-2 text-orange-400">Gastos por Proveedor/Concepto</h3>
        <table className="w-full border-collapse mb-4">
          <thead>
            <tr className="bg-gray-800">
              <th className="px-2 py-1 border border-gray-700 text-left">Proveedor/Concepto</th>
              <th className="px-2 py-1 border border-gray-700 text-right">Total</th>
              <th className="px-2 py-1 border border-gray-700 text-center">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {totales.map(t => (
              <tr key={t.proveedor} className="bg-gray-900">
                <td className="px-2 py-1 border border-gray-700">{t.proveedor}</td>
                <td className="px-2 py-1 border border-gray-700 text-right">${t.total.toLocaleString()}</td>
                <td className="px-2 py-1 border border-gray-700 text-center">{t.cantidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
