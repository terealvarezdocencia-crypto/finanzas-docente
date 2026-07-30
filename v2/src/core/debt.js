// ============================================================================
//  debt.js — MÓDULO "DESAFÍO DEUDA CERO"
//  Estrategias de pago acelerado: Avalancha (tasa) y Bola de Nieve (saldo).
//  Genera un calendario de amortización mes a mes con el dinero extra disponible.
// ============================================================================

/**
 * @typedef {Object} Debt
 * @property {string} id
 * @property {string} name
 * @property {number} balance       saldo actual (positivo)
 * @property {number} apr           tasa anual (decimal, ej. 0.36 para TDC)
 * @property {number} minPayment    pago mínimo mensual
 */

/** Ordena las deudas según la estrategia elegida. */
export function prioritize(debts, strategy = 'avalanche') {
  const list = debts.filter(d => d.balance > 0).map(d => ({ ...d }));
  if (strategy === 'snowball') {
    // Bola de nieve: primero los SALDOS más pequeños (motivación / victorias rápidas).
    return list.sort((a, b) => a.balance - b.balance);
  }
  // Avalancha: primero la TASA más alta (matemáticamente óptimo, menos interés).
  return list.sort((a, b) => b.apr - a.apr);
}

/**
 * Simula el plan de pago acelerado.
 * @param {Debt[]} debts
 * @param {number} extraBudget   dinero adicional mensual sobre los mínimos
 * @param {'avalanche'|'snowball'} strategy
 * @param {number} maxMonths     tope de seguridad
 * @returns {{months:number, totalInterest:number, payoffOrder:string[], schedule:Array}}
 */
export function buildPlan(debts, extraBudget, strategy = 'avalanche', maxMonths = 600) {
  let working = prioritize(debts, strategy);
  const schedule = [];
  const payoffOrder = [];
  let totalInterest = 0;
  let month = 0;

  while (working.some(d => d.balance > 0.01) && month < maxMonths) {
    month++;
    // El "extra" se suma al mínimo de la deuda objetivo (la primera con saldo).
    let pool = extraBudget;
    const monthRow = { month, payments: {} };

    // 1) Acumula interés del mes en cada deuda.
    for (const d of working) {
      if (d.balance <= 0.01) continue;
      const interest = d.balance * (d.apr / 12);
      d.balance += interest;
      totalInterest += interest;
    }

    // 2) Paga los mínimos.
    for (const d of working) {
      if (d.balance <= 0.01) continue;
      const pay = Math.min(d.minPayment, d.balance);
      d.balance -= pay;
      monthRow.payments[d.id] = pay;
    }

    // 3) Vuelca TODO el extra (más el mínimo liberado de deudas saldadas) a la
    //    deuda objetivo, en orden de prioridad. Esto es el efecto "avalancha/bola".
    for (const d of working) {
      if (pool <= 0) break;
      if (d.balance <= 0.01) continue;
      const extra = Math.min(pool, d.balance);
      d.balance -= extra;
      pool -= extra;
      monthRow.payments[d.id] = (monthRow.payments[d.id] || 0) + extra;
    }

    // 4) Registra deudas que se liquidaron este mes; su mínimo se reciclará.
    for (const d of working) {
      if (d.balance <= 0.01 && !payoffOrder.includes(d.id)) payoffOrder.push(d.id);
    }
    schedule.push(monthRow);
  }

  return {
    months: month,
    years: Math.round((month / 12) * 10) / 10,
    totalInterest: Math.round(totalInterest * 100) / 100,
    payoffOrder,
    schedule,
  };
}

/**
 * Compara las dos estrategias para que el usuario decida con datos.
 */
export function compareStrategies(debts, extraBudget) {
  const avalanche = buildPlan(debts, extraBudget, 'avalanche');
  const snowball = buildPlan(debts, extraBudget, 'snowball');
  return {
    avalanche,
    snowball,
    interestSaved: snowball.totalInterest - avalanche.totalInterest,
    recommendation: avalanche.totalInterest <= snowball.totalInterest ? 'avalanche' : 'snowball',
  };
}
