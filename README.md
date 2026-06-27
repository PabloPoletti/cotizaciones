# Cotizaciones ONs & Soberanos (USD)

Panel estático de cotizaciones de **Obligaciones Negociables** y **bonos soberanos argentinos en dólares**, con actualización automática vía GitHub Actions y datos de [BYMA Open Data](https://www.byma.com.ar/) usando la librería [PyOBD](https://github.com/franco-lamas/PyOBD).

Repositorio: [github.com/PabloPoletti/cotizaciones](https://github.com/PabloPoletti/cotizaciones)

---

## Estructura del proyecto

```
cotizaciones/
├── .github/
│   └── workflows/
│       └── actualizar.yml      # Workflow: cron + manual, commit del JSON
├── docs/                       # Raíz de GitHub Pages
│   ├── index.html              # Dashboard principal
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   └── app.js
│   └── data/
│       ├── cotizaciones.json   # Generado por el script (actualizado por Actions)
│       └── info_fija.json      # TIR, vencimiento, cupón, amortización (manual)
├── scripts/
│   └── fetch_cotizaciones.py   # Consulta BYMA y escribe el JSON
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
| **Frecuencia** | Cada 30 minutos (`cron: */30 * * * *`) |
| **Manual** | Botón **Run workflow** en Actions, o desde el panel web |
| **Horario** | Solo lun–vie, 11:00–17:30 ART (en cron; manual ignora este filtro) |
| **Qué hace** | Instala Python + PyOBD, ejecuta `scripts/fetch_cotizaciones.py`, commitea `docs/data/cotizaciones.json` |

### Permisos

El workflow usa `GITHUB_TOKEN` con permiso `contents: write` para hacer push del JSON. No necesitás secrets adicionales para la actualización automática.

### Disparo manual desde la web

El botón **Actualizar ahora** del panel llama a la API de GitHub. Necesitás un **Personal Access Token** con permiso `workflow` (o Actions write), guardado solo en localStorage del navegador — nunca lo commitees.

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

En `docs/js/app.js`, la función `calcularTirMercado()` resuelve una **YTM aproximada** (yield to maturity) por bisección sobre el flujo de un bono **bullet** con cupón fijo:

- Precio BYMA → precio limpio por 100 nominal: `precio / 1000` (ej. 96300 → 96,30)
- Cupón periódico según `cupon_tasa_anual` y `cupon_frecuencia` (`semestral` = 2 pagos/año, `anual` = 1)
- Amortización única al vencimiento (`amortizacion_tipo: "bullet"`)

**Limitaciones actuales (mejora futura):**

- **Amortización parcial** (YMCIO, YFCJO): no se modela el calendario de amortizaciones; se muestra solo la TIR de referencia.
- No se descuentan días exactos al próximo cupón ni accrued interest; es una aproximación educativa, no un pricing profesional.
- Bonos con estructuras complejas (dual, callables, etc.) pueden requerir un motor de flujos dedicado.

Si la TIR mercado difiere más de ~0,3 pp de la ponderada por referencia, la calculadora muestra una advertencia.

---

## Instrumentos monitoreados (16)

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
