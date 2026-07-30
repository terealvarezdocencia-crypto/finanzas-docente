// ============================================================================
//  engine.js — MOTOR FINANCIERO CENTRAL (V2.0)
//  Puro, sin DOM, sin estado global. Recibe datos, devuelve números.
//  Esto lo hace testeable y reutilizable en cliente o servidor.
// ============================================================================

/** Clases de cuenta. INMUTABLE: define el rol patrimonial. */
export const CLASS = Object.freeze({
  LIQUID: 'LIQUID',           // efectivo / débito / ahorro / inversión -> ACTIVO real
  RECEIVABLE: 'RECEIVABLE',   // te deben -> activo
  DEBT: 'DEBT',               // pasivo a plazo
  CREDIT_LINE: 'CREDIT_LINE', // pasivo revolvente (TDC) -> NUNCA activo
});

const ASSET_CLASSES = [CLASS.LIQUID, CLASS.RECEIVABLE];
const LIABILITY_CLASSES = [CLASS.DEBT, CLASS.CREDIT_LINE];

// ---------------------------------------------------------------------------
//  SALDOS
// ---------------------------------------------------------------------------

/**
 * Saldo vivo de una cuenta a partir de su apertura + transacciones.
 * Espejo exacto de la vista SQL v_account_balance.
 * 
 * REGLA CLAVE (auditoría V1):
 * - Cuentas de ACTIVO (LIQUID, RECEIVABLE): income/expense/saving/transfer funcionan normal
 * - Cuentas de PASIVO (DEBT, CREDIT_LINE): 
 *     expense / debt_draw  -> AUMENTAN saldo (debes más)
 *     debt_payment         -> DISMINUYEN saldo (debes menos)
 *     transfer IN          -> DISMINUYEN saldo (pagas deuda desde otra cuenta)
 *     transfer OUT         -> AUMENTAN saldo (sacas efectivo de la línea de crédito)
 */
export function accountBalance(account, txns) {
  const isLiability = account.accountClass === 'DEBT' || account.accountClass === 'CREDIT_LINE';
  let bal = account.openingBalance || 0;
  
  for (const t of txns) {
    // Origen: dinero sale de esta cuenta
    if (t.accountId === account.id) {
      if (isLiability) {
        // En pasivos: expense y debt_draw AUMENTAN la deuda (balance positivo = debes más)
        if (t.kind === 'expense' || t.kind === 'debt_draw') {
          bal += t.amount;
        }
        // debt_payment y transfer OUT reducen la deuda
        else if (t.kind === 'debt_payment' || t.kind === 'transfer') {
          bal -= t.amount;
        }
        // income en pasivo sería raro, pero lo tratamos como reduce deuda
        else if (t.kind === 'income') {
          bal -= t.amount;
        }
        // saving desde pasivo = transfer out
        else if (t.kind === 'saving') {
          bal -= t.amount;
        }
      } else {
        // Activos (LIQUID, RECEIVABLE): lógica normal
        if (t.kind === 'income' || t.kind === 'debt_draw' || t.kind === 'receivable_in') {
          bal += t.amount;
        } else {
          // expense, saving, transfer, debt_payment salen del origen
          bal -= t.amount;
        }
      }
    }
    
    // Destino: dinero entra a esta cuenta
    if (t.destAccountId === account.id) {
      if (isLiability) {
        // En pasivo destino: transfer IN / saving IN / debt_draw IN = pagan deuda (reducen balance)
        if (t.kind === 'transfer' || t.kind === 'saving' || t.kind === 'debt_draw' || t.kind === 'debt_payment') {
          bal -= t.amount;
        }
        // income en pasivo destino sería raro
      } else {
        // Activo destino: transfer / saving / debt_draw / debt_payment entran
        if (t.kind === 'debt_payment') {
          bal -= t.amount; // abona (reduce) el pasivo destino - pero si es activo destino, aumenta
        } else {
          bal += t.amount; // transfer / saving / debt_draw
        }
      }
    }
  }
  return bal;
}

// ---------------------------------------------------------------------------
//  PATRIMONIO — con separación dura capital líquido vs. crédito
// ---------------------------------------------------------------------------

/**
 * Calcula el patrimonio de un set de cuentas. Garantiza, por construcción,
 * que ninguna CREDIT_LINE pueda contar como activo o ahorro.
 */
export function netWorth(accounts, txns) {
  let assets = 0, liabilities = 0, liquidCapital = 0;
  for (const a of accounts) {
    if (a.includeInNet === false || a.archived) continue;
    const bal = accountBalance(a, txns);
    if (ASSET_CLASSES.includes(a.accountClass)) {
      assets += bal;
      if (a.accountClass === CLASS.LIQUID) liquidCapital += bal; // SOLO líquido
    } else if (LIABILITY_CLASSES.includes(a.accountClass)) {
      liabilities += bal; // saldo de pasivo es positivo => se resta abajo
    }
  }
  return {
    assets,
    liabilities,
    liquidCapital,                 // <- lo único gastable hoy
    netWorth: assets - liabilities,
  };
}

// ---------------------------------------------------------------------------
//  FLUJO DEL PERIODO
// ---------------------------------------------------------------------------

export function periodFlow(txns) {
  const sum = (k) => txns.filter(t => t.kind === k).reduce((s, t) => s + t.amount, 0);
  const income = sum('income');
  const expenses = sum('expense');
  const savings = sum('saving');
  const debtService = sum('debt_payment'); // pagos a pasivos = servicio de deuda
  return { income, expenses, savings, debtService };
}

// ---------------------------------------------------------------------------
//  KPIs EJECUTIVOS  (tarjetas del panel superior)
// ---------------------------------------------------------------------------

/**
 * @param {object} flow   salida de periodFlow() del periodo vigente
 * @param {object} nw     salida de netWorth()
 * @param {number} immediateLiabilities  pagos mínimos exigibles del periodo (<=30d)
 */
export function kpis(flow, nw, immediateLiabilities) {
  const { income, expenses, debtService } = flow;

  // 1) Margen Neto Post-Deuda: lo que sobra DESPUÉS de pagar deuda, sobre ingreso.
  const netAfterDebt = income - expenses - debtService;
  const netMarginPct = income > 0 ? (netAfterDebt / income) * 100 : 0;

  // 2) Índice de Liquidez Corriente: activo líquido / pasivo inmediato.
  const liquidityRatio = immediateLiabilities > 0
    ? nw.liquidCapital / immediateLiabilities
    : (nw.liquidCapital > 0 ? Infinity : 0);

  // 3) Días de Autonomía Financiera: cuántos días sobrevives sin ingresos.
  const dailyBurn = expenses / 30;
  const autonomyDays = dailyBurn > 0 ? nw.liquidCapital / dailyBurn : Infinity;

  return {
    netAfterDebt,
    netMarginPct,
    liquidityRatio,
    autonomyDays,
    status: semaphore({ netMarginPct, liquidityRatio }),
  };
}

/**
 * Semáforo de salud. Verde estable / Amarillo estrés / Rojo crítico.
 * Reglas de la auditoría:
 *   ROJO    -> déficit (margen < 0) o apalancamiento crítico (liquidez < 1)
 *   AMARILLO-> estrés de flujo (margen < 15%) o liquidez ajustada (< 1.5)
 *   VERDE   -> margen >= 15% y liquidez >= 1.5
 */
export function semaphore({ netMarginPct, liquidityRatio }) {
  if (netMarginPct < 0 || liquidityRatio < 1) return 'red';
  if (netMarginPct < 15 || liquidityRatio < 1.5) return 'yellow';
  return 'green';
}

// ---------------------------------------------------------------------------
//  PROYECCIÓN PATRIMONIAL — interés compuesto + depreciación inflacionaria
//  Reemplaza la proyección lineal de la V1.
// ---------------------------------------------------------------------------

/**
 * Proyecta el patrimonio neto con aporte mensual e interés compuesto,
 * y entrega el valor REAL (deflactado por inflación) además del nominal.
 *
 * @param {object} p
 * @param {number} p.principal          patrimonio neto inicial
 * @param {number} p.monthlyContribution aporte/ahorro mensual
 * @param {number} p.annualReturn       rendimiento nominal anual (ej. 0.09)
 * @param {number} p.inflation          inflación anual (ej. 0.045)
 * @param {number[]} [p.horizons]       años a reportar (default 1,3,5)
 * @returns {{nominal:number, real:number, contributed:number, growth:number}[]}
 */
export function projectNetWorth({
  principal, monthlyContribution, annualReturn, inflation, horizons = [1, 3, 5],
}) {
  const rMonthly = Math.pow(1 + annualReturn, 1 / 12) - 1; // tasa mensual efectiva
  const out = {};
  let nominal = principal;
  let contributed = principal;
  const maxYears = Math.max(...horizons);

  for (let month = 1; month <= maxYears * 12; month++) {
    nominal = nominal * (1 + rMonthly) + monthlyContribution; // compuesto + aporte
    contributed += monthlyContribution;
    const year = month / 12;
    if (horizons.includes(year)) {
      const deflator = Math.pow(1 + inflation, year);
      out[year] = {
        year,
        nominal,                          // pesos del futuro
        real: nominal / deflator,         // poder adquisitivo de HOY
        contributed,                      // capital aportado (sin rendimiento)
        growth: nominal - contributed,    // ganancia por interés compuesto
      };
    }
  }
  return horizons.map(y => out[y]);
}

/**
 * Número FIRE (libertad financiera) y años para alcanzarlo, resolviendo la
 * ecuación de valor futuro con interés compuesto (no aproximación lineal).
 *
 * FV = P(1+r)^n + C[((1+r)^n - 1)/r]  ->  despejamos n
 */
export function yearsToFreedom({ principal, monthlyContribution, annualExpenses, annualReturn, safeWithdrawal = 0.04 }) {
  const target = annualExpenses / safeWithdrawal; // p.ej. 25x gastos si SWR=4%
  if (principal >= target) return { target, years: 0 };
  if (monthlyContribution <= 0 && annualReturn <= 0) return { target, years: Infinity };

  const r = Math.pow(1 + annualReturn, 1 / 12) - 1;
  const C = monthlyContribution;
  // Resolución cerrada de n (meses) cuando r>0:
  // target = P(1+r)^n + C((1+r)^n - 1)/r
  if (r > 0) {
    const num = target * r + C;
    const den = principal * r + C;
    if (num <= 0 || den <= 0) return { target, years: Infinity };
    const n = Math.log(num / den) / Math.log(1 + r);
    return { target, years: n > 0 ? Math.round((n / 12) * 10) / 10 : Infinity };
  }
  // Sin rendimiento: lineal puro.
  const months = (target - principal) / C;
  return { target, years: Math.round((months / 12) * 10) / 10 };
}

// ---------------------------------------------------------------------------
//  PRESUPUESTO BASE — instanciación con desviaciones (cero fricción)
// ---------------------------------------------------------------------------

/**
 * Devuelve el presupuesto efectivo de un periodo: arranca de la base
 * recurrente y aplica solo los overrides que el usuario haya tocado.
 */
export function resolveBudget(base, overrides, periodId) {
  const result = {};
  for (const [catId, amount] of Object.entries(base)) result[catId] = amount;
  const ov = overrides[periodId] || {};
  for (const [catId, amount] of Object.entries(ov)) result[catId] = amount;
  return result; // { categoryId: montoPlaneado }
}
