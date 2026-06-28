#!/usr/bin/env python3
"""
Cronogramas oficiales canje 2020 — Decreto 701/2020 (Globales GD, Ley NY)
y términos equivalentes Bonares USD (AL) según Argentina.gob.ar / Ley 27.556.

Genera fechas semestrales 9 ene / 9 jul y actualiza docs/data/info_fija.json.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
INFO_FIJA = RAIZ / "docs" / "data" / "info_fija.json"

FUENTE_GD = "Decreto 701/2020 — Condiciones de emisión títulos nuevos (infoleg dec701.pdf)"
FUENTE_AL = (
    "Ley 27.556 Anexo III + condiciones Step Up USD (Argentina.gob.ar); "
    "calendario 9 ene/9 jul alineado a serie Global (Dec701)"
)


def fechas_9ene_9jul(desde: tuple[int, int, int], n: int) -> list[str]:
    """n pagos semestrales alternando 9 ene / 9 jul desde la primera fecha."""
    y, m, d = desde
    out: list[str] = []
    for _ in range(n):
        out.append(date(y, m, d).isoformat())
        if m == 1:
            m, d = 7, 9
        else:
            y, m, d = y + 1, 1, 9
    return out


def cuotas_iguales(fechas: list[str], pct: float) -> list[dict]:
    return [{"fecha": f, "porcentaje": round(pct, 6)} for f in fechas]


def cuotas_gd30() -> list[dict]:
    fechas = fechas_9ene_9jul((2024, 7, 9), 13)
    rows = [{"fecha": fechas[0], "porcentaje": 4.0}]
    rows.extend(cuotas_iguales(fechas[1:], 8.0))
    return rows


def meta_step_up(
    ticker: str,
    ley: str,
    vencimiento: str,
    cronograma_cupon: list[dict],
    cronograma_amortizacion: list[dict],
    amort_descripcion: str,
    fuente: str,
) -> dict:
    return {
        "cupon": "Step-up (ver cronograma)",
        "cupon_tipo": "step_up",
        "cupon_frecuencia": "semestral",
        "cupon_fecha_pago": "9 ene / 9 jul",
        "cronograma_cupon": cronograma_cupon,
        "amortizacion": amort_descripcion,
        "amortizacion_tipo": "parcial_cronograma",
        "cronograma_amortizacion": cronograma_amortizacion,
        "vencimiento": vencimiento,
        "fuente_cronograma": fuente,
        "fecha_emision": "2020-09-04",
    }


# --- Cupones step-up (tasas anuales, ventanas Dec701 / Ley 27556 equivalente) ---

CUPON_GD30 = [
    {"desde": "2020-09-04", "hasta": "2021-07-09", "tasa_anual": 0.125},
    {"desde": "2021-07-09", "hasta": "2023-07-09", "tasa_anual": 0.5},
    {"desde": "2023-07-09", "hasta": "2027-07-09", "tasa_anual": 0.75},
    {"desde": "2027-07-09", "hasta": "2030-07-09", "tasa_anual": 1.75},
]

CUPON_GD35 = [
    {"desde": "2020-09-04", "hasta": "2021-07-09", "tasa_anual": 0.125},
    {"desde": "2021-07-09", "hasta": "2022-07-09", "tasa_anual": 1.125},
    {"desde": "2022-07-09", "hasta": "2023-07-09", "tasa_anual": 1.5},
    {"desde": "2023-07-09", "hasta": "2024-07-09", "tasa_anual": 3.625},
    {"desde": "2024-07-09", "hasta": "2027-07-09", "tasa_anual": 4.125},
    {"desde": "2027-07-09", "hasta": "2028-07-09", "tasa_anual": 4.75},
    {"desde": "2028-07-09", "hasta": "2035-07-09", "tasa_anual": 5.0},
]

CUPON_GD38 = [
    {"desde": "2020-09-04", "hasta": "2021-07-09", "tasa_anual": 0.125},
    {"desde": "2021-07-09", "hasta": "2022-07-09", "tasa_anual": 2.0},
    {"desde": "2022-07-09", "hasta": "2023-07-09", "tasa_anual": 3.875},
    {"desde": "2023-07-09", "hasta": "2024-07-09", "tasa_anual": 4.25},
    {"desde": "2024-07-09", "hasta": "2038-07-09", "tasa_anual": 5.0},
]

CUPON_GD41 = [
    {"desde": "2020-09-04", "hasta": "2021-07-09", "tasa_anual": 0.125},
    {"desde": "2021-07-09", "hasta": "2022-07-09", "tasa_anual": 2.5},
    {"desde": "2022-07-09", "hasta": "2029-07-09", "tasa_anual": 3.5},
    {"desde": "2029-07-09", "hasta": "2041-07-09", "tasa_anual": 4.875},
]

CUPON_GD46 = [
    {"desde": "2020-09-04", "hasta": "2021-07-09", "tasa_anual": 0.125},
    {"desde": "2021-07-09", "hasta": "2022-07-09", "tasa_anual": 1.125},
    {"desde": "2022-07-09", "hasta": "2023-07-09", "tasa_anual": 1.5},
    {"desde": "2023-07-09", "hasta": "2024-07-09", "tasa_anual": 3.625},
    {"desde": "2024-07-09", "hasta": "2027-07-09", "tasa_anual": 4.125},
    {"desde": "2027-07-09", "hasta": "2028-07-09", "tasa_anual": 4.375},
    {"desde": "2028-07-09", "hasta": "2046-07-09", "tasa_anual": 5.0},
]

# GD29 / AL29: cupón fijo 1% (Dec701 sección K) — no step-up
CUPON_FIJO_1PCT = [
    {"desde": "2020-09-04", "hasta": "2029-07-09", "tasa_anual": 1.0},
]

PCT_22 = 100 / 22
PCT_28 = 100 / 28
PCT_44 = 100 / 44
PCT_10 = 10.0

PLANTILLAS: dict[str, dict] = {
    "GD30": meta_step_up(
        "GD30",
        "Nueva York",
        "2030-07-09",
        CUPON_GD30,
        cuotas_gd30(),
        "13 cuotas semestrales: 4% (jul-2024) + doce de 8% (ene/jul 2025–2030)",
        FUENTE_GD,
    ),
    "AL30": meta_step_up(
        "AL30",
        "Argentina",
        "2030-07-09",
        CUPON_GD30,
        cuotas_gd30(),
        "13 cuotas semestrales: 4% (jul-2024) + doce de 8% (ene/jul 2025–2030)",
        FUENTE_AL,
    ),
    "GD35": meta_step_up(
        "GD35",
        "Nueva York",
        "2035-07-09",
        CUPON_GD35,
        cuotas_iguales(fechas_9ene_9jul((2031, 1, 9), 10), PCT_10),
        "10 cuotas semestrales iguales (ene/jul 2031–2035)",
        FUENTE_GD,
    ),
    "AL35": meta_step_up(
        "AL35",
        "Argentina",
        "2035-07-09",
        CUPON_GD35,
        cuotas_iguales(fechas_9ene_9jul((2031, 1, 9), 10), PCT_10),
        "10 cuotas semestrales iguales (ene/jul 2031–2035)",
        FUENTE_AL,
    ),
    "GD38": meta_step_up(
        "GD38",
        "Nueva York",
        "2038-07-09",
        CUPON_GD38,
        cuotas_iguales(fechas_9ene_9jul((2027, 7, 9), 22), PCT_22),
        "22 cuotas semestrales iguales (~4,545% c/u) desde jul-2027",
        FUENTE_GD,
    ),
    "GD41": meta_step_up(
        "GD41",
        "Nueva York",
        "2041-07-09",
        CUPON_GD41,
        cuotas_iguales(fechas_9ene_9jul((2028, 1, 9), 28), PCT_28),
        "28 cuotas semestrales iguales (~3,571% c/u) desde ene-2028",
        FUENTE_GD,
    ),
    "AL41": meta_step_up(
        "AL41",
        "Argentina",
        "2041-07-09",
        CUPON_GD41,
        cuotas_iguales(fechas_9ene_9jul((2028, 1, 9), 28), PCT_28),
        "28 cuotas semestrales iguales (~3,571% c/u) desde ene-2028",
        FUENTE_AL,
    ),
    "GD46": meta_step_up(
        "GD46",
        "Nueva York",
        "2046-07-09",
        CUPON_GD46,
        cuotas_iguales(fechas_9ene_9jul((2025, 1, 9), 44), PCT_44),
        "44 cuotas semestrales iguales (~2,273% c/u) desde ene-2025",
        FUENTE_GD,
    ),
    "GD29": {
        "cupon": "1% anual fijo (Dec701 §K)",
        "cupon_tipo": "fijo",
        "cupon_frecuencia": "semestral",
        "cupon_fecha_pago": "9 ene / 9 jul",
        "cronograma_cupon": CUPON_FIJO_1PCT,
        "amortizacion": "10 cuotas semestrales iguales (10% c/u, ene/jul 2025–2029)",
        "amortizacion_tipo": "parcial_cronograma",
        "cronograma_amortizacion": cuotas_iguales(fechas_9ene_9jul((2025, 1, 9), 10), PCT_10),
        "vencimiento": "2029-07-09",
        "fuente_cronograma": FUENTE_GD,
        "fecha_emision": "2020-09-04",
    },
    "AL29": {
        "cupon": "1% anual fijo",
        "cupon_tipo": "fijo",
        "cupon_frecuencia": "semestral",
        "cupon_fecha_pago": "9 ene / 9 jul",
        "cronograma_cupon": CUPON_FIJO_1PCT,
        "amortizacion": "10 cuotas semestrales iguales (10% c/u, ene/jul 2025–2029)",
        "amortizacion_tipo": "parcial_cronograma",
        "cronograma_amortizacion": cuotas_iguales(fechas_9ene_9jul((2025, 1, 9), 10), PCT_10),
        "vencimiento": "2029-07-09",
        "fuente_cronograma": FUENTE_AL,
        "fecha_emision": "2020-09-04",
    },
}


def aplicar() -> None:
    data = json.loads(INFO_FIJA.read_text(encoding="utf-8"))
    for ticker, plantilla in PLANTILLAS.items():
        if ticker not in data:
            continue
        entry = data[ticker]
        for key, val in plantilla.items():
            entry[key] = val
        if entry.get("cupon_tipo") == "step_up":
            entry.pop("cupon_tasa_anual", None)
        elif entry.get("cupon_tipo") == "fijo" and entry.get("cronograma_cupon"):
            entry["cupon_tasa_anual"] = entry["cronograma_cupon"][0]["tasa_anual"]
    INFO_FIJA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Actualizados {len(PLANTILLAS)} tickers canje 2020 en {INFO_FIJA}")


if __name__ == "__main__":
    aplicar()
