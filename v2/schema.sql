-- ============================================================================
--  FINANZAS V2.0 — ESQUEMA CANÓNICO DE DATOS
-- ----------------------------------------------------------------------------
--  Modelo relacional normalizado (3NF). Es la fuente de verdad del dominio.
--  Funciona tal cual en PostgreSQL / Supabase (modo multi-dispositivo futuro)
--  y se mapea 1:1 a los "stores" de IndexedDB en el cliente offline-first.
--
--  REGLA DE NEGOCIO MAESTRA (auditoría V1):
--    El "Capital Líquido Disponible" y las "Líneas de Crédito" viven en tablas
--    y clases distintas. Un pasivo revolvente JAMÁS puede sumar como activo.
--    Esto se garantiza por diseño (account_class) y por CHECK constraints, no
--    por convención de código.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. INTEGRANTES / MÓDULOS
--    Cada integrante (o unidad de negocio) mantiene balances INDEPENDIENTES.
--    La consolidación familiar se calcula en tiempo real (vista), no se duplica.
-- ---------------------------------------------------------------------------
CREATE TABLE members (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('person','household','business')),
    -- 'household' es el agregador padre; 'person' consolida hacia él; 'business'
    -- (Farmacia/Farmasi) se mantiene SEPARADO del flujo familiar por defecto.
    consolidates  BOOLEAN NOT NULL DEFAULT TRUE,   -- ¿suma al presupuesto familiar?
    icon          TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. CUENTAS  —  el corazón de la separación capital vs. crédito
--    account_class es INMUTABLE y define cómo participa en el patrimonio:
--      LIQUID      -> activo disponible real (efectivo, débito, ahorro, inversión)
--      RECEIVABLE  -> activo: dinero que te deben (préstamos otorgados)
--      DEBT        -> pasivo a plazo (crédito auto, hipoteca, préstamo personal)
--      CREDIT_LINE -> pasivo revolvente (TDC). NUNCA es activo ni ahorro.
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
    id              TEXT PRIMARY KEY,
    member_id       TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    account_class   TEXT NOT NULL CHECK (account_class IN
                       ('LIQUID','RECEIVABLE','DEBT','CREDIT_LINE')),
    subtype         TEXT,            -- cash|checking|savings|investment|card|loan...
    opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- Atributos financieros (motor de cálculo)
    apr             NUMERIC(6,4),    -- tasa anual (decimal). Obligatoria si es pasivo.
    credit_limit    NUMERIC(14,2),   -- solo CREDIT_LINE: límite. NO es capital.
    min_payment     NUMERIC(14,2),   -- pago mínimo del periodo (pasivos)
    payment_day     SMALLINT CHECK (payment_day BETWEEN 1 AND 31),
    closing_day     SMALLINT CHECK (closing_day BETWEEN 1 AND 31),

    expected_return NUMERIC(6,4),    -- solo inversión: rendimiento esperado anual
    include_in_net  BOOLEAN NOT NULL DEFAULT TRUE,
    archived        BOOLEAN NOT NULL DEFAULT FALSE,

    -- BLINDAJE: un pasivo debe declarar tasa; el límite solo aplica a revolvente.
    CHECK ( (account_class IN ('DEBT','CREDIT_LINE')) = (apr IS NOT NULL) ),
    CHECK ( credit_limit IS NULL OR account_class = 'CREDIT_LINE' )
);

-- ---------------------------------------------------------------------------
-- 3. RUBROS (categorías) — soportan jerarquía padre/hijo y banderas fiscales
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    id            TEXT PRIMARY KEY,
    member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    flow          TEXT NOT NULL CHECK (flow IN ('income','expense','saving')),
    parent_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
    -- Optimización fiscal:
    deductible    BOOLEAN NOT NULL DEFAULT FALSE,
    deduction_key TEXT,            -- 'medical','ppr','tuition','mortgage_interest'...
    is_fixed      BOOLEAN NOT NULL DEFAULT FALSE,  -- recurrente -> base precargada
    archived      BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------------
-- 4. TRANSACCIONES — registro inmutable de eventos. Una fila = un asiento.
--    'kind' modela el efecto contable sin ambigüedad:
--      income          +activo líquido,            +ingreso del periodo
--      expense         -activo líquido,            +gasto del periodo
--      saving          -líquido origen,            +líquido/inversión destino
--      transfer        -origen,                    +destino (neutro al patrimonio)
--      debt_draw       +líquido destino,           +saldo del pasivo (NO es ingreso)
--      debt_payment    -líquido origen,            -saldo del pasivo (servicio deuda)
--      receivable_in   +líquido,                   -saldo por cobrar
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
    id             TEXT PRIMARY KEY,
    member_id      TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    date           DATE NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN
                     ('income','expense','saving','transfer',
                      'debt_draw','debt_payment','receivable_in')),
    amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
    account_id     TEXT NOT NULL REFERENCES accounts(id),   -- cuenta origen/afectada
    dest_account_id TEXT REFERENCES accounts(id),            -- destino (transfer/saving/pago)
    goal_id        TEXT REFERENCES goals(id) ON DELETE SET NULL,
    interest_part  NUMERIC(14,2) DEFAULT 0,  -- en debt_payment: cuánto fue interés
    note           TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT now(),

    -- Pagos y transferencias exigen destino; un ingreso no.
    CHECK ( dest_account_id IS NULL OR
            kind IN ('transfer','saving','debt_payment','debt_draw') )
);
CREATE INDEX ix_tx_member_date ON transactions (member_id, date);
CREATE INDEX ix_tx_account     ON transactions (account_id);

-- ---------------------------------------------------------------------------
-- 5. PRESUPUESTO BASE (plantilla) — captura cero-fricción
--    El usuario define UNA vez el monto recurrente por rubro. Cada periodo se
--    instancia automáticamente y solo se editan las DESVIACIONES.
-- ---------------------------------------------------------------------------
CREATE TABLE budget_base (
    member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    period_type  TEXT NOT NULL CHECK (period_type IN ('monthly','weekly')),
    amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (member_id, category_id, period_type)
);

-- Override puntual: solo se escribe cuando el periodo se DESVÍA de la base.
CREATE TABLE budget_override (
    member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    period_id    TEXT NOT NULL,        -- '2026-06'  ó  '2026-06-W3'
    amount       NUMERIC(14,2) NOT NULL,
    PRIMARY KEY (member_id, category_id, period_id)
);

-- ---------------------------------------------------------------------------
-- 6. METAS — incluye libertad financiera (FIRE) e inversión
-- ---------------------------------------------------------------------------
CREATE TABLE goals (
    id           TEXT PRIMARY KEY,
    member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    goal_type    TEXT NOT NULL CHECK (goal_type IN
                   ('savings','freedom','investment','debt')),
    target       NUMERIC(14,2) NOT NULL CHECK (target > 0),
    current      NUMERIC(14,2) NOT NULL DEFAULT 0,
    due_date     DATE,
    account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 7. SUPUESTOS MACRO — parámetros del motor (editables / actualizables por año)
-- ---------------------------------------------------------------------------
CREATE TABLE assumptions (
    id              TEXT PRIMARY KEY DEFAULT 'global',
    inflation_rate  NUMERIC(6,4) NOT NULL DEFAULT 0.045,  -- 4.5% MX
    market_return   NUMERIC(6,4) NOT NULL DEFAULT 0.09,   -- nominal anual
    safe_withdrawal NUMERIC(6,4) NOT NULL DEFAULT 0.04,   -- regla del 4%
    tax_year        INT NOT NULL DEFAULT 2026
);

-- ============================================================================
--  VISTAS — CONSOLIDACIÓN EN TIEMPO REAL, REDUNDANCIA CERO
-- ============================================================================

-- Saldo vivo de cada cuenta (deriva de transacciones; nunca se almacena).
CREATE VIEW v_account_balance AS
SELECT a.id, a.member_id, a.account_class, a.include_in_net,
       a.opening_balance
     + COALESCE(SUM(CASE
         WHEN t.account_id = a.id AND t.kind IN ('income','debt_draw','receivable_in') THEN  t.amount
         WHEN t.account_id = a.id AND t.kind IN ('expense','saving','transfer','debt_payment') THEN -t.amount
         WHEN t.dest_account_id = a.id AND t.kind IN ('transfer','saving','debt_draw') THEN  t.amount
         WHEN t.dest_account_id = a.id AND t.kind = 'debt_payment' THEN -t.amount
         ELSE 0 END), 0) AS balance
FROM accounts a
LEFT JOIN transactions t
       ON (t.account_id = a.id OR t.dest_account_id = a.id)
GROUP BY a.id;

-- Patrimonio neto por integrante, con la separación dura capital/crédito.
CREATE VIEW v_net_worth AS
SELECT b.member_id,
       SUM(CASE WHEN b.account_class IN ('LIQUID','RECEIVABLE') THEN b.balance ELSE 0 END) AS assets,
       SUM(CASE WHEN b.account_class IN ('DEBT','CREDIT_LINE')  THEN b.balance ELSE 0 END) AS liabilities,
       -- Capital líquido REAL: excluye por completo líneas de crédito y cuentas por cobrar.
       SUM(CASE WHEN b.account_class = 'LIQUID' THEN b.balance ELSE 0 END) AS liquid_capital,
       SUM(CASE WHEN b.account_class IN ('LIQUID','RECEIVABLE') THEN b.balance ELSE 0 END)
     - SUM(CASE WHEN b.account_class IN ('DEBT','CREDIT_LINE')  THEN b.balance ELSE 0 END) AS net_worth
FROM v_account_balance b
WHERE b.include_in_net
GROUP BY b.member_id;

-- Consolidación familiar = suma de integrantes que consolidan (kind='person').
CREATE VIEW v_household_net_worth AS
SELECT SUM(n.liquid_capital) AS liquid_capital,
       SUM(n.assets)         AS assets,
       SUM(n.liabilities)    AS liabilities,
       SUM(n.net_worth)      AS net_worth
FROM v_net_worth n
JOIN members m ON m.id = n.member_id
WHERE m.consolidates AND m.kind = 'person';
