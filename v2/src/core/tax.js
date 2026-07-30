// ============================================================================
//  tax.js — MÓDULO DE OPTIMIZACIÓN FISCAL (México, persona física)
//  Etiqueta gastos deducibles y estima la devolución de ISR anual.
//
//  AVISO: las constantes (UMA, tarifa ISR) cambian CADA AÑO. Viven aquí
//  centralizadas y deben actualizarse en enero. No es asesoría fiscal formal:
//  es un ESTIMADO orientativo para planeación.
// ============================================================================

// --- Parámetros fiscales (actualizar anualmente) -----------------------------
export const TAX_PARAMS_2026 = {
  uma_annual: 41273.45,          // UMA diaria * 365 (placeholder 2026, ajustar)
  personalDeductionCapUMA: 5,    // tope: 5 UMA anuales...
  personalDeductionCapPct: 0.15, // ...o 15% del ingreso, el MENOR de ambos.
  pprCapUMA: 5,                  // PPR (Art. 185): tope adicional de 5 UMA / 10% ingreso
  pprCapPct: 0.10,
  // Tarifa anual ISR (límite inferior, cuota fija, % sobre excedente). Placeholder.
  brackets: [
    { lower: 0.01,        fixed: 0.00,      rate: 0.0192 },
    { lower: 8952.50,     fixed: 171.88,    rate: 0.0640 },
    { lower: 75984.56,    fixed: 4461.94,   rate: 0.1088 },
    { lower: 133536.08,   fixed: 10723.55,  rate: 0.16 },
    { lower: 155229.81,   fixed: 14194.54,  rate: 0.1792 },
    { lower: 185852.58,   fixed: 19682.14,  rate: 0.2136 },
    { lower: 374837.89,   fixed: 60049.41,  rate: 0.2352 },
    { lower: 590796.00,   fixed: 110842.77, rate: 0.30 },
    { lower: 1127926.85,  fixed: 271962.44, rate: 0.32 },
    { lower: 1503902.47,  fixed: 392294.18, rate: 0.34 },
    { lower: 4511707.38,  fixed: 1414946.86, rate: 0.35 },
  ],
};

/** Claves de deducción reconocidas y si caen bajo el tope general o el de PPR. */
const DEDUCTION_BUCKETS = {
  medical: 'general',          // honorarios médicos, dentales, hospitalarios
  funeral: 'general',
  donations: 'general',
  tuition: 'general',          // colegiaturas (tiene topes propios por nivel)
  mortgage_interest: 'general',
  insurance_medical: 'general',
  ppr: 'retirement',           // aportaciones a plan personal de retiro (Art. 185)
};

/** ISR anual según tarifa (tabla por tramos). */
export function isr(taxableIncome, params = TAX_PARAMS_2026) {
  if (taxableIncome <= 0) return 0;
  const b = [...params.brackets].reverse().find(br => taxableIncome >= br.lower);
  if (!b) return 0;
  return b.fixed + (taxableIncome - b.lower) * b.rate;
}

/**
 * Agrupa transacciones marcadas como deducibles y aplica los topes legales.
 * @param {Array} deductibleTxns  transacciones de gasto con su deduction_key
 * @param {number} grossIncome    ingreso anual gravable estimado
 */
export function deductibles(deductibleTxns, grossIncome, params = TAX_PARAMS_2026) {
  const byKey = {};
  let generalRaw = 0, retirementRaw = 0;
  for (const t of deductibleTxns) {
    const bucket = DEDUCTION_BUCKETS[t.deductionKey];
    if (!bucket) continue;
    byKey[t.deductionKey] = (byKey[t.deductionKey] || 0) + t.amount;
    if (bucket === 'retirement') retirementRaw += t.amount;
    else generalRaw += t.amount;
  }

  // Tope general: el MENOR entre 5 UMA y 15% del ingreso.
  const generalCap = Math.min(
    params.personalDeductionCapUMA * params.uma_annual,
    params.personalDeductionCapPct * grossIncome,
  );
  // Tope PPR: el MENOR entre 5 UMA y 10% del ingreso (independiente del general).
  const pprCap = Math.min(
    params.pprCapUMA * params.uma_annual,
    params.pprCapPct * grossIncome,
  );

  const generalApplied = Math.min(generalRaw, generalCap);
  const pprApplied = Math.min(retirementRaw, pprCap);

  return {
    byKey,
    generalRaw, generalCap, generalApplied,
    pprRaw: retirementRaw, pprCap, pprApplied,
    totalApplied: generalApplied + pprApplied,
  };
}

/**
 * Estima la devolución: ISR ya retenido (sobre ingreso bruto) menos el ISR
 * recalculado sobre la base disminuida por deducciones.
 */
export function estimateRefund({ grossIncome, withheld, deductibleTxns }, params = TAX_PARAMS_2026) {
  const ded = deductibles(deductibleTxns, grossIncome, params);
  const isrWithoutDeductions = isr(grossIncome, params);
  const isrWithDeductions = isr(grossIncome - ded.totalApplied, params);
  // Devolución ~= lo retenido - ISR final. Si no hay retención conocida, usamos
  // el ISR sin deducciones como proxy de lo que "debías".
  const baseline = withheld != null ? withheld : isrWithoutDeductions;
  const refund = Math.max(0, baseline - isrWithDeductions);
  return {
    deductions: ded,
    isrWithoutDeductions,
    isrWithDeductions,
    taxSaved: isrWithoutDeductions - isrWithDeductions,
    estimatedRefund: Math.round(refund * 100) / 100,
  };
}
