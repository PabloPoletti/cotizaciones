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

## Completar datos fijos (TIR, vencimiento, etc.)

Editá `docs/data/info_fija.json` con los valores de referencia de cada ticker:

```json
{
  "YMCIO": {
    "tir_referencia": 8.5,
    "vencimiento": "2029-07-01",
    "cupon": "8.75% semestral",
    "amortizacion": "Bullet"
  }
}
```

La página combina este archivo con `cotizaciones.json` para mostrar la tabla y alimentar la calculadora de cartera.

---

## Instrumentos monitoreados

| Ticker | Sector |
|--------|--------|
| YMCIO, YMCUO, PN35O, PNDCO | Petróleo y gas |
| TTC9O, TTCDO | Gas natural |
| DNC7O, RAC5O, YFCJO, GN49O | Utilities |
| IRCFO, RUCDO | Real estate |
| TSC3O, TLCMO | Telecomunicaciones |
| AL30, GD30, GD35 | Soberanos |

---

## Advertencia legal

Los datos provienen de **BYMA Open Data** con **difusión diferida**. No son cotizaciones en tiempo real exacto y pueden contener errores o demoras.

**Este proyecto es únicamente informativo y no constituye asesoramiento financiero, recomendación de inversión ni oferta de ningún tipo.** Operá bajo tu propio criterio y consultá profesionales calificados y fuentes oficiales antes de tomar decisiones de inversión.

---

## Licencia

Código del panel: uso libre. PyOBD está bajo [GPLv3](https://github.com/franco-lamas/PyOBD).
