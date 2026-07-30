# Finanzas V2.0 — Arquitectura

Refactorización completa de la app de finanzas familiares y patrimoniales.
Toma la lógica conceptual de la V1 y la reconstruye sobre los hallazgos de auditoría.

## Decisiones de arquitectura (CTO)

| Decisión | Elección | Por qué |
|---|---|---|
| **Lenguaje** | JavaScript (ES Modules), sin framework | Cero dependencias de build; funciona como PWA offline en el celular, igual que la V1, sin curva de migración. |
| **Persistencia** | Offline-first (localStorage hoy → IndexedDB / Supabase mañana) vía patrón Repository | Los datos financieros familiares **no salen del dispositivo** por defecto: privacidad y costo cero. El `schema.sql` es el contrato; si algún día se quiere multi-dispositivo, se sustituye solo la capa `data/`. |
| **Modelo de datos** | Relacional normalizado (3NF), consolidación por **vistas** | Redundancia cero: el balance familiar se *calcula*, nunca se *duplica*. |
| **Cálculo** | Motor puro y testeable (`core/`), sin DOM | La lógica financiera se prueba aislada; la UI solo pinta resultados. |

## Estructura

```
v2/
├── schema.sql                 Esquema canónico (Postgres/Supabase compatible)
├── index.html                 Shell minimalista ejecutivo + panel KPI + semáforo
├── migrate.html               Asistente de migración V1 → V2 (3 pasos)
└── src/
    ├── core/
    │   ├── engine.js          Saldos, patrimonio, KPIs, proyección compuesta+inflación
    │   ├── debt.js            Desafío Deuda Cero (avalancha / bola de nieve)
    │   ├── tax.js             Optimización fiscal (ISR MX, deducibles, devolución)
    │   └── business.js        Acelerador Farmasi (punto de equilibrio, 50/50)
    ├── data/
    │   ├── repository.js      Capa de datos offline-first (implementa el contrato SQL)
    │   └── migrate.js         Conversión pura V1 → V2 (clasificación de cuentas)
    └── app/
        └── main.js            Controlador UI: datos → motor → DOM
```

## Migración desde la V1

Abrir `migrate.html` (servido por http). El asistente:
1. **Origen:** lee `localStorage` de la V1 (`finanzas_app_v6`) o un respaldo JSON.
2. **Vista previa:** muestra cuántas cuentas/transacciones migra y **cuántas líneas de crédito reclasifica**, con advertencias de tasas a verificar.
3. **Aplicar:** descarga respaldo de la V1 y escribe los datos V2.

Mapeo de cuentas: `cash/checking/savings/investment → LIQUID`, `credit → CREDIT_LINE`,
`debt → DEBT`, `loan → RECEIVABLE`. Mapeo contable: `debt → debt_draw`; transferencia
hacia un pasivo → `debt_payment` (corrige el signo de la V1).

> **La V2 corrige dos bugs contables de la V1** y por eso algunos saldos cambian
> *para bien*: (a) la línea de crédito ya no suma como activo; (b) la V1 restaba
> dos veces el origen de un `loan_payment`. Conviene revisar saldos tras migrar.

## Cómo cada hallazgo de auditoría queda resuelto

### 1. Clasificación de deuda contaminada (V1 sumaba disposiciones como ingreso)
- **`account_class` inmutable** con 4 clases: `LIQUID`, `RECEIVABLE`, `DEBT`, `CREDIT_LINE`.
- En `engine.netWorth()` el **Capital Líquido Disponible** suma *exclusivamente* cuentas `LIQUID`. Una `CREDIT_LINE` solo puede figurar como pasivo — es imposible por construcción que cuente como activo o ahorro.
- `transactions.kind` distingue `debt_draw` (disponer crédito: aumenta líquido **y** el pasivo, no es ingreso) de `income`. Constraints `CHECK` en el esquema lo blindan.

### 2. Proyecciones lineales → motor financiero real
- `engine.projectNetWorth()` usa **interés compuesto mensual** y entrega valor **nominal y real** (deflactado por inflación) a **1, 3 y 5 años**.
- `engine.yearsToFreedom()` resuelve la ecuación de valor futuro de forma **cerrada** (no la aproximación lineal de la V1).
- Inflación, rendimiento y SWR viven en `assumptions`, editables y actualizables por año.

### 3. Fricción de captura → presupuesto base
- `budget_base` guarda el monto recurrente **una sola vez**; `budget_override` solo almacena las **desviaciones** del periodo.
- `engine.resolveBudget()` reconstruye el presupuesto efectivo: base + overrides.

## Panel KPI ejecutivo (definiciones)

| KPI | Fórmula | Semáforo |
|---|---|---|
| **Margen Neto Post-Deuda** | (Ingresos − Gastos − Servicio de deuda) / Ingresos | 🔴 <0 · 🟡 <15% · 🟢 ≥15% |
| **Índice de Liquidez Corriente** | Capital líquido / Pasivo inmediato (mínimos ≤30d) | 🔴 <1 · 🟡 <1.5 · 🟢 ≥1.5 |
| **Días de Autonomía Financiera** | Capital líquido / (gasto diario) | 🔴 <30 · 🟡 <90 · 🟢 ≥90 |

El semáforo (`engine.semaphore()`) se aplica a las celdas de balance mensual:
**Verde** estable · **Amarillo** estrés de flujo (<15%) · **Rojo** déficit o apalancamiento crítico.

## Módulos avanzados

- **Deuda Cero** (`debt.js`): `compareStrategies()` simula avalancha vs. bola de nieve mes a mes (incluye reciclaje del mínimo liberado) y recomienda la de menor interés.
- **Optimización Fiscal** (`tax.js`): etiqueta deducibles (`medical`, `ppr`, `tuition`…), aplica los topes legales (5 UMA / 15%, y PPR 5 UMA / 10%) y estima la devolución de ISR. ⚠️ Actualizar UMA y tarifa cada enero.
- **Acelerador Farmasi** (`business.js`): punto de equilibrio operativo, margen de seguridad y regla de reinversión 50/50 hacia el fondo de emergencia. Se mantiene **separado** del flujo familiar (`members.kind = 'business'`, `consolidates = false`).

## Interfaz premium (fintech)

`premium.html` es la pantalla de presentación con lenguaje visual estilo Revolut/Wealthfront
(Tailwind + Lucide + Chart.js): KPI cards con sparklines, gráfica de área con gradiente,
dona de bordes redondeados, modo claro/oscuro (glassmorphism), y las vistas Deuda Cero,
Proyección, Fiscal y Negocio. Reutiliza el mismo dominio (`engine`, `debt`, `tax`, `business`).
La gestión completa (CRUD, Excel, módulos) vive en `index.html`; se navega entre ambas.

**Una sola app, dos modos:** ambas pantallas comparten el lenguaje visual, el **tema**
(claro/oscuro, clave `fz_theme`) y el **módulo seleccionado** (clave `fz_member`). Un control
segmentado **Simple · Avanzado** en la cabecera de cada una alterna entre la vista premium
(`premium.html`) y la gestión completa (`index.html`) sin perder contexto.

**100 % offline + PWA instalable:** todos los vendors son locales en `vendor/` (Inter, Lucide,
Chart.js, xlsx) — cero peticiones externas. `sw.js` (service worker) precachea el shell, los
módulos y los vendors con rutas **relativas** (funciona en raíz `/` o en `/v2/`); `manifest.json`
+ `icon.svg` la hacen instalable. Tras la primera carga, abre sin conexión. La gestión
(`index.html`) usa CSS propio; la premium usa `premium.css`.

**El CSS premium está precompilado** (`premium.css`, ~17 KB) — sin dependencia del CDN de Tailwind.
Si editas clases en `premium.html` o `premium.js`, recompila:

```bash
npm install      # una vez (instala tailwindcss)
npm run css      # regenera premium.css
# o en vivo:  npm run css:watch
```

## Cómo correrlo

Servir la carpeta `v2/` (los ES Modules requieren http, no `file://`):

```bash
cd v2 && python -m http.server 8080   # luego abrir http://localhost:8080
```

La primera vez se siembra un ejemplo (Dra. Álvarez) para ver el tablero vivo.
