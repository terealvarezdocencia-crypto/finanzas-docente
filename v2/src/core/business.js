// ============================================================================
//  business.js — MÓDULO "ACELERADOR FARMASI / EMPRENDIMIENTO"
//  Flujos variables del negocio, SEPARADOS del flujo familiar.
//  Calcula punto de equilibrio y ejecuta la regla de reinversión 50/50.
// ============================================================================

/**
 * Punto de equilibrio operativo.
 * @param {object} p
 * @param {number} p.fixedCosts        costos fijos del periodo (renta, etc.)
 * @param {number} p.unitPrice         precio de venta unitario promedio
 * @param {number} p.unitVariableCost  costo variable unitario (producto + envío)
 * @returns {{contributionMargin:number, marginRatio:number, breakEvenUnits:number, breakEvenRevenue:number}}
 */
export function breakEven({ fixedCosts, unitPrice, unitVariableCost }) {
  const contributionMargin = unitPrice - unitVariableCost;
  if (contributionMargin <= 0) {
    return { contributionMargin, marginRatio: 0, breakEvenUnits: Infinity, breakEvenRevenue: Infinity };
  }
  const marginRatio = contributionMargin / unitPrice;
  const breakEvenUnits = Math.ceil(fixedCosts / contributionMargin);
  return {
    contributionMargin,
    marginRatio,
    breakEvenUnits,
    breakEvenRevenue: breakEvenUnits * unitPrice,
  };
}

/**
 * Regla de reinversión 50/50 sobre la utilidad neta del periodo:
 *   50% -> reinversión al negocio (inventario / crecimiento)
 *   50% -> fondo de emergencia (familiar)
 * @param {number} netProfit  utilidad neta del periodo (ingresos - costos)
 * @param {number} [split=0.5] proporción a reinversión
 */
export function reinvestmentSplit(netProfit, split = 0.5) {
  if (netProfit <= 0) {
    return { reinvest: 0, emergencyFund: 0, note: 'Sin utilidad: no se aplica la regla 50/50.' };
  }
  const reinvest = Math.round(netProfit * split * 100) / 100;
  return {
    reinvest,
    emergencyFund: Math.round((netProfit - reinvest) * 100) / 100,
    note: `Reinvierte ${Math.round(split * 100)}% y blinda el resto en fondo de emergencia.`,
  };
}

/**
 * Tablero del negocio para un periodo.
 */
export function businessDashboard({ revenue, variableCosts, fixedCosts, unitPrice, unitVariableCost }) {
  const netProfit = revenue - variableCosts - fixedCosts;
  const be = breakEven({ fixedCosts, unitPrice, unitVariableCost });
  const split = reinvestmentSplit(netProfit);
  const safetyMargin = be.breakEvenRevenue > 0
    ? Math.round(((revenue - be.breakEvenRevenue) / revenue) * 1000) / 10
    : 0; // % de ventas por encima del punto de equilibrio
  return { netProfit, breakEven: be, split, safetyMarginPct: safetyMargin };
}
