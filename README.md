# Cotizaciones ONs & Soberanos (USD)

Panel estático de cotizaciones de **Obligaciones Negociables** y **bonos soberanos argentinos en dólares**, con actualización automática vía GitHub Actions y datos de [BYMA Open Data](https://www.byma.com.ar/) usando la librería [PyOBD](https://github.com/franco-lamas/PyOBD).

Repositorio: [github.com/PabloPoletti/cotizaciones](https://github.com/PabloPoletti/cotizaciones)

---

## Estructura del proyecto

```
cotizaciones/
├── .github/
│   └── workflows/
│       ├── bootstrap_historico.yml  # Bootstrap manual ~90 días (una vez)
│       └── actualizar.yml           # Cron + manual, cotizaciones + histórico incremental
├── docs/                       # Raíz de GitHub Pages
│   ├── index.html              # Dashboard (5 pestañas)
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── config.js             # URL Worker, cooldown 5 min
│   │   ├── historico.js          # historico_precios.json, liquidez relativa
│   │   ├── app.js                # UI, filtros, dispatch Worker/token
│   │   ├── core.js             # Carga de datos, TIR mercado
│   │   ├── analytics.js        # KPIs, presets, observaciones
│   │   ├── charts.js           # Gráficos Chart.js
│   │   └── storage.js          # localStorage (cartera, histórico local)
│   └── data/
│       ├── cotizaciones.json   # Generado por el script (actualizado por Actions)
│       ├── historico_precios.json  # OHLCV ~90d + métricas (bootstrap + incremental)
│       ├── info_fija.json      # TIR, vencimiento, cupón, amortización (manual)
│       └── historico.json      # Reservado (legacy)
├── workers/
│   └── dispatch/               # Cloudflare Worker (dispatch sin PAT en navegador)
├── scripts/
│   ├── fetch_cotizaciones.py   # Consulta BYMA y escribe cotizaciones.json
│   ├── historico_precios.py      # Lógica histórico OHLCV + métricas
│   ├── bootstrap_historico.py    # Carga inicial ~90 días (manual)
│   ├── actualizar_historico.py   # Incremental (últimos días)
│   ├── verify_panel.mjs        # Verificación Playwright (prod/local)
│   └── capture_phases.mjs      # Capturas por pestaña
├── requirements.txt
├── README.md
└── .gitignore
```

---

## Activar GitHub Pages

1. Subí este repositorio a GitHub (rama `main`).
2. Andá a **Settings → Pages**.
3. En **Build and deployment → Source**, elegí **Deploy from a branch**.
4. Seleccioná la rama **main** y la carpeta **`/docs`**.
5. Guardá. En unos minutos el sitio estará en:
   `https://pablopoletti.github.io/cotizaciones/`

---

## Workflow automático

El archivo `.github/workflows/actualizar.yml`:

| Aspecto | Detalle |
|---------|---------|
| **Frecuencia** | Cada 30 min, lun–vie, ventana UTC 13:30–21:00 (≈11:00–17:30 ART + margen) |
| **Manual** | Botón **Run workflow** en Actions, o desde el panel web |
| **Horario** | Filtro final lun–vie 11:00–17:30 ART en el job; manual ignora este filtro |
| **Qué hace** | Cotizaciones BYMA + histórico incremental; commitea `cotizaciones.json` y `historico_precios.json` |

### Bootstrap histórico (una vez, manual)

Workflow **Bootstrap histórico precios** (`.github/workflows/bootstrap_historico.yml`):

- Solo `workflow_dispatch` — **no** tiene cron.
- Carga ~90 días × 47 tickers vía PyOBD (`get_daily_history`).
- Duración estimada: **15–25 minutos**.
- Después de mergear, disparalo desde **Actions → Bootstrap histórico precios → Run workflow** (input `dias`: 90 por defecto).

El cron normal solo **agrega/actualiza los últimos días**; no vuelve a traer 90 días cada 30 min.

### Permisos

El workflow usa `GITHUB_TOKEN` con permiso `contents: write` para hacer push del JSON. No necesitás secrets adicionales para la actualización automática.

### Disparo manual desde la web

**Método principal:** Cloudflare Worker (`workers/dispatch/`) — el panel llama `POST /dispatch` sin token en el navegador. Ver `workers/dispatch/README.md` para deploy con Wrangler.

**Fallback:** token GitHub en **Opciones avanzadas** del panel (localStorage por dispositivo).

Cooldown unificado: **5 minutos** (panel `DISPATCH_COOLDOWN_MS` = 300000 y Worker `RATE_LIMIT_SECONDS` = 300).

#### Token local (fallback avanzado)

El error más frecuente es un **403** con mensaje tipo *"Resource not accessible by personal access token"*: el token autentica pero **no tiene permiso para Actions/workflows**. Elegí **una** de estas dos opciones:

---

##### Opción A — Token **classic** (más simple)

1. Abrí [GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens?type=beta).
2. Clic en **Generate new token (classic)**.
3. **Note:** `cotizaciones-panel` (o el nombre que prefieras).
4. **Expiration:** la que quieras (recordá renovarlo antes de que venza).
5. En **Select scopes**, marcá **obligatoriamente**:
   - **`workflow`** — *Update GitHub Action workflows* (sin esto, `workflow_dispatch` devuelve 403).
6. Para repos **privados**, también marcá **`repo`**. En repos **públicos** como este, `workflow` suele alcanzar; si falla el acceso al repo, agregá **`public_repo`**.
7. **Generate token**, copiá el valor (`ghp_…`) y pegalo en el panel → **Guardar configuración** → **Probar token**.

| Scope classic | ¿Para qué? |
|---------------|------------|
| **`workflow`** | **Obligatorio** — disparar y gestionar workflows vía API |
| `public_repo` | Opcional en repo público si el GET al repo falla |
| `repo` | Solo si el repositorio es privado |

---

##### Opción B — Token **fine-grained**

1. Abrí [GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens).
2. **Generate new token**.
3. **Token name:** `cotizaciones-panel`.
4. **Resource owner:** tu usuario (`PabloPoletti`).
5. **Repository access:** **Only select repositories** → elegí **`cotizaciones`**.
6. **Repository permissions** (mínimo):
   - **Actions:** **Read and write** (obligatorio para `workflow_dispatch`).
   - **Metadata:** Read-only (viene por defecto).
7. Generá el token (`github_pat_…`), pegalo en el panel y probalo.

| Permiso fine-grained | Valor mínimo |
|----------------------|--------------|
| **Actions** | **Read and write** |
| Metadata | Read-only (automático) |

---

#### Configuración en el panel

1. Desplegá **Configuración — token para "Actualizar ahora"**.
2. **Repositorio:** exactamente `PabloPoletti/cotizaciones` (sin `https://`, sin `.git`, sin espacios).
3. **Token:** el PAT generado arriba.
4. **Guardar configuración** (persiste en localStorage).
5. **Probar token** — debe decir *Token OK…*. Si falla, el mensaje indica la causa (token expirado, repo incorrecto, permisos Actions, etc.).
6. **Actualizar ahora** — si la prueba pasó, dispara el workflow; éxito = HTTP 204 y mensaje *Workflow iniciado*. Tras un dispatch exitoso el botón queda deshabilitado **5 minutos** (alineado con el rate limit del Worker).

#### Errores frecuentes

| Síntoma | Causa probable |
|---------|----------------|
| 403 *Resource not accessible by personal access token* | Classic sin scope **`workflow`**, o fine-grained sin **Actions: Read and write** en `cotizaciones` |
| 401 *Bad credentials* | Token revocado, mal copiado o expirado |
| 404 en repo | Nombre mal escrito o token sin acceso a ese repo |
| Token OK pero dispatch falla | Nombre de workflow distinto de `actualizar.yml` (no debería ocurrir en este repo) |

#### Referencia visual (GitHub UI)

La interfaz de GitHub cambia con el tiempo; los enlaces de arriba llevan directo a la pantalla correcta. Al generar un token classic, la lista de scopes incluye **`workflow`** con la descripción *Update GitHub Action workflows* — debe quedar **marcado**. En fine-grained, en *Repository permissions → Actions*, elegí **Read and write** (no solo Read).

---

## Probar el script en local

Requisitos: Python 3.10+ (por `zoneinfo`).

```bash
# Clonar el repo
git clone https://github.com/PabloPoletti/cotizaciones.git
cd cotizaciones

# Entorno virtual (recomendado)
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# Dependencias
pip install -r requirements.txt

# Ejecutar consulta
python scripts/fetch_cotizaciones.py
```

El resultado se guarda en `docs/data/cotizaciones.json`. Abrí `docs/index.html` en un servidor local para probar la página (o usá GitHub Pages una vez publicado).

Servidor local rápido:

```bash
cd docs
python -m http.server 8080
# Abrí http://localhost:8080
```

---

## Datos fijos (`info_fija.json`)

`docs/data/info_fija.json` complementa `cotizaciones.json` con datos que BYMA no expone en el panel gratuito: vencimiento, cupón, amortización, sector, ley y **TIR de referencia** (valores aproximados verificados abr–jun 2026, no en tiempo real).

Cada entrada incluye `tir_fecha_referencia` (p. ej. `"2026-06"`) para dejar claro el origen temporal. Contrastá siempre con la **TIR mercado (aprox.)** que calcula el panel a partir del precio del JSON cuando hay cotización disponible.

Ejemplo de campos:

```json
{
  "YMCIO": {
    "nombre": "YPF ON 2029",
    "tipo": "ON corporativa",
    "sector": "Petróleo y gas",
    "moneda": "USD",
    "ley": "Nueva York (Reg S)",
    "tir_referencia": 6.9,
    "tir_rango": "6.7%–7.1%",
    "tir_fecha_referencia": "2026-06",
    "vencimiento": "2029-06-30",
    "cupon": "9% semestral",
    "cupon_tasa_anual": 9.0,
    "cupon_frecuencia": "semestral",
    "amortizacion": "7 cuotas semestrales 14,2857% desde jun 2026",
    "amortizacion_tipo": "amortizacion_parcial"
  }
}
```

La página combina ambos JSON para la tabla de cotizaciones y la calculadora de cartera.

---

## TIR de referencia vs TIR mercado

| Concepto | Origen | Uso en el panel |
|----------|--------|-----------------|
| **TIR de referencia** | `info_fija.json` (`tir_referencia`, jun 2026) | Línea superior en la columna “TIR ref. / mercado”; fallback en la calculadora |
| **TIR mercado (aprox.)** | Calculada en el navegador desde el precio BYMA | Línea inferior (color acento); priorizada en la TIR ponderada |

### Cómo se calcula la TIR mercado

En `docs/js/core.js`, la función `calcularTirMercado()` resuelve una **YTM aproximada** (yield to maturity) por bisección sobre el flujo de un bono **bullet** con cupón fijo:

- Precio BYMA → precio limpio por 100 nominal: `precio / 1000` (ej. 96300 → 96,30)
- Cupón periódico según `cupon_tasa_anual` y `cupon_frecuencia` (`semestral` = 2 pagos/año, `anual` = 1)
- Amortización única al vencimiento (`amortizacion_tipo: "bullet"`)

**Limitaciones actuales (mejora futura):**

- **Amortización parcial** (YMCIO, YFCJO): no se modela el calendario de amortizaciones; se muestra solo la TIR de referencia.
- No se descuentan días exactos al próximo cupón ni accrued interest; es una aproximación educativa, no un pricing profesional.
- Bonos con estructuras complejas (dual, callables, etc.) pueden requerir un motor de flujos dedicado.

Si la TIR mercado difiere más de ~0,3 pp de la ponderada por referencia, la calculadora muestra una advertencia.

---

## Instrumentos monitoreados (47)

El universo se define en `docs/data/info_fija.json` (campo `categoria` y `moneda`). El script `scripts/fetch_cotizaciones.py` lee esa lista automáticamente.

| Categoría | Cant. | Notas |
|-----------|------:|-------|
| ON corporativa | 13 | USD hard dollar |
| Soberano USD | 10 | Curva AL* / GD* |
| Soberano ARS | 12 | Lecaps, Boncer (CER), dollar-linked |
| Provincial | 8 | Tier 1 + CABA (BACAD/BACAO) |
| BCRA | 3 | BOPREAL (BPO27, BPO28, BPOD7) |
| CEDEAR | 1 | SPYD (ETF renta fija EEUU, proxy) |

Verificación PyOBD: `python scripts/verify_tickers.py --fase all --json docs/data/verify_instrumentos.json`

Tickers **pendientes de re-verificar en día hábil** (fin de semana sin filas ≠ inválido): `docs/data/instrumentos_pendientes.json`

### Municipales (Fase 3)

Ningún bono municipal con liquidez verificable en BYMA Open Data gratuito (jun 2026). No se agregaron al panel. Ver detalle en `instrumentos_pendientes.json`.

### LEFI / pases interbancarios (Fase 4)

LEFI y ex-LELIQ **no** figuran en el mercado secundario abierto de BYMA Open Data — documentado como limitación, no simulado.

---

## Instrumentos anteriores (referencia ONs por sector)

| Ticker | Sector |
|--------|--------|
| YMCIO, PN35O, PNDCO | Petróleo y gas |
| TTC9O, TTCDO | Gas natural |
| DNC7O, RAC5O, YFCJO, GN49O | Utilities |
| IRCFO, RUCDO | Real estate |
| TSC3O, TLCMO | Telecomunicaciones |
| AL30, GD30, GD35 | Soberanos |

`YMCUO` no está en BYMA Open Data gratuito y fue excluido del panel.

---

## Advertencia legal

Los datos provienen de **BYMA Open Data** con **difusión diferida**. No son cotizaciones en tiempo real exacto y pueden contener errores o demoras.

**Este proyecto es únicamente informativo y no constituye asesoramiento financiero, recomendación de inversión ni oferta de ningún tipo.** Operá bajo tu propio criterio y consultá profesionales calificados y fuentes oficiales antes de tomar decisiones de inversión.

---

## Licencia

Código del panel: uso libre. PyOBD está bajo [GPLv3](https://github.com/franco-lamas/PyOBD).
