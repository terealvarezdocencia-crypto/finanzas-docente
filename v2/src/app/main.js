// ============================================================================
//  main.js — CONTROLADOR DE LA UI (V2.0) con CRUD completo
//  Orquesta: Repository (datos) -> motor/módulos (cálculo) -> DOM (render).
//  La UI no contiene lógica financiera; solo captura datos y pinta resultados.
// ============================================================================
import { Repository } from '../data/repository.js';
import * as engine from '../core/engine.js';
import * as debt from '../core/debt.js';
import * as tax from '../core/tax.js';
import * as biz from '../core/business.js';
import * as excel from '../data/excel.js';

const repo = new Repository();
const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);
const pct = (n) => (isFinite(n) ? n.toFixed(1) + '%' : '∞');
const el = (id) => document.getElementById(id);
const periodId = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'

const KIND_LABEL = {
  income: '💰 Ingreso', expense: '💸 Gasto', saving: '🐷 Ahorro', transfer: '🔄 Transferencia',
  debt_draw: '💳 Disponer crédito', debt_payment: '🤝 Pago de deuda', receivable_in: '📥 Cobro de préstamo',
};
const CLASS_LABEL = { LIQUID: 'Líquido', RECEIVABLE: 'Por cobrar', DEBT: 'Deuda', CREDIT_LINE: 'Línea de crédito' };
const DEDUCTION_LABEL = { '': '—', medical: 'Honorarios médicos', ppr: 'PPR (retiro)', tuition: 'Colegiaturas', mortgage_interest: 'Intereses hipotecarios', insurance_medical: 'Seguro de gastos médicos', funeral: 'Gastos funerarios', donations: 'Donativos' };

let state = { memberId: localStorage.getItem('fz_member') || null };

// ============================================================================
//  ARRANQUE
// ============================================================================
async function bootstrap() {
  const members = await repo.all('members');
  if (members.length === 0) await seed();
  await refresh();
}

async function seed() {
  await repo.insert('members', { id: 'm_household', name: 'Familia', kind: 'household', consolidates: false, icon: '🏠' });
  const me = await repo.insert('members', { name: 'Dra. Álvarez', kind: 'person', consolidates: true, icon: '👩‍⚕️' });
  const debito = await repo.insert('accounts', { memberId: me.id, name: 'Banco (débito)', accountClass: 'LIQUID', subtype: 'checking', openingBalance: 48000, includeInNet: true });
  await repo.insert('accounts', { memberId: me.id, name: 'Ahorro', accountClass: 'LIQUID', subtype: 'savings', openingBalance: 120000, includeInNet: true });
  await repo.insert('accounts', { memberId: me.id, name: 'TDC Banamex', accountClass: 'CREDIT_LINE', subtype: 'card', openingBalance: 18500, apr: 0.42, creditLimit: 60000, minPayment: 1850, includeInNet: true });
  await repo.insert('accounts', { memberId: me.id, name: 'Crédito auto', accountClass: 'DEBT', subtype: 'loan', openingBalance: 95000, apr: 0.135, minPayment: 4200, includeInNet: true });
  const sal = await repo.insert('categories', { memberId: me.id, name: 'Sueldo docente', flow: 'income', isFixed: true });
  const desp = await repo.insert('categories', { memberId: me.id, name: 'Despensa', flow: 'expense', isFixed: true });
  const med = await repo.insert('categories', { memberId: me.id, name: 'Honorarios médicos', flow: 'expense', deductible: true, deductionKey: 'medical' });
  await repo.insert('categories', { memberId: me.id, name: 'Aportación PPR', flow: 'saving', deductible: true, deductionKey: 'ppr' });
  const d = new Date().toISOString().slice(0, 10);
  await repo.insert('transactions', { memberId: me.id, date: d, kind: 'income', amount: 42000, categoryId: sal.id, accountId: debito.id });
  await repo.insert('transactions', { memberId: me.id, date: d, kind: 'expense', amount: 9500, categoryId: desp.id, accountId: debito.id });
  await repo.insert('transactions', { memberId: me.id, date: d, kind: 'expense', amount: 6000, categoryId: med.id, accountId: debito.id, deductionKey: 'medical' });
  await repo.insert('transactions', { memberId: me.id, date: d, kind: 'debt_payment', amount: 4200, accountId: debito.id });
  state.memberId = me.id;
}

// ============================================================================
//  RENDER PRINCIPAL
// ============================================================================
async function refresh() {
  const members = await repo.all('members');
  if (!members.find(m => m.id === state.memberId)) state.memberId = members.find(m => m.kind === 'person')?.id || members[0]?.id;
  localStorage.setItem('fz_member', state.memberId || '');

  el('member-select').innerHTML = members.map(m =>
    `<option value="${m.id}" ${m.id === state.memberId ? 'selected' : ''}>${m.icon || ''} ${m.name}</option>`).join('');

  const accounts = await repo.all('accounts', state.memberId);
  const categories = await repo.all('categories', state.memberId);
  const txns = await repo.all('transactions', state.memberId);
  const asmp = await repo.assumptions();
  const member = members.find(m => m.id === state.memberId) || {};

  const monthTx = txns.filter(t => (t.date || '').slice(0, 7) === periodId());
  const nw = engine.netWorth(accounts, txns);
  const flow = engine.periodFlow(monthTx);
  const immediateLiab = accounts.filter(a => ['DEBT', 'CREDIT_LINE'].includes(a.accountClass)).reduce((s, a) => s + (a.minPayment || 0), 0);
  const k = engine.kpis(flow, nw, immediateLiab);

  renderKpis(k, nw);
  renderMonthly(flow, k);
  renderTransactions(txns, categories, accounts);
  renderAccounts(accounts, txns);
  renderCategories(categories);
  await renderBudget(categories, monthTx);
  renderProjection(nw, flow, asmp);
  renderDebt(accounts, txns, member);
  renderTax(monthTx, flow, categories);
  renderBusiness(member);
}

function statusOf(v, g, y) { return v >= g ? 'green' : v >= y ? 'yellow' : 'red'; }

function renderKpis(k, nw) {
  const cards = [
    { label: 'Margen Neto Post-Deuda', value: pct(k.netMarginPct), sub: fmt(k.netAfterDebt) + ' libres', cls: k.status },
    { label: 'Liquidez Corriente', value: isFinite(k.liquidityRatio) ? k.liquidityRatio.toFixed(2) + '×' : '∞', sub: 'Líquido / pasivo inmediato', cls: statusOf(k.liquidityRatio, 1.5, 1) },
    { label: 'Días de Autonomía', value: isFinite(k.autonomyDays) ? Math.round(k.autonomyDays) : '∞', sub: 'Sin ingresos', cls: statusOf(k.autonomyDays, 90, 30) },
    { label: 'Patrimonio Neto', value: fmt(nw.netWorth), sub: `Líquido: ${fmt(nw.liquidCapital)}`, cls: nw.netWorth >= 0 ? 'green' : 'red' },
  ];
  el('kpi-grid').innerHTML = cards.map(c => `<div class="kpi ${c.cls}"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`).join('');
}

function renderMonthly(flow, k) {
  const rows = [['Ingresos', flow.income, ''], ['Gastos', flow.expenses, ''], ['Servicio de deuda', flow.debtService, ''], ['Margen neto post-deuda', k.netAfterDebt, `cell-${k.status}`]];
  el('monthly-balance').innerHTML = `<table><tbody>${rows.map(([l, v, c]) => `<tr><td>${l}</td><td class="num"><span class="${c}" style="padding:2px 8px">${fmt(v)}</span></td></tr>`).join('')}</tbody></table>`;
}

function renderTransactions(txns, categories, accounts) {
  const catName = (id) => categories.find(c => c.id === id)?.name || '—';
  const accName = (id) => accounts.find(a => a.id === id)?.name || '—';
  const sorted = [...txns].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  el('tx-body').innerHTML = sorted.length ? sorted.map(t => `<tr>
    <td>${t.date || ''}</td><td>${KIND_LABEL[t.kind] || t.kind}</td><td>${catName(t.categoryId)}</td>
    <td>${accName(t.accountId)}${t.destAccountId ? ' → ' + accName(t.destAccountId) : ''}</td>
    <td class="num">${fmt(t.amount)}</td>
    <td class="num"><button class="icon-btn" data-action="edit" data-coll="transactions" data-id="${t.id}">✏️</button><button class="icon-btn" data-action="del" data-coll="transactions" data-id="${t.id}">🗑</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">Sin movimientos. Agrega el primero con “+ Movimiento”.</td></tr>';
}

function renderAccounts(accounts, txns) {
  const pillMap = { LIQUID: 'liquid', CREDIT_LINE: 'credit', DEBT: 'debt', RECEIVABLE: 'recv' };
  el('accounts-body').innerHTML = accounts.length ? accounts.map(a => {
    const bal = engine.accountBalance(a, txns);
    return `<tr><td>${a.name}${a.needsReview ? ' <span class="pill debt" title="' + a.needsReview + '">⚠</span>' : ''}</td>
      <td><span class="pill ${pillMap[a.accountClass]}">${CLASS_LABEL[a.accountClass]}</span></td>
      <td class="num">${fmt(bal)}</td>
      <td class="num"><button class="icon-btn" data-action="edit" data-coll="accounts" data-id="${a.id}">✏️</button><button class="icon-btn" data-action="del" data-coll="accounts" data-id="${a.id}">🗑</button></td></tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">Sin cuentas. Agrega una con “+ Cuenta”.</td></tr>';
}

function renderCategories(categories) {
  el('cat-body').innerHTML = categories.length ? categories.map(c => `<tr>
    <td>${c.parentId ? '↳ ' : ''}${c.name}</td><td>${KIND_LABEL[c.flow] || c.flow}</td>
    <td>${c.deductible ? '✅ ' + (DEDUCTION_LABEL[c.deductionKey] || '') : '—'}</td><td>${c.isFixed ? '📌' : '—'}</td>
    <td class="num"><button class="icon-btn" data-action="edit" data-coll="categories" data-id="${c.id}">✏️</button><button class="icon-btn" data-action="del" data-coll="categories" data-id="${c.id}">🗑</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Sin rubros. Agrega uno con “+ Rubro”.</td></tr>';
}

async function renderBudget(categories, monthTx) {
  const base = await repo.getBudgetBase(state.memberId, 'monthly');
  const overrides = await repo.getOverrides(state.memberId);
  const ovPeriod = overrides[periodId()] || {};
  const expCats = categories.filter(c => c.flow === 'expense');
  if (!expCats.length) { el('budget-body').innerHTML = '<p class="empty">Crea rubros de gasto para presupuestar.</p>'; return; }
  const realByCat = {};
  monthTx.filter(t => t.kind === 'expense').forEach(t => realByCat[t.categoryId] = (realByCat[t.categoryId] || 0) + t.amount);
  el('budget-body').innerHTML = `<table><thead><tr><th>Rubro</th><th class="num">Base mensual</th><th class="num">Este mes (${periodId()})</th><th class="num">Real</th><th>Estado</th></tr></thead><tbody>${
    expCats.map(c => {
      const baseAmt = base[c.id] || 0;
      const planned = ovPeriod[c.id] != null ? ovPeriod[c.id] : baseAmt;
      const real = realByCat[c.id] || 0;
      const cls = planned <= 0 ? '' : real > planned ? 'cell-red' : real > planned * 0.85 ? 'cell-yellow' : 'cell-green';
      return `<tr><td>${c.name}</td>
        <td class="num"><input class="inline" type="number" min="0" step="100" value="${baseAmt || ''}" data-budget="base" data-cat="${c.id}" placeholder="0"></td>
        <td class="num"><input class="inline" type="number" min="0" step="100" value="${ovPeriod[c.id] != null ? ovPeriod[c.id] : ''}" data-budget="override" data-cat="${c.id}" placeholder="${baseAmt || 0}"></td>
        <td class="num">${fmt(real)}</td><td><span class="${cls}" style="padding:2px 8px">${planned > 0 ? pct(real / planned * 100) : '—'}</span></td></tr>`;
    }).join('')}</tbody></table>`;
}

function renderProjection(nw, flow, asmp) {
  const monthly = Math.max(0, flow.income - flow.expenses - flow.debtService);
  const rows = engine.projectNetWorth({ principal: nw.netWorth, monthlyContribution: monthly, annualReturn: asmp.marketReturn, inflation: asmp.inflationRate, horizons: [1, 3, 5] });
  const fire = engine.yearsToFreedom({ principal: nw.netWorth, monthlyContribution: monthly, annualExpenses: flow.expenses * 12, annualReturn: asmp.marketReturn, safeWithdrawal: asmp.safeWithdrawal });
  el('projection-body').innerHTML = `
    <div class="row2" style="margin-bottom:14px">
      <div class="field"><label>Rendimiento anual (%)</label><input type="number" step="0.1" value="${(asmp.marketReturn * 100).toFixed(1)}" data-asmp="marketReturn"></div>
      <div class="field"><label>Inflación anual (%)</label><input type="number" step="0.1" value="${(asmp.inflationRate * 100).toFixed(1)}" data-asmp="inflationRate"></div>
    </div>
    <p class="muted" style="margin-bottom:10px">Aporte mensual estimado (margen post-deuda): <b>${fmt(monthly)}</b></p>
    <table><thead><tr><th>Horizonte</th><th class="num">Nominal</th><th class="num">Real (hoy)</th><th class="num">Ganancia compuesta</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.year} año${r.year > 1 ? 's' : ''}</td><td class="num">${fmt(r.nominal)}</td><td class="num">${fmt(r.real)}</td><td class="num">${fmt(r.growth)}</td></tr>`).join('')}</tbody></table>
    <p class="muted" style="margin-top:10px">Número FIRE: <b>${fmt(fire.target)}</b> · Años a libertad financiera: <b>${isFinite(fire.years) ? fire.years : '∞'}</b></p>`;
}

function renderDebt(accounts, txns, member) {
  const debts = accounts.filter(a => ['DEBT', 'CREDIT_LINE'].includes(a.accountClass))
    .map(a => ({ id: a.id, name: a.name, balance: engine.accountBalance(a, txns), apr: a.apr || 0, minPayment: a.minPayment || 0 }));
  const extra = member.debtExtra ?? 3000;
  let html = `<div class="field" style="max-width:260px"><label>Pago extra mensual ($)</label><input type="number" min="0" step="100" value="${extra}" data-member-num="debtExtra"></div>`;
  if (!debts.length) { el('debt-body').innerHTML = html + '<p class="empty">Sin deudas registradas. 🎉</p>'; return; }
  const cmp = debt.compareStrategies(debts, extra);
  const nameOf = (id) => debts.find(d => d.id === id)?.name || id;
  el('debt-body').innerHTML = html + `
    <table style="margin-top:10px"><thead><tr><th>Estrategia</th><th class="num">Meses</th><th class="num">Interés total</th><th>Orden de pago</th></tr></thead><tbody>
    <tr><td><b>Avalancha</b> (tasa)</td><td class="num">${cmp.avalanche.months}</td><td class="num">${fmt(cmp.avalanche.totalInterest)}</td><td>${cmp.avalanche.payoffOrder.map(nameOf).join(' → ')}</td></tr>
    <tr><td><b>Bola de nieve</b> (saldo)</td><td class="num">${cmp.snowball.months}</td><td class="num">${fmt(cmp.snowball.totalInterest)}</td><td>${cmp.snowball.payoffOrder.map(nameOf).join(' → ')}</td></tr>
    </tbody></table>
    <p class="muted" style="margin-top:8px">Recomendación: <b>${cmp.recommendation === 'avalanche' ? 'Avalancha' : 'Bola de nieve'}</b> · ahorras ${fmt(Math.abs(cmp.interestSaved))} en intereses.</p>`;
}

function renderTax(monthTx, flow, categories) {
  const catKey = (id) => categories.find(c => c.id === id)?.deductionKey;
  const deductibleTxns = monthTx.filter(t => t.deductionKey || catKey(t.categoryId)).map(t => ({ amount: t.amount, deductionKey: t.deductionKey || catKey(t.categoryId) }));
  const grossIncome = flow.income * 12;
  const r = tax.estimateRefund({ grossIncome, withheld: null, deductibleTxns });
  el('tax-body').innerHTML = `<table><tbody>
    <tr><td>Ingreso anual estimado</td><td class="num">${fmt(grossIncome)}</td></tr>
    <tr><td>Deducciones aplicables (con topes)</td><td class="num">${fmt(r.deductions.totalApplied)}</td></tr>
    <tr><td>ISR sin deducciones</td><td class="num">${fmt(r.isrWithoutDeductions)}</td></tr>
    <tr><td>ISR con deducciones</td><td class="num">${fmt(r.isrWithDeductions)}</td></tr>
    <tr><td><b>Devolución estimada</b></td><td class="num"><span class="cell-green" style="padding:2px 8px">${fmt(r.estimatedRefund)}</span></td></tr>
    </tbody></table>
    <p class="muted" style="margin-top:8px">Marca rubros como deducibles (pestaña Rubros). Estimado orientativo: actualiza UMA y tarifa ISR en <code>tax.js</code>.</p>`;
}

function renderBusiness(member) {
  const b = member.business || { revenue: 18000, variableCosts: 7000, fixedCosts: 4000, unitPrice: 350, unitVariableCost: 140 };
  const d = biz.businessDashboard(b);
  const inp = (key, label) => `<div class="field"><label>${label}</label><input type="number" min="0" step="10" value="${b[key]}" data-biz="${key}"></div>`;
  el('business-body').innerHTML = `
    <div class="row2">${inp('revenue', 'Ingresos del mes')}${inp('variableCosts', 'Costos variables')}</div>
    <div class="row2">${inp('fixedCosts', 'Costos fijos')}${inp('unitPrice', 'Precio unitario')}</div>
    <div class="row2">${inp('unitVariableCost', 'Costo variable unitario')}<div></div></div>
    <table style="margin-top:10px"><tbody>
    <tr><td>Utilidad neta del mes</td><td class="num">${fmt(d.netProfit)}</td></tr>
    <tr><td>Punto de equilibrio</td><td class="num">${isFinite(d.breakEven.breakEvenUnits) ? d.breakEven.breakEvenUnits + ' u · ' + fmt(d.breakEven.breakEvenRevenue) : '—'}</td></tr>
    <tr><td>Margen de seguridad</td><td class="num">${d.safetyMarginPct}%</td></tr>
    <tr><td>Reinversión (50%)</td><td class="num">${fmt(d.split.reinvest)}</td></tr>
    <tr><td>A fondo de emergencia (50%)</td><td class="num">${fmt(d.split.emergencyFund)}</td></tr>
    </tbody></table>`;
}

// ============================================================================
//  SISTEMA DE FORMULARIOS (modal genérico)
// ============================================================================
let formSubmit = null;

function openForm(title, fields, values, onSubmit) {
  el('modal-title').textContent = title;
  el('modal-fields').innerHTML = fields.map(f => fieldHtml(f, values[f.name])).join('');
  formSubmit = (data) => onSubmit(data);
  el('modal-bg').classList.add('open');
  // re-evalúa visibilidad condicional al cambiar selects
  el('modal-fields').querySelectorAll('[data-toggles]').forEach(sel => sel.addEventListener('change', () => applyConditionals(fields)));
  applyConditionals(fields);
}

function fieldHtml(f, val) {
  if (f.type === 'checkbox')
    return `<div class="field check" data-fieldwrap="${f.name}"><input type="checkbox" id="f-${f.name}" name="${f.name}" ${val ? 'checked' : ''}><label for="f-${f.name}">${f.label}</label></div>`;
  let input;
  if (f.type === 'select')
    input = `<select id="f-${f.name}" name="${f.name}" ${f.toggles ? 'data-toggles' : ''}>${f.options.map(o => `<option value="${o.value}" ${String(val) === String(o.value) ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
  else
    input = `<input id="f-${f.name}" name="${f.name}" type="${f.type || 'text'}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} value="${val != null ? val : (f.default != null ? f.default : '')}">`;
  return `<div class="field" data-fieldwrap="${f.name}"><label>${f.label}</label>${input}</div>`;
}

function applyConditionals(fields) {
  const data = collectForm();
  fields.forEach(f => {
    if (!f.showIf) return;
    const wrap = el('modal-fields').querySelector(`[data-fieldwrap="${f.name}"]`);
    if (wrap) wrap.style.display = f.showIf(data) ? '' : 'none';
  });
}

function collectForm() {
  const data = {};
  el('modal-fields').querySelectorAll('input,select').forEach(i => {
    data[i.name] = i.type === 'checkbox' ? i.checked : (i.type === 'number' ? (i.value === '' ? null : parseFloat(i.value)) : i.value);
  });
  return data;
}

function closeModal() { el('modal-bg').classList.remove('open'); formSubmit = null; }

el('modal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = collectForm();
  if (formSubmit) await formSubmit(data);
  closeModal();
  await refresh();
});

// ============================================================================
//  DEFINICIÓN DE FORMULARIOS POR ENTIDAD
// ============================================================================
async function accountForm(existing) {
  const v = existing || { accountClass: 'LIQUID', includeInNet: true, openingBalance: 0 };
  openForm(existing ? 'Editar cuenta' : 'Nueva cuenta', [
    { name: 'name', label: 'Nombre', required: true },
    { name: 'accountClass', label: 'Clase', type: 'select', toggles: true, options: Object.entries(CLASS_LABEL).map(([value, label]) => ({ value, label })) },
    { name: 'subtype', label: 'Subtipo (efectivo, débito, tarjeta…)' },
    { name: 'openingBalance', label: 'Saldo inicial', type: 'number', step: '0.01', default: 0 },
    { name: 'apr', label: 'Tasa anual % (pasivos)', type: 'number', step: '0.1', showIf: (d) => d.accountClass === 'DEBT' || d.accountClass === 'CREDIT_LINE' },
    { name: 'creditLimit', label: 'Límite de crédito', type: 'number', step: '100', showIf: (d) => d.accountClass === 'CREDIT_LINE' },
    { name: 'minPayment', label: 'Pago mínimo mensual', type: 'number', step: '10', showIf: (d) => d.accountClass === 'DEBT' || d.accountClass === 'CREDIT_LINE' },
    { name: 'includeInNet', label: 'Incluir en patrimonio', type: 'checkbox' },
  ], { ...v, apr: v.apr != null ? v.apr * 100 : '' }, async (d) => {
    const isLiab = d.accountClass === 'DEBT' || d.accountClass === 'CREDIT_LINE';
    const patch = {
      memberId: state.memberId, name: d.name, accountClass: d.accountClass, subtype: d.subtype || '',
      openingBalance: d.openingBalance || 0, includeInNet: d.includeInNet,
      apr: isLiab ? (d.apr != null ? d.apr / 100 : (d.accountClass === 'CREDIT_LINE' ? 0.42 : 0.18)) : null,
      creditLimit: d.accountClass === 'CREDIT_LINE' ? d.creditLimit : null,
      minPayment: isLiab ? d.minPayment : null,
    };
    if (existing) await repo.update('accounts', existing.id, patch); else await repo.insert('accounts', patch);
  });
}

async function categoryForm(existing) {
  const cats = await repo.all('categories', state.memberId);
  const v = existing || { flow: 'expense', deductible: false, isFixed: false, deductionKey: '' };
  openForm(existing ? 'Editar rubro' : 'Nuevo rubro', [
    { name: 'name', label: 'Nombre', required: true },
    { name: 'flow', label: 'Flujo', type: 'select', options: [{ value: 'expense', label: '💸 Gasto' }, { value: 'income', label: '💰 Ingreso' }, { value: 'saving', label: '🐷 Ahorro' }] },
    { name: 'parentId', label: 'Rubro padre (opcional)', type: 'select', options: [{ value: '', label: '— Principal —' }, ...cats.filter(c => !c.parentId && (!existing || c.id !== existing.id)).map(c => ({ value: c.id, label: c.name }))] },
    { name: 'deductible', label: 'Deducible de impuestos', type: 'checkbox', toggles: true },
    { name: 'deductionKey', label: 'Tipo de deducción', type: 'select', options: Object.entries(DEDUCTION_LABEL).map(([value, label]) => ({ value, label })), showIf: (d) => d.deductible },
    { name: 'isFixed', label: 'Gasto fijo recurrente (presupuesto base)', type: 'checkbox' },
  ], v, async (d) => {
    const patch = { memberId: state.memberId, name: d.name, flow: d.flow, parentId: d.parentId || null, deductible: d.deductible, deductionKey: d.deductible ? d.deductionKey : null, isFixed: d.isFixed };
    if (existing) await repo.update('categories', existing.id, patch); else await repo.insert('categories', patch);
  });
}

async function transactionForm(existing) {
  const accounts = await repo.all('accounts', state.memberId);
  const categories = await repo.all('categories', state.memberId);
  const accOpts = accounts.map(a => ({ value: a.id, label: a.name }));
  const v = existing || { date: new Date().toISOString().slice(0, 10), kind: 'expense', accountId: accounts[0]?.id };
  openForm(existing ? 'Editar movimiento' : 'Nuevo movimiento', [
    { name: 'date', label: 'Fecha', type: 'date', required: true },
    { name: 'kind', label: 'Tipo', type: 'select', toggles: true, options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })) },
    { name: 'amount', label: 'Monto', type: 'number', step: '0.01', min: 0, required: true },
    { name: 'accountId', label: 'Cuenta', type: 'select', options: accOpts, required: true },
    { name: 'destAccountId', label: 'Cuenta destino', type: 'select', options: [{ value: '', label: '—' }, ...accOpts], showIf: (d) => ['transfer', 'saving', 'debt_payment', 'debt_draw'].includes(d.kind) },
    { name: 'categoryId', label: 'Rubro', type: 'select', options: [{ value: '', label: '—' }, ...categories.map(c => ({ value: c.id, label: c.name }))] },
    { name: 'note', label: 'Nota (opcional)' },
  ], v, async (d) => {
    const cat = categories.find(c => c.id === d.categoryId);
    const patch = {
      memberId: state.memberId, date: d.date, kind: d.kind, amount: d.amount,
      accountId: d.accountId, destAccountId: d.destAccountId || undefined,
      categoryId: d.categoryId || null, note: d.note || '',
      deductionKey: cat?.deductible ? cat.deductionKey : null,
    };
    if (existing) await repo.update('transactions', existing.id, patch); else await repo.insert('transactions', patch);
  });
}

function memberForm() {
  openForm('Nuevo módulo', [
    { name: 'name', label: 'Nombre del módulo (p. ej. Familia, Dra. Tere, Farmasi)', required: true },
    { name: 'icon', label: 'Emoji (opcional)' },
    { name: 'kind', label: 'Tipo', type: 'select', options: [{ value: 'person', label: '👤 Persona (integrante)' }, { value: 'household', label: '🏠 Familia / Hogar' }, { value: 'business', label: '💼 Negocio (flujo separado)' }] },
    { name: 'consolidates', label: 'Consolidar en el presupuesto familiar', type: 'checkbox' },
  ], { kind: 'person', consolidates: true }, async (d) => {
    const m = await repo.insert('members', { name: d.name, icon: d.icon || '', kind: d.kind, consolidates: d.consolidates });
    state.memberId = m.id;
  });
}

// ============================================================================
//  IMPORTACIÓN / EXPORTACIÓN EN EXCEL Y JSON
// ============================================================================
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function gatherModule(memberId, member) {
  const accounts = await repo.all('accounts', memberId);
  const categories = await repo.all('categories', memberId);
  const transactions = await repo.all('transactions', memberId);
  const goals = await repo.all('goals', memberId);
  const budgetBaseMonthly = await repo.getBudgetBase(memberId, 'monthly');
  const overridesCurrent = (await repo.getOverrides(memberId))[periodId()] || {};
  return {
    name: member?.name || 'Módulo', accounts, categories, transactions, goals,
    budgetBaseMonthly, overridesCurrent, periodId: periodId(),
    balanceOf: (a) => engine.accountBalance(a, transactions),
  };
}

function safeName(s) { return (s || 'modulo').replace(/[^\w\-]+/g, '_'); }

async function exportCurrentExcel() {
  if (!window.XLSX) return alert('No se pudo cargar la librería de Excel (revisa tu conexión).');
  const members = await repo.all('members');
  const member = members.find(m => m.id === state.memberId);
  const wb = excel.buildModuleWorkbook(await gatherModule(state.memberId, member));
  excel.downloadWorkbook(wb, `finanzas_${safeName(member?.name)}_${periodId()}.xlsx`);
}

async function exportAllExcel() {
  if (!window.XLSX) return alert('No se pudo cargar la librería de Excel (revisa tu conexión).');
  const members = await repo.all('members');
  const modules = [];
  for (const m of members) modules.push(await gatherModule(m.id, m));
  excel.downloadWorkbook(excel.buildAllWorkbook(modules), `finanzas_todos_${periodId()}.xlsx`);
}

function pickFile(inputId, onArrayBuffer) {
  const input = el(inputId);
  input.value = '';
  input.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => onArrayBuffer(r.result, f.name);
    inputId === 'json-input' ? r.readAsText(f) : r.readAsArrayBuffer(f);
  };
  input.click();
}

async function importExcel(arrayBuffer, fileName) {
  if (!window.XLSX) return alert('No se pudo cargar la librería de Excel.');
  let parsed;
  try { parsed = excel.readWorkbook(new Uint8Array(arrayBuffer)); }
  catch (err) { return alert('No se pudo leer el archivo: ' + err.message); }
  const members = await repo.all('members');
  const cur = members.find(m => m.id === state.memberId);
  const replace = confirm(
    `Importar ${parsed.accounts.length} cuentas, ${parsed.transactions.length} movimientos.\n\n` +
    `Aceptar = REEMPLAZAR el módulo actual «${cur?.name}».\n` +
    `Cancelar = crear un MÓDULO NUEVO con estos datos.`);
  await applyImport(parsed, replace ? 'replace' : 'new', fileName);
  await refresh();
  alert('Importación completada.');
}

async function applyImport(parsed, mode, fileName) {
  let memberId;
  if (mode === 'replace') {
    memberId = state.memberId;
    for (const coll of ['accounts', 'categories', 'transactions', 'goals'])
      for (const r of await repo.all(coll, memberId)) await repo.remove(coll, r.id);
    await repo.clearBudgets(memberId);
    for (const a of parsed.accounts) await repo.insert('accounts', { ...a, id: a.id || uid(), memberId });
    for (const c of parsed.categories) await repo.insert('categories', { ...c, id: c.id || uid(), memberId });
    for (const g of parsed.goals) await repo.insert('goals', { ...g, id: g.id || uid(), memberId });
    for (const t of parsed.transactions) await repo.insert('transactions', { ...t, id: t.id || uid(), memberId, destAccountId: t.destAccountId || undefined });
    for (const [cat, amt] of Object.entries(parsed.budgetBaseMonthly)) await repo.setBudgetBase(memberId, 'monthly', cat, amt);
    for (const [cat, amt] of Object.entries(parsed.overrides)) await repo.setOverride(memberId, periodId(), cat, amt);
  } else {
    const name = (fileName || '').replace(/\.[^.]+$/, '').replace(/^finanzas_/, '') || ('Importado ' + new Date().toLocaleDateString('es-MX'));
    const m = await repo.insert('members', { name, kind: 'person', consolidates: false, icon: '📥' });
    memberId = m.id;
    const map = {}; // id viejo -> id nuevo (referencias remapeadas)
    for (const a of parsed.accounts) { const id = uid(); if (a.id) map[a.id] = id; await repo.insert('accounts', { ...a, id, memberId }); }
    for (const c of parsed.categories) { if (c.id) map[c.id] = uid(); }
    for (const c of parsed.categories) await repo.insert('categories', { ...c, id: c.id ? map[c.id] : uid(), memberId, parentId: c.parentId ? (map[c.parentId] || null) : null });
    for (const g of parsed.goals) { const id = uid(); if (g.id) map[g.id] = id; await repo.insert('goals', { ...g, id, memberId, accountId: g.accountId ? (map[g.accountId] || null) : null }); }
    for (const t of parsed.transactions) await repo.insert('transactions', { ...t, id: uid(), memberId, categoryId: t.categoryId ? (map[t.categoryId] || null) : null, accountId: t.accountId ? (map[t.accountId] || null) : null, destAccountId: t.destAccountId ? (map[t.destAccountId] || undefined) : undefined });
    for (const [cat, amt] of Object.entries(parsed.budgetBaseMonthly)) await repo.setBudgetBase(memberId, 'monthly', map[cat] || cat, amt);
    for (const [cat, amt] of Object.entries(parsed.overrides)) await repo.setOverride(memberId, periodId(), map[cat] || cat, amt);
    state.memberId = memberId;
  }
}

function downloadBlob(content, filename, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function backupJson() {
  downloadBlob(await repo.export(), `respaldo_finanzas_v2_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
}

async function restoreJson(text) {
  if (!confirm('Restaurar reemplazará TODOS los datos actuales. ¿Continuar?')) return;
  try { await repo.import(text); state.memberId = null; await refresh(); alert('Respaldo restaurado.'); }
  catch (err) { alert('Archivo inválido: ' + err.message); }
}

// ============================================================================
//  EVENTOS GLOBALES (delegación)
// ============================================================================
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  if (a === 'modal-close') return closeModal();
  if (a === 'member-add') return memberForm();
  if (a === 'member-del') {
    const members = await repo.all('members');
    if (members.length <= 1) return alert('Debe existir al menos un módulo.');
    if (confirm('¿Eliminar este módulo y TODOS sus datos? Esta acción no se puede deshacer.')) {
      await repo.remove('members', state.memberId);
      // limpia datos huérfanos
      for (const coll of ['accounts', 'categories', 'transactions', 'goals'])
        for (const r of await repo.all(coll, state.memberId)) await repo.remove(coll, r.id);
      state.memberId = null; await refresh();
    }
    return;
  }
  if (a === 'tx-add') return transactionForm(null);
  if (a === 'acc-add') return accountForm(null);
  if (a === 'cat-add') return categoryForm(null);
  if (a === 'export-xlsx') return exportCurrentExcel();
  if (a === 'export-all-xlsx') return exportAllExcel();
  if (a === 'import-xlsx') return pickFile('xlsx-input', importExcel);
  if (a === 'backup-json') return backupJson();
  if (a === 'restore-json') return pickFile('json-input', restoreJson);
  if (a === 'edit') {
    const rows = await repo.all(t.dataset.coll);
    const row = rows.find(r => r.id === t.dataset.id);
    if (t.dataset.coll === 'accounts') return accountForm(row);
    if (t.dataset.coll === 'categories') return categoryForm(row);
    if (t.dataset.coll === 'transactions') return transactionForm(row);
  }
  if (a === 'del') {
    if (confirm('¿Eliminar este registro?')) { await repo.remove(t.dataset.coll, t.dataset.id); await refresh(); }
  }
});

// Edición en línea: presupuesto, supuestos, parámetros de negocio/deuda
document.addEventListener('change', async (e) => {
  const i = e.target;
  if (i.dataset.budget) {
    const amount = i.value === '' ? null : parseFloat(i.value);
    if (i.dataset.budget === 'base') await repo.setBudgetBase(state.memberId, 'monthly', i.dataset.cat, amount || 0);
    else if (amount != null) await repo.setOverride(state.memberId, periodId(), i.dataset.cat, amount);
    return refresh();
  }
  if (i.dataset.asmp) { await repo.setAssumptions({ [i.dataset.asmp]: parseFloat(i.value) / 100 }); return refresh(); }
  if (i.dataset.memberNum) { await repo.update('members', state.memberId, { [i.dataset.memberNum]: parseFloat(i.value) || 0 }); return refresh(); }
  if (i.dataset.biz) {
    const members = await repo.all('members');
    const m = members.find(x => x.id === state.memberId);
    const business = { ...(m.business || { revenue: 18000, variableCosts: 7000, fixedCosts: 4000, unitPrice: 350, unitVariableCost: 140 }), [i.dataset.biz]: parseFloat(i.value) || 0 };
    await repo.update('members', state.memberId, { business });
    return refresh();
  }
});

el('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab'); if (!btn) return;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === btn));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + btn.dataset.view));
});
el('member-select').addEventListener('change', (e) => { state.memberId = e.target.value; refresh(); });

// ===== Tema claro/oscuro (compartido con la vista premium) =====
function applyThemeIcon() {
  const dark = document.documentElement.classList.contains('dark');
  const btn = el('theme-toggle');
  if (btn) btn.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon-star'}"></i>`;
  if (window.lucide) lucide.createIcons();
}
function initTheme() {
  const saved = localStorage.getItem('fz_theme');
  if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
  applyThemeIcon();
}
el('theme-toggle').addEventListener('click', () => {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('fz_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  applyThemeIcon();
});

initTheme();
bootstrap();

// PWA: registra el service worker (ruta relativa -> funciona en / o en /v2/)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
