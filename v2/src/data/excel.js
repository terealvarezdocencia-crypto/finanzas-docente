// ============================================================================
//  excel.js — IMPORTACIÓN / EXPORTACIÓN EN EXCEL (.xlsx)
//  Usa SheetJS (globalThis.XLSX, cargado por CDN en index.html).
//  build*  -> arma un libro a partir de los datos de un módulo.
//  read*   -> parsea un libro a estructuras del dominio.
//  Los libros son ida y vuelta: incluyen los `id` para reimportar sin perder
//  referencias, y además nombres legibles para edición humana.
// ============================================================================

const X = () => globalThis.XLSX;

const CLASS_VALUES = ['LIQUID', 'RECEIVABLE', 'DEBT', 'CREDIT_LINE'];
const KIND_VALUES = ['income', 'expense', 'saving', 'transfer', 'debt_draw', 'debt_payment', 'receivable_in'];

// ---------------------------------------------------------------------------
//  EXPORTAR
// ---------------------------------------------------------------------------

/**
 * Construye el libro de UN módulo.
 * @param {object} m  { name, accounts, categories, transactions, goals,
 *                      budgetBaseMonthly, overridesCurrent, periodId, balanceOf }
 */
export function buildModuleWorkbook(m) {
  const XLSX = X();
  const wb = XLSX.utils.book_new();
  const accName = (id) => m.accounts.find(a => a.id === id)?.name || '';
  const catName = (id) => m.categories.find(c => c.id === id)?.name || '';

  const cuentas = m.accounts.map(a => ({
    id: a.id, Nombre: a.name, Clase: a.accountClass, Subtipo: a.subtype || '',
    SaldoInicial: a.openingBalance || 0,
    'TasaAnual%': a.apr != null ? +(a.apr * 100).toFixed(4) : '',
    LimiteCredito: a.creditLimit ?? '', PagoMinimo: a.minPayment ?? '',
    EnPatrimonio: a.includeInNet !== false ? 'SI' : 'NO',
    SaldoActual: m.balanceOf ? m.balanceOf(a) : '',
  }));

  const rubros = m.categories.map(c => ({
    id: c.id, Nombre: c.name, Flujo: c.flow, PadreId: c.parentId || '',
    Deducible: c.deductible ? 'SI' : 'NO', TipoDeduccion: c.deductionKey || '',
    Fijo: c.isFixed ? 'SI' : 'NO',
  }));

  const movimientos = m.transactions.map(t => ({
    id: t.id, Fecha: t.date, Tipo: t.kind, Monto: t.amount,
    Rubro: catName(t.categoryId), Cuenta: accName(t.accountId), CuentaDestino: accName(t.destAccountId),
    RubroId: t.categoryId || '', CuentaId: t.accountId || '', CuentaDestinoId: t.destAccountId || '',
    TipoDeduccion: t.deductionKey || '', Nota: t.note || '',
  }));

  const metas = (m.goals || []).map(g => ({
    id: g.id, Nombre: g.name, Tipo: g.goalType, Objetivo: g.target,
    Actual: g.current || 0, FechaLimite: g.dueDate || '', CuentaId: g.accountId || '',
  }));

  const base = m.budgetBaseMonthly || {};
  const ov = m.overridesCurrent || {};
  const presupuesto = m.categories.filter(c => c.flow === 'expense').map(c => ({
    RubroId: c.id, Rubro: c.name, BaseMensual: base[c.id] ?? '',
    [`EsteMes(${m.periodId})`]: ov[c.id] ?? '',
  }));

  addSheet(wb, 'Cuentas', cuentas);
  addSheet(wb, 'Rubros', rubros);
  addSheet(wb, 'Movimientos', movimientos);
  addSheet(wb, 'Metas', metas);
  addSheet(wb, 'Presupuesto', presupuesto);
  return wb;
}

/**
 * Libro combinado de TODOS los módulos: cada hoja lleva una columna "Módulo".
 * @param {Array} modules  [{ name, accounts, categories, transactions, goals, balanceOf }]
 */
export function buildAllWorkbook(modules) {
  const XLSX = X();
  const wb = XLSX.utils.book_new();
  const cuentas = [], rubros = [], movimientos = [], metas = [];
  for (const m of modules) {
    const accName = (id) => m.accounts.find(a => a.id === id)?.name || '';
    const catName = (id) => m.categories.find(c => c.id === id)?.name || '';
    m.accounts.forEach(a => cuentas.push({ Modulo: m.name, id: a.id, Nombre: a.name, Clase: a.accountClass, SaldoInicial: a.openingBalance || 0, 'TasaAnual%': a.apr != null ? +(a.apr * 100).toFixed(4) : '', SaldoActual: m.balanceOf ? m.balanceOf(a) : '' }));
    m.categories.forEach(c => rubros.push({ Modulo: m.name, id: c.id, Nombre: c.name, Flujo: c.flow, Deducible: c.deductible ? 'SI' : 'NO', TipoDeduccion: c.deductionKey || '' }));
    m.transactions.forEach(t => movimientos.push({ Modulo: m.name, id: t.id, Fecha: t.date, Tipo: t.kind, Monto: t.amount, Rubro: catName(t.categoryId), Cuenta: accName(t.accountId), Nota: t.note || '' }));
    (m.goals || []).forEach(g => metas.push({ Modulo: m.name, id: g.id, Nombre: g.name, Tipo: g.goalType, Objetivo: g.target, Actual: g.current || 0 }));
  }
  addSheet(wb, 'Cuentas', cuentas);
  addSheet(wb, 'Rubros', rubros);
  addSheet(wb, 'Movimientos', movimientos);
  addSheet(wb, 'Metas', metas);
  return wb;
}

function addSheet(wb, name, rows) {
  const XLSX = X();
  const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['(vacío)']]);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

export function downloadWorkbook(wb, filename) {
  X().writeFile(wb, filename);
}

// ---------------------------------------------------------------------------
//  IMPORTAR
// ---------------------------------------------------------------------------

/** Lee un ArrayBuffer .xlsx y devuelve estructuras del dominio (sin tocar el repo). */
export function readWorkbook(arrayBuffer) {
  const XLSX = X();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = (name) => {
    const ws = wb.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
  };
  const yes = (v) => String(v).trim().toUpperCase() === 'SI' || v === true;

  const accounts = sheet('Cuentas').filter(r => r.Nombre).map(r => ({
    id: r.id || undefined, name: String(r.Nombre),
    accountClass: CLASS_VALUES.includes(r.Clase) ? r.Clase : 'LIQUID',
    subtype: r.Subtipo || '', openingBalance: num(r.SaldoInicial),
    apr: r['TasaAnual%'] !== '' && r['TasaAnual%'] != null ? num(r['TasaAnual%']) / 100 : null,
    creditLimit: r.LimiteCredito !== '' ? num(r.LimiteCredito) : null,
    minPayment: r.PagoMinimo !== '' ? num(r.PagoMinimo) : null,
    includeInNet: r.EnPatrimonio === '' ? true : yes(r.EnPatrimonio),
  }));

  const categories = sheet('Rubros').filter(r => r.Nombre).map(r => ({
    id: r.id || undefined, name: String(r.Nombre),
    flow: ['income', 'expense', 'saving'].includes(r.Flujo) ? r.Flujo : 'expense',
    parentId: r.PadreId || null, deductible: yes(r.Deducible),
    deductionKey: r.TipoDeduccion || null, isFixed: yes(r.Fijo),
  }));

  const transactions = sheet('Movimientos').filter(r => r.Monto !== '' && r.Monto != null).map(r => ({
    id: r.id || undefined, date: normDate(r.Fecha),
    kind: KIND_VALUES.includes(r.Tipo) ? r.Tipo : 'expense', amount: num(r.Monto),
    categoryId: r.RubroId || null, accountId: r.CuentaId || null,
    destAccountId: r.CuentaDestinoId || undefined,
    deductionKey: r.TipoDeduccion || null, note: r.Nota || '',
  }));

  const goals = sheet('Metas').filter(r => r.Nombre).map(r => ({
    id: r.id || undefined, name: String(r.Nombre),
    goalType: ['savings', 'freedom', 'investment', 'debt'].includes(r.Tipo) ? r.Tipo : 'savings',
    target: num(r.Objetivo), current: num(r.Actual), dueDate: r.FechaLimite || null,
    accountId: r.CuentaId || null,
  }));

  const presuRows = sheet('Presupuesto');
  const esteMesKey = presuRows.length ? Object.keys(presuRows[0]).find(k => k.startsWith('EsteMes')) : null;
  const budgetBaseMonthly = {}; const overrides = {};
  for (const r of presuRows) {
    if (!r.RubroId) continue;
    if (r.BaseMensual !== '' && r.BaseMensual != null) budgetBaseMonthly[r.RubroId] = num(r.BaseMensual);
    if (esteMesKey && r[esteMesKey] !== '' && r[esteMesKey] != null) overrides[r.RubroId] = num(r[esteMesKey]);
  }

  return { accounts, categories, transactions, goals, budgetBaseMonthly, overrides };
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function normDate(v) {
  if (v == null || v === '') return new Date().toISOString().slice(0, 10);
  if (typeof v === 'number') { // serial de Excel
    const d = X().SSF ? new Date(Math.round((v - 25569) * 86400 * 1000)) : new Date(v);
    return d.toISOString().slice(0, 10);
  }
  return String(v).slice(0, 10);
}
