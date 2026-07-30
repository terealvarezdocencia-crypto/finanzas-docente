// ============================================================================
//  premium.js — Dashboard + Presupuesto (lenguaje visual fintech premium)
//  Reutiliza el MISMO dominio (repository + engine). Solo cambia la piel.
// ============================================================================
import { Repository } from '../data/repository.js';
import * as engine from '../core/engine.js';
import * as debt from '../core/debt.js';
import * as tax from '../core/tax.js';
import * as biz from '../core/business.js';

const repo = new Repository();
const el = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);
const fmt2 = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);
const pct = (n) => (isFinite(n) ? n.toFixed(0) + '%' : '∞');
const monthOf = (d) => (d || '').slice(0, 7);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const C = { income: '#10b981', expense: '#fb7185', invest: '#8b5cf6', slate: '#94a3b8' };

// Paleta para el anillo de egresos (acentos sofisticados, sin neón)
const DONUT_PALETTE = ['#fb7185', '#f97362', '#fb923c', '#f59e0b', '#a78bfa', '#8b5cf6', '#22d3ee', '#34d399'];

// --- Iconografía cohesiva: keyword -> icono Lucide + acento ------------------
const ICON_RULES = [
  [/sueldo|salario|ingreso|honorario|n[oó]mina/i, 'banknote', 'income'],
  [/freelance|negocio|venta|comisi/i, 'briefcase', 'income'],
  [/despensa|aliment|super|comida|tianguis/i, 'shopping-cart', 'expense'],
  [/transporte|gasolina|uber|taxi|auto|coche/i, 'car', 'expense'],
  [/vivienda|renta|hogar|casa/i, 'home', 'expense'],
  [/servicio|luz|agua|gas|internet|tel[eé]/i, 'plug-zap', 'expense'],
  [/salud|m[eé]dic|hospital|dent|farmac/i, 'heart-pulse', 'expense'],
  [/educaci|escuela|colegiatura|curso/i, 'graduation-cap', 'expense'],
  [/ropa|vestido/i, 'shirt', 'expense'],
  [/entreten|ocio|cine|viaje|vacacion/i, 'party-popper', 'expense'],
  [/seguro/i, 'shield-check', 'expense'],
  [/impuesto|isr|fiscal/i, 'landmark', 'expense'],
  [/ahorro|fondo|emergencia/i, 'piggy-bank', 'invest'],
  [/inversi|retiro|ppr|libertad/i, 'trending-up', 'invest'],
];
function iconFor(name) {
  for (const [re, icon, accent] of ICON_RULES) if (re.test(name || '')) return { icon, accent };
  return { icon: 'circle-dollar-sign', accent: 'expense' };
}
const ACCENT = {
  income: { bg: 'bg-income/10', text: 'text-income', dot: '#10b981' },
  expense: { bg: 'bg-expense/10', text: 'text-expense', dot: '#fb7185' },
  invest: { bg: 'bg-invest/10', text: 'text-invest', dot: '#8b5cf6' },
};
function badge(name, size = 'w-9 h-9') {
  const { icon, accent } = iconFor(name);
  const a = ACCENT[accent];
  return `<span class="grid place-items-center ${size} rounded-xl ${a.bg} ${a.text} shrink-0"><i data-lucide="${icon}" class="w-[18px] h-[18px]"></i></span>`;
}

// --- Sparkline SVG inline ---------------------------------------------------
function sparkline(values, color) {
  const w = 96, h = 30, n = values.length;
  if (n < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (n - 1)) * w, h - ((v - min) / span) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = d + ` L${w} ${h} L0 ${h} Z`;
  const id = 'sp' + Math.random().toString(36).slice(2, 7);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="overflow-visible">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ============================================================================
let charts = {};
let state = { memberId: localStorage.getItem('fz_member') || null };

async function boot() {
  let members = await repo.all('members');
  if (!members.length) { await seedDemo(); members = await repo.all('members'); }
  if (!members.length) { el('app').classList.add('hidden'); el('empty').classList.remove('hidden'); lucide.createIcons(); return; }
  initTheme();
  render();
}

// Siembra de ejemplo (idéntica a la gestión) para que cualquier entrada muestre
// un panel vivo, no una pantalla vacía.
async function seedDemo() {
  try {
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
  } catch (e) { /* si algo falla, se mostrará el estado vacío */ }
}

function applyThemeBg() {
  // Fondo por estilo en línea: prioridad máxima, inmune a quirks de orden del CDN.
  const dark = document.documentElement.classList.contains('dark');
  document.body.style.backgroundColor = dark ? '#020617' : '#f8fafc';
  document.body.style.color = dark ? '#e2e8f0' : '#0f172a';
}

function initTheme() {
  const saved = localStorage.getItem('fz_theme');
  if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
  applyThemeBg();
  el('theme-toggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('fz_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    applyThemeBg();
    setTimeout(render, 60); // re-pinta gráficas con colores del tema
  });
}

async function render() {
  const members = await repo.all('members');
  if (!members.find(m => m.id === state.memberId)) state.memberId = members.find(m => m.kind === 'person')?.id || members[0].id;
  localStorage.setItem('fz_member', state.memberId || '');
  const member = members.find(m => m.id === state.memberId);

  el('greeting').textContent = 'Hola, ' + (member.name.split(' ').slice(-1)[0] || member.name);
  el('member-select').innerHTML = members.map(m => `<option value="${m.id}" ${m.id === state.memberId ? 'selected' : ''}>${m.icon || ''} ${m.name}</option>`).join('');

  const accounts = await repo.all('accounts', state.memberId);
  const categories = await repo.all('categories', state.memberId);
  const txns = await repo.all('transactions', state.memberId);

  const monthTx = txns.filter(t => monthOf(t.date) === thisMonth());
  const nw = engine.netWorth(accounts, txns);
  const flow = engine.periodFlow(monthTx);
  const immediate = accounts.filter(a => ['DEBT', 'CREDIT_LINE'].includes(a.accountClass)).reduce((s, a) => s + (a.minPayment || 0), 0);
  const k = engine.kpis(flow, nw, immediate);

  const series = monthlySeries(txns, 6);
  renderKpis(k, nw, series);
  renderArea(series);
  renderDonut(monthTx, categories);
  await renderBudget(categories, monthTx, k);

  const asmp = await repo.assumptions();
  renderDebt(accounts, txns, member);
  renderProjection(nw, flow, asmp);
  renderTax(monthTx, flow, categories);
  renderBusiness(member);

  lucide.createIcons();
}

// --- Navegación entre vistas ------------------------------------------------
function setTab(view) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view-pane').forEach(p => p.classList.toggle('active', p.id === 'view-' + view));
}

// Agrega ingresos/gastos por mes (últimos n meses, incluyendo vacíos)
function monthlySeries(txns, n) {
  const labels = [], inc = [], exp = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    labels.push(d.toLocaleDateString('es-MX', { month: 'short' }));
    const mt = txns.filter(t => monthOf(t.date) === key);
    inc.push(mt.filter(t => t.kind === 'income').reduce((s, t) => s + t.amount, 0));
    exp.push(mt.filter(t => t.kind === 'expense').reduce((s, t) => s + t.amount, 0));
  }
  return { labels, inc, exp };
}

// --- KPI CARDS --------------------------------------------------------------
function renderKpis(k, nw, series) {
  const net = series.inc.map((v, i) => v - series.exp[i]);
  const cards = [
    { label: 'Patrimonio neto', icon: 'wallet', accent: nw.netWorth >= 0 ? 'invest' : 'expense', value: fmt(nw.netWorth), sub: 'Líquido ' + fmt(nw.liquidCapital), spark: net, color: C.invest },
    { label: 'Margen post-deuda', icon: 'percent', accent: k.status === 'green' ? 'income' : k.status === 'yellow' ? 'expense' : 'expense', value: pct(k.netMarginPct), sub: fmt(k.netAfterDebt) + ' libres', spark: net, color: k.status === 'red' ? C.expense : C.income, status: k.status },
    { label: 'Liquidez corriente', icon: 'droplets', accent: 'income', value: (isFinite(k.liquidityRatio) ? k.liquidityRatio.toFixed(1) : '∞') + '×', sub: 'Activo / pasivo inmediato', spark: series.inc, color: C.income },
    { label: 'Días de autonomía', icon: 'shield', accent: 'invest', value: isFinite(k.autonomyDays) ? Math.round(k.autonomyDays) : '∞', sub: 'Sin ingresos', spark: series.inc, color: C.invest },
  ];
  const dot = { green: 'bg-income', yellow: 'bg-amber-400', red: 'bg-expense' };
  el('kpi-grid').innerHTML = cards.map((c, i) => {
    const a = ACCENT[c.accent];
    return `<div class="card-hover fade-up rounded-3xl bg-white dark:bg-white/[.04] border border-slate-100 dark:border-white/10 shadow-soft hover:shadow-lift p-5" style="animation-delay:${i * 60}ms">
      <div class="flex items-center justify-between mb-4">
        <span class="grid place-items-center w-10 h-10 rounded-2xl ${a.bg} ${a.text}"><i data-lucide="${c.icon}" class="w-5 h-5"></i></span>
        ${c.status ? `<span class="w-2.5 h-2.5 rounded-full ${dot[c.status]} ring-4 ring-current/10"></span>` : ''}
      </div>
      <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">${c.label}</p>
      <p class="text-[1.7rem] leading-tight font-extrabold tracking-tight tabnum mt-0.5">${c.value}</p>
      <div class="flex items-end justify-between mt-1">
        <p class="text-xs text-slate-400 dark:text-slate-500 tabnum">${c.sub}</p>
        <div class="opacity-90">${sparkline(c.spark, c.color)}</div>
      </div>
    </div>`;
  }).join('');
}

// --- ÁREA: flujo de caja con gradiente y curva monotone --------------------
function renderArea(series) {
  const ctx = el('chart-area').getContext('2d');
  if (charts.area) charts.area.destroy();
  const dark = document.documentElement.classList.contains('dark');
  const grad = (hex) => {
    const g = ctx.createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, hex + '55'); g.addColorStop(1, hex + '00');
    return g;
  };
  charts.area = new Chart(ctx, {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: [
        { label: 'Ingresos', data: series.inc, borderColor: C.income, backgroundColor: grad(C.income), fill: true, tension: 0.45, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: C.income, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2 },
        { label: 'Egresos', data: series.exp, borderColor: C.expense, backgroundColor: grad(C.expense), fill: true, tension: 0.45, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: C.expense, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeInOutCubic' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: dark ? '#0f172a' : '#fff', titleColor: dark ? '#e2e8f0' : '#0f172a', bodyColor: dark ? '#94a3b8' : '#475569', borderColor: dark ? 'rgba(255,255,255,.1)' : '#e2e8f0', borderWidth: 1, padding: 12, cornerRadius: 12, boxPadding: 6, usePointStyle: true, callbacks: { label: (c) => '  ' + c.dataset.label + ': ' + fmt(c.parsed.y) } },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: C.slate, font: { size: 11, weight: '600' } } },
        y: { grid: { color: dark ? 'rgba(255,255,255,.05)' : 'rgba(15,23,42,.05)' }, border: { display: false }, ticks: { color: C.slate, font: { size: 11 }, maxTicksLimit: 5, callback: (v) => '$' + (v / 1000) + 'k' } },
      },
    },
  });
}

// --- DONA: anillo delgado, bordes redondeados, centro dinámico -------------
function renderDonut(monthTx, categories) {
  const ctx = el('chart-donut').getContext('2d');
  if (charts.donut) charts.donut.destroy();
  const byCat = {};
  monthTx.filter(t => t.kind === 'expense').forEach(t => { const name = categories.find(c => c.id === t.categoryId)?.name || 'Otros'; byCat[name] = (byCat[name] || 0) + t.amount; });
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);
  el('donut-total').textContent = fmt(total);

  if (!entries.length) { el('donut-legend').innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Sin egresos este mes</p>'; return; }
  const labels = entries.map(e => e[0]), data = entries.map(e => e[1]);
  const colors = entries.map((_, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]);

  charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: 'transparent', borderRadius: 10, borderWidth: 0, spacing: 4, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '76%',
      animation: { animateRotate: true, duration: 900, easing: 'easeInOutCubic' },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      onHover: (e, els) => {
        const ct = el('donut-total'), lbl = el('donut-center').querySelector('p');
        if (els.length) { const i = els[0].index; ct.textContent = pct(data[i] / total * 100); lbl.textContent = labels[i]; }
        else { ct.textContent = fmt(total); lbl.textContent = 'Total'; }
      },
    },
  });

  el('donut-legend').innerHTML = entries.slice(0, 5).map(([name, val], i) => `
    <div class="flex items-center gap-2.5 text-sm">
      ${badge(name, 'w-7 h-7')}
      <span class="truncate flex-1 text-slate-600 dark:text-slate-300">${name}</span>
      <span class="font-semibold tabnum">${fmt(val)}</span>
      <span class="text-xs text-slate-400 tabnum w-9 text-right">${pct(val / total * 100)}</span>
    </div>`).join('');
}

// --- PRESUPUESTO: filas limpias, semáforo por tipografía -------------------
async function renderBudget(categories, monthTx, k) {
  el('budget-period').textContent = new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  const base = await repo.getBudgetBase(state.memberId, 'monthly');
  const ov = (await repo.getOverrides(state.memberId))[thisMonth()] || {};
  const real = {};
  monthTx.filter(t => t.kind === 'expense').forEach(t => real[t.categoryId] = (real[t.categoryId] || 0) + t.amount);

  const rows = categories.filter(c => c.flow === 'expense').map(c => {
    const planned = ov[c.id] != null ? ov[c.id] : (base[c.id] || 0);
    return { c, planned, spent: real[c.id] || 0 };
  }).filter(r => r.planned > 0 || r.spent > 0).sort((a, b) => b.spent - a.spent);

  const health = { green: ['Saludable', 'text-income bg-income/10'], yellow: ['Estrés de flujo', 'text-amber-500 bg-amber-400/10'], red: ['Déficit', 'text-expense bg-expense/10'] }[k.status];
  el('budget-health').className = 'text-xs font-semibold px-3 py-1.5 rounded-full ' + health[1];
  el('budget-health').textContent = health[0];

  if (!rows.length) { el('budget-table').innerHTML = '<p class="text-sm text-slate-400 text-center py-8">Define montos base en la <a href="index.html" class="underline">gestión completa</a>.</p>'; return; }

  el('budget-table').innerHTML = `<div class="divide-y divide-slate-100 dark:divide-white/10">${rows.map(({ c, planned, spent }) => {
    const ratio = planned > 0 ? spent / planned : 1;
    const over = spent > planned;
    const tone = planned <= 0 ? 'text-slate-400' : over ? 'text-expense' : ratio > 0.85 ? 'text-amber-500' : 'text-income';
    const bar = planned <= 0 ? 'bg-slate-300' : over ? 'bg-expense' : ratio > 0.85 ? 'bg-amber-400' : 'bg-income';
    const w = Math.min(100, Math.round(ratio * 100));
    return `<div class="flex items-center gap-4 py-3.5 group">
      ${badge(c.name)}
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-3">
          <p class="font-semibold truncate">${c.name}</p>
          <p class="tabnum font-semibold ${tone}">${fmt2(spent)}</p>
        </div>
        <div class="flex items-center gap-3 mt-1.5">
          <div class="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
            <div class="h-full rounded-full ${bar} transition-all duration-700" style="width:${w}%"></div>
          </div>
          <p class="text-xs text-slate-400 tabnum shrink-0">de ${fmt(planned)}</p>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// --- DEUDA CERO -------------------------------------------------------------
function renderDebt(accounts, txns, member) {
  const debts = accounts.filter(a => ['DEBT', 'CREDIT_LINE'].includes(a.accountClass))
    .map(a => ({ id: a.id, name: a.name, balance: engine.accountBalance(a, txns), apr: a.apr || 0, minPayment: a.minPayment || 0 }))
    .filter(d => d.balance > 0.01);
  const extra = member.debtExtra ?? 3000;
  el('debt-extra').value = extra;
  if (!debts.length) {
    el('debt-strategies').innerHTML = `<div class="md:col-span-2 rounded-3xl bg-income/10 text-income p-8 text-center">
      <div class="grid place-items-center w-14 h-14 mx-auto rounded-2xl bg-income/15 mb-3"><i data-lucide="party-popper" class="w-7 h-7"></i></div>
      <p class="text-lg font-bold">¡Sin deudas! 🎉</p><p class="text-sm opacity-80">Tu flujo está libre de pasivos.</p></div>`;
    el('debt-list').innerHTML = '';
    return;
  }
  const cmp = debt.compareStrategies(debts, extra);
  const nameOf = (id) => debts.find(d => d.id === id)?.name || '';
  const card = (title, sub, plan, rec, icon) => `
    <div class="rounded-3xl p-6 border ${rec ? 'border-invest/40 bg-invest/[.05] shadow-lift' : 'border-slate-100 dark:border-white/10 bg-white dark:bg-white/[.04] shadow-soft'}">
      <div class="flex items-center gap-3 mb-4">
        <span class="grid place-items-center w-10 h-10 rounded-2xl ${rec ? 'bg-invest text-white' : 'bg-slate-100 dark:bg-white/10 text-slate-500'}"><i data-lucide="${icon}" class="w-5 h-5"></i></span>
        <div><p class="font-bold leading-tight">${title}</p><p class="text-xs text-slate-400">${sub}</p></div>
        ${rec ? '<span class="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full bg-invest text-white">Recomendada</span>' : ''}
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><p class="text-[11px] uppercase tracking-wider text-slate-400">Libre en</p><p class="text-xl font-extrabold tabnum">${plan.years} años</p></div>
        <div><p class="text-[11px] uppercase tracking-wider text-slate-400">Interés total</p><p class="text-xl font-extrabold tabnum text-expense">${fmt(plan.totalInterest)}</p></div>
      </div>
      <p class="text-xs text-slate-400 mt-3 truncate">Orden: ${plan.payoffOrder.map(nameOf).join(' → ')}</p>
    </div>`;
  const recA = cmp.recommendation === 'avalanche';
  el('debt-strategies').innerHTML = card('Avalancha', 'Prioriza mayor tasa', cmp.avalanche, recA, 'mountain-snow')
    + card('Bola de nieve', 'Prioriza menor saldo', cmp.snowball, !recA, 'snowflake');
  const ordered = debt.prioritize(debts, cmp.recommendation);
  const maxBal = Math.max(...ordered.map(d => d.balance));
  el('debt-list').innerHTML = `<div class="divide-y divide-slate-100 dark:divide-white/10">${ordered.map(d => `
    <div class="flex items-center gap-4 py-3.5">${badge(d.name)}
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-3">
          <p class="font-semibold truncate">${d.name} <span class="ml-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-expense/10 text-expense">${(d.apr * 100).toFixed(0)}% APR</span></p>
          <p class="tabnum font-semibold text-expense">${fmt2(d.balance)}</p>
        </div>
        <div class="h-1.5 mt-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-expense/70 transition-all duration-700" style="width:${Math.round(d.balance / maxBal * 100)}%"></div></div>
      </div>
    </div>`).join('')}</div>`;
}

// --- PROYECCIÓN -------------------------------------------------------------
function numRow(key, label, value, suffix) {
  return `<label class="flex items-center justify-between gap-3 text-sm">
    <span class="text-slate-500 dark:text-slate-400">${label}</span>
    <span class="relative inline-flex items-center">
      <input data-asmp="${key}" type="number" step="0.1" value="${value}" class="w-24 text-right tabnum rounded-xl pl-3 pr-7 py-1.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-invest/40">
      <span class="absolute right-3 text-xs text-slate-400 pointer-events-none">${suffix}</span>
    </span></label>`;
}
function renderProjection(nw, flow, asmp) {
  const monthly = Math.max(0, flow.income - flow.expenses - flow.debtService);
  const rows = engine.projectNetWorth({ principal: nw.netWorth, monthlyContribution: monthly, annualReturn: asmp.marketReturn, inflation: asmp.inflationRate, horizons: [1, 3, 5] });
  el('projection-cards').innerHTML = rows.map(r => `
    <div class="rounded-3xl bg-white dark:bg-white/[.04] border border-slate-100 dark:border-white/10 shadow-soft p-5 card-hover">
      <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">${r.year} año${r.year > 1 ? 's' : ''}</p>
      <p class="text-2xl font-extrabold tabnum tracking-tight mt-1 text-invest">${fmt(r.nominal)}</p>
      <p class="text-xs text-slate-400 mt-1">Real hoy ${fmt(r.real)}</p>
      <p class="text-[11px] text-income mt-2">+${fmt(r.growth)} por interés</p>
    </div>`).join('');
  const full = engine.projectNetWorth({ principal: nw.netWorth, monthlyContribution: monthly, annualReturn: asmp.marketReturn, inflation: asmp.inflationRate, horizons: [1, 2, 3, 4, 5] });
  const labels = ['Hoy', ...full.map(r => 'Año ' + r.year)];
  const nominal = [nw.netWorth, ...full.map(r => r.nominal)];
  const real = [nw.netWorth, ...full.map(r => r.real)];
  const fire = engine.yearsToFreedom({ principal: nw.netWorth, monthlyContribution: monthly, annualExpenses: flow.expenses * 12, annualReturn: asmp.marketReturn, safeWithdrawal: asmp.safeWithdrawal });
  renderProjectionChart(labels, nominal, real, fire.target);
  el('projection-assumptions').innerHTML =
    numRow('marketReturn', 'Rendimiento anual', (asmp.marketReturn * 100).toFixed(1), '%')
    + numRow('inflationRate', 'Inflación anual', (asmp.inflationRate * 100).toFixed(1), '%')
    + numRow('safeWithdrawal', 'Tasa de retiro (SWR)', (asmp.safeWithdrawal * 100).toFixed(1), '%');
  el('fire-box').innerHTML = `<div class="flex items-center gap-2 mb-1"><i data-lucide="bird" class="w-4 h-4"></i><span class="text-xs font-bold uppercase tracking-wider">Libertad financiera</span></div>
    <p class="text-sm">Número FIRE: <b class="tabnum">${fmt(fire.target)}</b></p>
    <p class="text-sm">Años para lograrlo: <b class="tabnum">${isFinite(fire.years) ? fire.years : '∞'}</b></p>`;
}
function renderProjectionChart(labels, nominal, real, fireTarget) {
  const ctx = el('chart-projection').getContext('2d');
  if (charts.projection) charts.projection.destroy();
  const dark = document.documentElement.classList.contains('dark');
  const g = ctx.createLinearGradient(0, 0, 0, 280);
  g.addColorStop(0, C.invest + '55'); g.addColorStop(1, C.invest + '00');
  charts.projection = new Chart(ctx, {
    type: 'line',
    data: {
      labels, datasets: [
        { label: 'Nominal', data: nominal, borderColor: C.invest, backgroundColor: g, fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
        { label: 'Real (hoy)', data: real, borderColor: C.slate, borderDash: [5, 4], fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 },
        { label: 'Meta FIRE', data: labels.map(() => fireTarget), borderColor: C.income, borderDash: [2, 4], fill: false, borderWidth: 1.5, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 900, easing: 'easeInOutCubic' },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 }, color: C.slate } },
        tooltip: { backgroundColor: dark ? '#0f172a' : '#fff', titleColor: dark ? '#e2e8f0' : '#0f172a', bodyColor: dark ? '#94a3b8' : '#475569', borderColor: dark ? 'rgba(255,255,255,.1)' : '#e2e8f0', borderWidth: 1, padding: 12, cornerRadius: 12, usePointStyle: true, callbacks: { label: (c) => '  ' + c.dataset.label + ': ' + fmt(c.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: C.slate, font: { size: 11, weight: '600' } } },
        y: { grid: { color: dark ? 'rgba(255,255,255,.05)' : 'rgba(15,23,42,.05)' }, border: { display: false }, ticks: { color: C.slate, font: { size: 11 }, maxTicksLimit: 5, callback: (v) => '$' + Math.round(v / 1000) + 'k' } },
      },
    },
  });
}

// --- FISCAL -----------------------------------------------------------------
function renderTax(monthTx, flow, categories) {
  const catKey = (id) => categories.find(c => c.id === id)?.deductionKey;
  const ded = monthTx.filter(t => t.deductionKey || catKey(t.categoryId)).map(t => ({ amount: t.amount, deductionKey: t.deductionKey || catKey(t.categoryId) }));
  const grossIncome = flow.income * 12;
  const r = tax.estimateRefund({ grossIncome, withheld: null, deductibleTxns: ded });
  el('tax-refund').textContent = fmt(r.estimatedRefund);
  const row = (l, v, cls = '') => `<div class="flex items-center justify-between py-2.5 border-b border-slate-100 dark:border-white/10 last:border-0"><span class="text-slate-500 dark:text-slate-400 text-sm">${l}</span><span class="tabnum font-semibold ${cls}">${v}</span></div>`;
  el('tax-detail').innerHTML = row('Ingreso anual estimado', fmt(grossIncome))
    + row('Deducciones aplicables', fmt(r.deductions.totalApplied), 'text-invest')
    + row('ISR sin deducciones', fmt(r.isrWithoutDeductions))
    + row('ISR con deducciones', fmt(r.isrWithDeductions))
    + row('Ahorro fiscal', fmt(r.taxSaved), 'text-income')
    + `<p class="text-xs text-slate-400 mt-3">Marca rubros deducibles en la gestión completa. Estimado: actualiza UMA y tarifa ISR cada año.</p>`;
}

// --- NEGOCIO ----------------------------------------------------------------
const BIZ_DEFAULT = { revenue: 18000, variableCosts: 7000, fixedCosts: 4000, unitPrice: 350, unitVariableCost: 140 };
function renderBusiness(member) {
  const b = member.business || BIZ_DEFAULT;
  const d = biz.businessDashboard(b);
  const inp = (key, label) => `<label class="flex items-center justify-between gap-3 text-sm"><span class="text-slate-500 dark:text-slate-400">${label}</span><input data-biz="${key}" type="number" min="0" step="10" value="${b[key]}" class="w-32 text-right tabnum rounded-xl px-3 py-1.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-invest/40"></label>`;
  el('business-inputs').innerHTML = inp('revenue', 'Ingresos del mes') + inp('variableCosts', 'Costos variables') + inp('fixedCosts', 'Costos fijos') + inp('unitPrice', 'Precio unitario') + inp('unitVariableCost', 'Costo variable unitario');
  const metric = (label, value, accent) => `<div class="rounded-2xl bg-slate-50 dark:bg-white/5 p-4"><p class="text-[11px] uppercase tracking-wider text-slate-400">${label}</p><p class="text-xl font-extrabold tabnum mt-1 ${accent || ''}">${value}</p></div>`;
  el('business-metrics').innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
      ${metric('Utilidad neta', fmt(d.netProfit), d.netProfit >= 0 ? 'text-income' : 'text-expense')}
      ${metric('Punto de equilibrio', isFinite(d.breakEven.breakEvenUnits) ? d.breakEven.breakEvenUnits + ' u' : '—')}
      ${metric('Margen de seguridad', d.safetyMarginPct + '%')}
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-2xl bg-invest/10 text-invest p-4"><div class="flex items-center gap-2 mb-1"><i data-lucide="repeat" class="w-4 h-4"></i><span class="text-xs font-bold uppercase tracking-wider">Reinversión 50%</span></div><p class="text-xl font-extrabold tabnum">${fmt(d.split.reinvest)}</p></div>
      <div class="rounded-2xl bg-income/10 text-income p-4"><div class="flex items-center gap-2 mb-1"><i data-lucide="shield-check" class="w-4 h-4"></i><span class="text-xs font-bold uppercase tracking-wider">Fondo emerg. 50%</span></div><p class="text-xl font-extrabold tabnum">${fmt(d.split.emergencyFund)}</p></div>
    </div>`;
}

// --- Eventos ----------------------------------------------------------------
el('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab-btn'); if (b) setTab(b.dataset.view); });
document.addEventListener('change', async (e) => {
  const i = e.target;
  if (i.id === 'debt-extra') { await repo.update('members', state.memberId, { debtExtra: parseFloat(i.value) || 0 }); return render(); }
  if (i.dataset.asmp) { await repo.setAssumptions({ [i.dataset.asmp]: parseFloat(i.value) / 100 }); return render(); }
  if (i.dataset.biz) {
    const m = (await repo.all('members')).find(x => x.id === state.memberId);
    const business = { ...(m.business || BIZ_DEFAULT), [i.dataset.biz]: parseFloat(i.value) || 0 };
    await repo.update('members', state.memberId, { business });
    return render();
  }
});

el('member-select').addEventListener('change', (e) => { state.memberId = e.target.value; render(); });
boot();

// PWA: registra el service worker (ruta relativa -> funciona en / o en /v2/)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
