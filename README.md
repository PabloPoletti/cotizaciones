# Cotizaciones ONs, Soberanos y Provinciales (ARS/USD)

Panel estático de **59 instrumentos** del mercado argentino (ONs corporativas, soberanos USD/ARS, provinciales, BCRA y CEDEAR), con precios principales de [BYMA Open Data](https://www.byma.com.ar/) vía [PyOBD](https://github.com/franco-lamas/PyOBD), respaldo [Data912](https://data912.com), tipo de cambio [DolarAPI](https://dolarapi.com), actualización automática con GitHub Actions y despliegue en GitHub Pages.

**Panel en vivo:** [pablopoletti.github.io/cotizaciones](https://pablopoletti.github.io/cotizaciones/)  
**Repositorio:** [github.com/PabloPoletti/cotizaciones](https://github.com/PabloPoletti/cotizaciones)

---

## Estructura del proyecto

```
cotizaciones/
├── .github/workflows/
│   ├── actualizar.yml              # Cron + manual: cotizaciones + histórico incremental
│   ├── bootstrap_historico.yml     # Manual una vez: carga ~90 días OHLCV
│   └── tests.yml                   # Push/PR: test_calculos + integridad universo
├── docs/                           # Raíz GitHub Pages
│   ├── index.html                  # Dashboard (5 pestañas)
│   ├── css/styles.css
│   ├── js/
│   │   ├── config.js               # URL Worker, cooldown 5 min (público)
│   │   ├── core.js                 # Carga JSON, TIR mercado, filtros
│   │   ├── historico.js            # historico_precios.json, liquidez relativa
│   │   ├── analytics.js            # KPIs, presets cartera, observaciones
│   │   ├── charts.js               # Gráficos Chart.js
│   │   ├── storage.js              # localStorage (cartera)
│   │   ├── ficha.js                  # Ficha detallada por instrumento
│   │   └── app.js                  # UI, pestañas, dispatch Worker/token
│   └── data/
│       ├── info_fija.json          # Fuente única de tickers + metadatos (manual)
│       ├── cotizaciones.json       # Generado: precios BYMA + tipo_cambio + backup Data912
│       ├── historico_precios.json  # Generado: OHLCV ~90d + métricas
│       ├── historico.json          # Legacy vacío (no usado por el panel)
│       └── instrumentos_pendientes.json  # Tickers fuera del panel / re-verificar
├── workers/dispatch/               # Cloudflare Worker (dispatch sin PAT)
│   ├── index.js
│   ├── wrangler.toml
│   └── README.md
├── scripts/
│   ├── fetch_cotizaciones.py       # BYMA + DolarAPI + Data912 → cotizaciones.json
│   ├── providers/
│   │   ├── dolarapi.py             # Tipo de cambio oficial y MEP
│   │   └── data912.py              # Precios backup (arg_bonds + arg_corp)
│   ├── probar_dolarapi.py          # Prueba manual DolarAPI
│   ├── probar_data912.py           # Prueba manual Data912
│   ├── historico_precios.py        # Lógica OHLCV + métricas
│   ├── bootstrap_historico.py      # CLI bootstrap
│   ├── actualizar_historico.py     # CLI incremental
│   ├── verify_tickers.py           # Verificación PyOBD por fases
│   ├── verify_panel.mjs            # Playwright: panel completo
│   ├── verify_prod_deploy.mjs      # Playwright: prod + config
│   ├── verify_worker_dispatch.mjs  # Playwright: dispatch Worker end-to-end
│   ├── review_local.mjs            # Capturas responsive local
│   └── capture_phases.mjs          # Capturas por pestaña
├── requirements.txt
└── README.md
```

---

## Panel web — 5 pestañas

| Pestaña | Contenido |
|---------|-----------|
| **Cotizaciones** | Cards o tabla de 59 instrumentos; filtros de **dos niveles** (tipo → sector / provincia / ley); badges de liquidez; badge **✓ 2 fuentes** cuando BYMA y Data912 coinciden (±2%); semáforo TIR vs sector; var. 7d/30d y volatilidad desde histórico BYMA. |
| **Análisis** | TIR referencia por ticker, curva TIR vs plazo, composición por sector, evolución de precio ~90d (BYMA), drawdown desde máximo de la ventana. |
| **Resumen** | KPIs por moneda, conversión ARS→USD ref. (MEP) para Lecaps/Boncer, mejor TIR efectiva por sector, próximos vencimientos y cupones estimados. |
| **Calculadora** | Cartera con pesos, TIR ponderada, proyección compuesta, presets ilustrativos; persistencia en localStorage. |
| **Observaciones** | Reglas automáticas (TIR por sector, liquidez, alertas TIR alta + baja liquidez, volatilidad reciente) con descargo legal — no es asesoramiento. |

---

## Instrumentos monitoreados (59)

Fuente única: `docs/data/info_fija.json` (`categoria`, `moneda`, `sector`). El script Python lee esa lista; no hay tickers hardcodeados en el fetch.

| Categoría | Cant. | Tickers |
|-----------|------:|---------|
| **ON corporativa** | 25 | DNC7O, DNCAO, GN49O, IRCFO, IRCPO, PN35O, PNDCO, PNECO, PNICO, PNRCO, RAC5O, RUCDO, TLCFO, TLCMO, TLCPO, TLCTO, TSC3O, TSC4O, TTC9O, TTCDO, YFCJO, YM39O, YM42O, YMCIO, YMCXO |
| **Soberano USD** | 10 | AL29, AL30, AL35, AL41, GD29, GD30, GD35, GD38, GD41, GD46 |
| **Soberano ARS** | 12 | DICP, S17L6, S30N6, S30O6, S31G6, S31L6, T30J6, TVPP, TX26, TX28, TZX26, TZXD6 |
| **Provincial** | 8 | BA37D, BACAD, BACAO, CO26D, CO27D, NDT5D, PM29D, SA24D |
| **BCRA** | 3 | BPO27, BPO28, BPOD7 |
| **CEDEAR** | 1 | SPYD |

### Emisores corporativos y provinciales cubiertos

| Emisor / jurisdicción | Series en panel |
|------------------------|-----------------|
| **YPF** | YMCIO, YMCXO, YM39O, YM42O |
| **Pan American Energy** | PN35O, PNDCO, PNICO, PNECO, PNRCO |
| **YPF Luz** | YFCJO |
| **Tecpetrol** | TTC9O, TTCDO |
| **Genneia** | GN49O |
| **TGS** | TSC3O, TSC4O |
| **Edenor** | DNC7O, DNCAO |
| **Telecom** | TLCMO, TLCFO, TLCPO, TLCTO |
| **IRSA** | IRCFO, IRCPO |
| **Raghsa** | RAC5O |
| **MSU Energy** | RUCDO |
| **Córdoba** | CO26D, CO27D |
| **Mendoza** | PM29D |
| **Salta** | SA24D |
| **Neuquén** | NDT5D |
| **Buenos Aires (prov.)** | BA37D |
| **CABA** | BACAD, BACAO |
| **Soberanos / BCRA / CEDEAR** | AL/GD, Lecaps/Boncer/TVPP/DICP, BPO/BPOD7, SPYD |

**Excluidos:** `YMCUO` (no expuesto en BYMA Open Data gratuito). Municipales sin liquidez verificable: ver `instrumentos_pendientes.json`.

Verificación PyOBD: `python scripts/verify_tickers.py --fase all --json docs/data/verify_instrumentos.json`

---

## Workflows GitHub Actions

### `actualizar.yml` — cotizaciones + histórico incremental

| Aspecto | Detalle |
|---------|---------|
| **Cron** | Lun–vie, ventana UTC 13:30–21:00 (≈11:00–17:30 ART + margen), cada 30 min |
| **Manual** | Actions → Run workflow, o botón **Actualizar ahora** del panel |
| **Filtro horario** | Cron solo corre el job si mercado abierto (lun–vie 11:00–17:30 ART); `workflow_dispatch` ignora el filtro |
| **Scripts** | `fetch_cotizaciones.py` (precios) + `actualizar_historico.py` al final del fetch (incremental) |
| **Commit** | `cotizaciones.json` y `historico_precios.json` si difieren de HEAD |

#### Protección de concurrencia (push seguro)

Varias corridas simultáneas (p. ej. doble clic) no deben competir por el mismo push:

```yaml
concurrency:
  group: cotizaciones-actualizar
  cancel-in-progress: false   # encola; no cancela una corrida a mitad de camino
```

En el job, además:

1. **`git pull --rebase origin main`** antes de ejecutar el script Python (HEAD actualizado para corridas encoladas).
2. **Skip de commit** si los JSON de datos del fetch son idénticos a HEAD (`cotizaciones.json`, `historico_precios.json`, `mep_historico.json`).
3. **`git add`** de esos tres archivos, **commit** y **push** sin pull intermedio (evita unstaged si el fetch tocó `mep_historico.json`). Si el push falla, **un reintento** de pull + push.

### `bootstrap_historico.yml` — carga inicial OHLCV (una vez)

- Solo `workflow_dispatch` (sin cron).
- ~90 días × 59 tickers vía `get_daily_history` — **15–25 min**.
- Commitea solo `historico_precios.json`.
- El cron posterior **no** vuelve a traer 90 días; solo mergea los últimos ~5 días por corrida.

---

## Actualizar desde el panel — Cloudflare Worker (principal)

El botón **Actualizar ahora** usa por defecto un **Cloudflare Worker** que guarda el PAT de GitHub como secret del servidor. Ningún visitante necesita token en el dispositivo.

| Parámetro | Valor |
|-----------|-------|
| **URL Worker (prod)** | `https://cotizaciones-dispatch.lic-poletti.workers.dev/dispatch` |
| **Config en repo** | `docs/js/config.js` → `DISPATCH_WORKER_URL` |
| **Rate limit** | 1 dispatch exitoso cada **300 s** (KV en Cloudflare) |
| **Cooldown panel** | `DISPATCH_COOLDOWN_MS = 300000` (5 min, alineado al Worker) |

Deploy y secrets: `workers/dispatch/README.md` (`wrangler login`, `wrangler secret put GITHUB_TOKEN`, `wrangler deploy`).

### Fallback — token local (Opciones avanzadas)

Si `DISPATCH_WORKER_URL` está vacío o falla la red al Worker, el panel puede usar un **GitHub PAT** guardado en **localStorage** (solo ese navegador/dispositivo). UI colapsada en **Opciones avanzadas — token GitHub local (fallback)**.

**Classic PAT:** scope **`workflow`** obligatorio.  
**Fine-grained:** **Actions: Read and write** en `PabloPoletti/cotizaciones`.

Errores frecuentes:

| Síntoma | Causa |
|---------|--------|
| 403 *Resource not accessible…* | PAT sin permiso workflow / Actions |
| 429 desde Worker | Menos de 5 min desde el último dispatch exitoso |
| Token OK pero sin Worker | Fallback activo; configurar URL en `config.js` |

---

## Histórico de precios (`historico_precios.json`)

| Campo / métrica | Origen |
|-----------------|--------|
| Serie OHLCV ~90d | PyOBD `get_daily_history` |
| Volumen promedio (25 días hábiles) | Calculado en Python → badge liquidez en panel |
| Var. 7d / 30d, volatilidad 30d, drawdown | Calculados al guardar; mostrados en cards y Análisis |

**Bootstrap:** Actions → **Bootstrap histórico precios** → Run workflow (`dias`: 90).  
**Incremental:** cada corrida de `actualizar.yml` agrega/actualiza solo los últimos días.

---

## Fuentes de datos

| Dato | Fuente principal | Complementaria |
|------|------------------|----------------|
| Precios, variación, histórico BYMA | [BYMA Open Data](https://www.byma.com.ar/) vía [PyOBD](https://github.com/franco-lamas/PyOBD) | **[Data912](https://data912.com)** — `precio_backup` vía `/live/arg_bonds` + `/live/arg_corp` (2 req/corrida) |
| Vencimiento, cupón, TIR ref., sector | `docs/data/info_fija.json` (manual + prospectos) | Ficha técnica BYMA (`get_equity_profile`) en scripts de descubrimiento |
| **Tipo de cambio ARS/USD** | — | **[DolarAPI](https://dolarapi.com)** — dólar oficial y MEP (`/v1/dolares/oficial`, `/v1/dolares/bolsa`) |

El tipo de cambio se guarda en `cotizaciones.json` bajo `tipo_cambio` con `timestamp_consulta` propio. **No reemplaza** precios BYMA ni convierte automáticamente TIR entre monedas: el panel filtra por `moneda` en `info_fija.json`. Los precios BYMA de bonos/ONs usan escala `/1000` (convención BYMA), no un FX hardcodeado.

Si DolarAPI falla, el fetch BYMA continúa igual que antes.

Data912 se consulta **una vez por corrida** (paneles completos `arg_bonds` + `arg_corp`); el precio mostrado sigue siendo BYMA. Cada instrumento puede incluir `precio_backup` y `fuentes_consultadas: ["byma", "data912"]` en `cotizaciones.json`.

En la UI, si BYMA y Data912 coinciden dentro de **±2%** (`MARGEN_CONFIRMACION_PRECIO` en `core.js`), aparece el badge sutil **✓ 2 fuentes** en cards y ficha. Si no hay coincidencia o Data912 no tiene el ticker, no se muestra nada (sin alertas negativas).

---

## Datos fijos (`info_fija.json`)

Complementa cotizaciones con vencimiento, cupón, amortización, sector, ley y **TIR de referencia** (aprox. jun 2026). El panel calcula **TIR mercado (aprox.)** en el navegador desde el precio BYMA (`core.js`, bisección bullet; amortización parcial usa referencia).

---

## Probar en local

```bash
git clone https://github.com/PabloPoletti/cotizaciones.git
cd cotizaciones
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS
pip install -r requirements.txt
python scripts/fetch_cotizaciones.py
cd docs && python -m http.server 8080
```

Verificación Playwright local: `node scripts/verify_panel.mjs`  
Verificación producción (59 inst., filtros 2 niveles, DolarAPI, badge): `node scripts/verify_prod_deploy.mjs`

### Tests automatizados (CI)

```bash
node scripts/run_tests.mjs
```

Ejecuta `test_calculos.mjs` (TIR, duración, cupones) e `test_integridad_universo.mjs` (alineación `info_fija` ↔ `cotizaciones.json` ↔ `data912.tickers_solicitados`). GitHub Actions workflow `.github/workflows/tests.yml` corre la suite en cada push/PR a `main`.

**Branch protection en `main` (activo):** el merge exige el required status check **Tests / test** (strict mode: la rama debe estar al día con `main`). Configurado en GitHub → **Settings → Branches → Branch protection rules**.

### Esquema de colores (gráficos)

Documentado en `docs/js/core.js` (`COLORES_GRUPO_TIR`, `COLORES_SECTOR`, `PALETA_CARTERA`):

| Paleta | Uso |
|--------|-----|
| **COLORES_GRUPO_TIR** | Análisis TIR (barras, scatter): grupo comparable (USD nominal, ARS nominal, CER, dollar-linked) |
| **COLORES_SECTOR** | Composición por sector, cards agrupadas |
| **PALETA_CARTERA** | Pie de la calculadora: colores neutros por ticker, sin significado de grupo/sector |

---

## Advertencia legal

Datos BYMA Open Data con **difusión diferida** — no tiempo real exacto. Panel **informativo**; no es asesoramiento financiero ni recomendación de inversión.

---

## Licencia

Código del panel: uso libre. PyOBD: [GPLv3](https://github.com/franco-lamas/PyOBD).
