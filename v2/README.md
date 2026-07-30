# Finanzas · Patrimonio Familiar (V2)

App de finanzas familiares y patrimoniales **offline-first**, privada y sin servidor:
todos los datos viven en el dispositivo (localStorage). Motor financiero real
(interés compuesto, KPIs, deuda, fiscal), interfaz premium e instalable como PWA.

- **Modo Simple** (`premium.html`) — dashboard ejecutivo con KPIs, gráficas y presupuesto.
- **Modo Avanzado** (`index.html`) — gestión completa: movimientos, cuentas, rubros,
  presupuesto, deuda, proyección, fiscal, negocio e import/export Excel.
- Se alterna entre ambos con el control **Simple · Avanzado** de la cabecera; comparten
  tema (claro/oscuro) y módulo seleccionado.

> Arquitectura y decisiones técnicas: ver [ARQUITECTURA.md](ARQUITECTURA.md) y `schema.sql`.

---

## Cómo usarla

### En local
Los módulos ES requieren `http://` (no `file://`). Con Node instalado:

```bash
cd v2
node serve.js 8080
```

Abre **http://localhost:8080/v2/premium.html** (o `index.html`).

> Si sirves la carpeta `v2` como raíz, la ruta es `http://localhost:8080/premium.html`.

### Primer uso
- La primera vez se siembra un módulo de ejemplo. Crea los tuyos con **+ Módulo**
  (persona, familia/hogar o negocio); cada módulo lleva balances independientes.
- Registra cuentas y movimientos en **Modo Avanzado**; el dashboard se actualiza solo.

### Migrar desde la V1
Abre **`/v2/migrate.html`**: lee el `localStorage` de la V1 o un respaldo JSON,
muestra una vista previa (reclasifica líneas de crédito) y escribe los datos V2.

### Respaldo / Excel
En **Modo Avanzado → Datos**: exporta/importa Excel (.xlsx) por módulo o todos,
y respaldo/restauración en JSON.

---

## Instalar como app (PWA)

Tras abrirla una vez queda cacheada y **funciona sin internet**.

- **Chrome / Edge (PC y Android):** ícono *Instalar* en la barra de direcciones.
- **iOS Safari:** Compartir → *Añadir a pantalla de inicio*.

---

## Publicar en internet (Vercel)

El deploy publica solo el **código**; los datos siguen en cada dispositivo.
Ejecuta **dentro de la carpeta `v2`** (Vercel la toma como raíz):

```bash
cd v2
npx vercel          # 1ª vez: login + preview
npx vercel --prod   # producción (URL pública)
```

- En *"In which directory is your code located?"* deja **`./`**.
- Sin paso de build (sitio estático); `vercel.json` ya está configurado
  (`/` → `premium.html`, cabeceras de seguridad y caché del Service Worker).

**Sin CLI:** sube a GitHub → vercel.com → *Add New Project* → *Import* →
**Root Directory = `finanzas-docente/v2`** → *Deploy*.

---

## Desarrollo

100 % offline: todos los vendors están en `vendor/` (Inter, Lucide, Chart.js, xlsx) —
cero peticiones externas.

El CSS premium (`premium.css`) está **precompilado** con Tailwind. Si editas clases
en `premium.html` o `src/app/premium.js`, recompílalo:

```bash
npm install     # una vez (instala tailwindcss)
npm run css     # regenera premium.css   (o: npm run css:watch)
```

> `index.html` no usa Tailwind: su estilo premium es CSS propio en `<style>`.

### Estructura

```
v2/
├── premium.html / index.html / migrate.html   Pantallas (Simple / Avanzado / Migración)
├── premium.css · vendor/ · icon.svg            Estilos y assets locales
├── sw.js · manifest.json · vercel.json         PWA + deploy
├── schema.sql · ARQUITECTURA.md                Modelo de datos y diseño
└── src/
    ├── core/   engine · debt · tax · business  Motor financiero (puro, sin DOM)
    ├── data/   repository · excel · migrate     Persistencia e intercambio
    └── app/    main · premium                    Controladores de UI
```

El `Repository` (`src/data/repository.js`) abstrae el almacenamiento: hoy
`localStorage`, mañana IndexedDB o Supabase sin tocar el dominio ni la UI.
`schema.sql` es el contrato canónico (compatible PostgreSQL/Supabase).

---

## Privacidad

Sin backend, sin cuentas, sin telemetría. Los datos financieros **nunca salen
del navegador**. Un respaldo JSON/Excel solo queda donde tú lo descargues.

Licencia: MIT.
