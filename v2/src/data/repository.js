// ============================================================================
//  repository.js — CAPA DE DATOS (offline-first)
//  Patrón Repository sobre el almacenamiento del navegador. La interfaz es
//  asíncrona a propósito: hoy persiste en localStorage; mañana se puede
//  sustituir por IndexedDB o un backend Supabase SIN tocar el dominio ni la UI.
//
//  Decisión de arquitectura (CTO): los datos financieros familiares NO salen
//  del dispositivo por defecto. Privacidad y costo cero. El esquema SQL es el
//  contrato; este repo es una implementación de ese contrato.
// ============================================================================

const KEY = 'finanzas_v2';

const EMPTY = {
  members: [],
  accounts: [],
  categories: [],
  transactions: [],
  goals: [],
  budgetBase: {},      // { memberId: { 'monthly'|'weekly': { categoryId: amount } } }
  budgetOverride: {},  // { memberId: { periodId: { categoryId: amount } } }
  assumptions: { inflationRate: 0.045, marketReturn: 0.09, safeWithdrawal: 0.04, taxYear: 2026 },
};

// Clon profundo compatible con todos los navegadores (evita structuredClone,
// que solo existe en Safari 15.4+/Chrome 98+). EMPTY es JSON puro.
const clone = (o) => JSON.parse(JSON.stringify(o));

export class Repository {
  constructor(storage = window.localStorage) {
    this.storage = storage;
    this._cache = null;
  }

  async _read() {
    if (this._cache) return this._cache;
    try {
      const raw = this.storage.getItem(KEY);
      this._cache = raw ? { ...clone(EMPTY), ...JSON.parse(raw) } : clone(EMPTY);
    } catch {
      this._cache = clone(EMPTY);
    }
    return this._cache;
  }

  async _write(data) {
    this._cache = data;
    this.storage.setItem(KEY, JSON.stringify(data));
  }

  // --- Consultas genéricas por colección -----------------------------------
  async all(collection, memberId = null) {
    const d = await this._read();
    const rows = d[collection] || [];
    return memberId ? rows.filter(r => r.memberId === memberId) : rows;
  }

  async insert(collection, row) {
    const d = await this._read();
    row.id = row.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    (d[collection] ||= []).push(row);
    await this._write(d);
    return row;
  }

  async update(collection, id, patch) {
    const d = await this._read();
    const arr = d[collection] || [];
    const i = arr.findIndex(r => r.id === id);
    if (i === -1) return null;
    arr[i] = { ...arr[i], ...patch };
    await this._write(d);
    return arr[i];
  }

  async remove(collection, id) {
    const d = await this._read();
    d[collection] = (d[collection] || []).filter(r => r.id !== id);
    await this._write(d);
  }

  // --- Presupuesto base / override -----------------------------------------
  async getBudgetBase(memberId, periodType) {
    const d = await this._read();
    return d.budgetBase?.[memberId]?.[periodType] || {};
  }
  async setBudgetBase(memberId, periodType, categoryId, amount) {
    const d = await this._read();
    (((d.budgetBase ||= {})[memberId] ||= {})[periodType] ||= {})[categoryId] = amount;
    await this._write(d);
  }
  async getOverrides(memberId) {
    const d = await this._read();
    return d.budgetOverride?.[memberId] || {};
  }
  async setOverride(memberId, periodId, categoryId, amount) {
    const d = await this._read();
    (((d.budgetOverride ||= {})[memberId] ||= {})[periodId] ||= {})[categoryId] = amount;
    await this._write(d);
  }

  async clearBudgets(memberId) {
    const d = await this._read();
    if (d.budgetBase) delete d.budgetBase[memberId];
    if (d.budgetOverride) delete d.budgetOverride[memberId];
    await this._write(d);
  }

  async assumptions() { return (await this._read()).assumptions; }
  async setAssumptions(patch) {
    const d = await this._read();
    d.assumptions = { ...d.assumptions, ...patch };
    await this._write(d);
  }

  async export() { return JSON.stringify(await this._read(), null, 2); }
  async import(json) { await this._write({ ...clone(EMPTY), ...JSON.parse(json) }); }
  async reset() { await this._write(clone(EMPTY)); }
}
