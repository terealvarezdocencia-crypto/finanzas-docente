// ============================================================================
//  migrate.js — MIGRACIÓN V1 -> V2  (función pura, testeable)
//  Entra el JSON de la V1 (localStorage 'finanzas_app_v6' o un respaldo).
//  Sale el objeto V2 listo para escribir en localStorage 'finanzas_v2'.
//
//  El punto crítico (y razón de existir de la V2): clasificar correctamente
//  cada cuenta en LIQUID / RECEIVABLE / DEBT / CREDIT_LINE, para que ninguna
//  línea de crédito vuelva a contaminar el patrimonio.
// ============================================================================

// V1 type -> { class, subtype } de V2
const ACCOUNT_MAP = {
  cash:       { cls: 'LIQUID',      sub: 'cash' },
  checking:   { cls: 'LIQUID',      sub: 'checking' },
  savings:    { cls: 'LIQUID',      sub: 'savings' },
  investment: { cls: 'LIQUID',      sub: 'investment' },
  credit:     { cls: 'CREDIT_LINE', sub: 'card' },   // revolvente -> NUNCA activo
  debt:       { cls: 'DEBT',        sub: 'loan' },
  loan:       { cls: 'RECEIVABLE',  sub: 'loan' },    // "te deben"
};

// Tasas por defecto cuando la V1 no las capturaba. Se marcan para revisión.
const DEFAULT_APR = { CREDIT_LINE: 0.42, DEBT: 0.18 };

// Cómo participa cada módulo V1 en la consolidación familiar.
const MEMBER_RULES = {
  personal: { kind: 'person',   consolidates: true },
  family:   { kind: 'person',   consolidates: true },
  farmacia: { kind: 'business', consolidates: false }, // negocio: flujo separado
  farmasi:  { kind: 'business', consolidates: false },
};

const DEFAULT_ASSUMPTIONS = { inflationRate: 0.045, marketReturn: 0.09, safeWithdrawal: 0.04, taxYear: 2026 };

/**
 * @param {object} v1  contenido de localStorage 'finanzas_app_v6'
 * @returns {{data:object, report:object}}  data V2 + reporte de la migración
 */
export function migrateV1toV2(v1) {
  const out = {
    members: [], accounts: [], categories: [], transactions: [], goals: [],
    budgetBase: {}, budgetOverride: {}, assumptions: { ...DEFAULT_ASSUMPTIONS },
  };
  const report = { members: 0, accounts: 0, transactions: 0, reclassifiedCredit: 0, needsReview: [] };

  if (!v1 || !v1.modules) throw new Error('No se encontró estructura V1 válida (falta .modules).');

  const list = v1.modulesList || Object.keys(v1.modules).map(id => ({ id, name: id, icon: '' }));

  for (const modInfo of list) {
    const modKey = modInfo.id;
    const mod = v1.modules[modKey];
    if (!mod) continue;

    const rule = MEMBER_RULES[modKey] || { kind: 'person', consolidates: false };
    const member = {
      id: 'm_' + modKey,
      name: modInfo.name || modKey,
      kind: rule.kind,
      consolidates: rule.consolidates,
      icon: modInfo.icon || '',
    };
    out.members.push(member);
    report.members++;

    // Prefijo para garantizar ids globalmente únicos en el modelo plano V2.
    const P = (id) => modKey + ':' + id;
    const accClassById = {}; // para reclasificar transferencias hacia pasivos

    // --- Cuentas -----------------------------------------------------------
    for (const a of mod.accounts || []) {
      const m = ACCOUNT_MAP[a.type] || { cls: 'LIQUID', sub: a.type || 'cash' };
      const isLiability = m.cls === 'DEBT' || m.cls === 'CREDIT_LINE';
      const acc = {
        id: P(a.id),
        memberId: member.id,
        name: a.name,
        accountClass: m.cls,
        subtype: m.sub,
        openingBalance: a.initialBalance || 0,
        includeInNet: a.includeInBalance !== false,
        archived: false,
      };
      if (isLiability) {
        acc.apr = DEFAULT_APR[m.cls];                 // estimada
        acc.minPayment = m.cls === 'CREDIT_LINE'
          ? Math.round((a.initialBalance || 0) * 0.05) // 5% del saldo como proxy
          : null;
        acc.needsReview = 'apr/minPayment estimados — verificar';
        report.needsReview.push(`${member.name} › ${a.name}: ${acc.needsReview}`);
        if (m.cls === 'CREDIT_LINE') report.reclassifiedCredit++;
      }
      if (a.paymentDay) acc.paymentDay = a.paymentDay;
      if (a.closingDay) acc.closingDay = a.closingDay;
      accClassById[a.id] = m.cls;
      out.accounts.push(acc);
      report.accounts++;
    }

    // --- Rubros ------------------------------------------------------------
    for (const c of mod.categories || []) {
      out.categories.push({
        id: P(c.id),
        memberId: member.id,
        name: c.name,
        flow: c.type,                                  // income|expense|saving (idéntico)
        parentId: c.parentId ? P(c.parentId) : null,
        deductible: false,
        deductionKey: null,
        isFixed: false,
        archived: false,
      });
    }

    // --- Metas -------------------------------------------------------------
    for (const g of mod.goals || []) {
      out.goals.push({
        id: P(g.id),
        memberId: member.id,
        name: g.name,
        goalType: g.type,                              // savings|freedom|investment|debt
        target: g.target,
        current: g.current || 0,
        dueDate: g.date || null,
        accountId: g.accountId ? P(g.accountId) : null,
      });
    }

    // --- Transacciones (mapeo de semántica contable) -----------------------
    for (const t of mod.transactions || []) {
      const tx = {
        id: P(t.id),
        memberId: member.id,
        date: t.date,
        amount: t.amount,
        categoryId: t.categoryId ? P(t.categoryId) : null,
        accountId: P(t.accountId),
        destAccountId: t.destAccountId ? P(t.destAccountId) : undefined,
        goalId: t.goalId ? P(t.goalId) : null,
        note: t.desc || '',
        kind: mapTxKind(t, accClassById),
      };
      out.transactions.push(tx);
      report.transactions++;
    }

    // --- Presupuestos: latest -> base ; todos -> override ------------------
    migrateBudgets(mod.budgets, 'monthly', member.id, P, out);
    migrateBudgets(mod.weeklyBudgets, 'weekly', member.id, P, out);
  }

  return { data: out, report };
}

/**
 * Traduce el tipo de transacción V1 al 'kind' contable de V2.
 *  - debt         -> debt_draw   (dispones crédito; NO es ingreso)
 *  - loan_payment -> transfer    (en V1 es mecánicamente origen-= / destino+=;
 *                                 lo preservamos fiel como transferencia entre la
 *                                 cuenta líquida y la cuenta por cobrar/préstamo).
 *  - transfer/loan_payment cuyo DESTINO es un pasivo (DEBT/CREDIT_LINE)
 *                 -> debt_payment (abonas tu deuda; corrige el signo de la V1).
 */
function mapTxKind(t, accClassById) {
  if (t.type === 'debt') return 'debt_draw';
  if (t.type === 'transfer' || t.type === 'loan_payment') {
    const destCls = t.destAccountId ? accClassById[t.destAccountId] : null;
    if (destCls === 'DEBT' || destCls === 'CREDIT_LINE') return 'debt_payment';
    return 'transfer';
  }
  return t.type; // income | expense | saving
}

function migrateBudgets(budgets, periodType, memberId, P, out) {
  if (!budgets) return;
  const periods = Object.keys(budgets).sort(); // ascendente -> el último es el más reciente
  if (!periods.length) return;

  // Todos los periodos van a override (preservación fiel del histórico).
  out.budgetOverride[memberId] ||= {};
  for (const periodId of periods) {
    const remapped = {};
    for (const [catId, amount] of Object.entries(budgets[periodId])) remapped[P(catId)] = amount;
    out.budgetOverride[memberId][periodId] = remapped;
  }
  // El periodo más reciente siembra la BASE para reducir fricción a futuro.
  const latest = periods[periods.length - 1];
  out.budgetBase[memberId] ||= {};
  out.budgetBase[memberId][periodType] = { ...out.budgetOverride[memberId][latest] };
}
