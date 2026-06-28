#!/usr/bin/env python3
"""Fusiona las 6 series del descubrimiento «resto» en info_fija.json (idempotente)."""
from __future__ import annotations

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
INFO = RAIZ / "docs" / "data" / "info_fija.json"
REF = "2026-06"

NUEVOS: dict[str, dict] = {
    "TSC4O": {
        "nombre": "TGS ON 2035 (Clase 4)",
        "tipo": "ON corporativa",
        "sector": "Telecomunicaciones",
        "moneda": "USD",
        "ley": "Nueva York",
        "tir_fecha_referencia": REF,
        "vencimiento": "2035-11-20",
        "cupon": "Ver prospecto / ficha BYMA",
        "cupon_frecuencia": "semestral",
        "amortizacion": "Ver prospecto",
        "amortizacion_tipo": "bullet",
        "notas": "Emisión nov 2025 (BYMA Clase 4). Cupón y amortización: ver prospecto. TIR ref. pendiente verificación día hábil.",
        "categoria": "ON corporativa",
    },
    "DNCAO": {
        "nombre": "Edenor ON 2033 (Clase 10)",
        "tipo": "ON corporativa",
        "sector": "Utilities",
        "moneda": "USD",
        "ley": "Nueva York",
        "tir_fecha_referencia": REF,
        "vencimiento": "2033-04-28",
        "cupon": "Ver prospecto / ficha BYMA",
        "cupon_frecuencia": "semestral",
        "amortizacion": "Ver prospecto",
        "amortizacion_tipo": "bullet",
        "notas": "Emisión abr 2026 (BYMA Clase 10). TIR ref. pendiente verificación día hábil.",
        "categoria": "ON corporativa",
    },
    "TLCPO": {
        "nombre": "Telecom ON 2033 (Clase 24)",
        "tipo": "ON corporativa",
        "sector": "Telecomunicaciones",
        "moneda": "USD",
        "ley": "Nueva York",
        "tir_fecha_referencia": REF,
        "vencimiento": "2033-05-28",
        "cupon": "Ver prospecto / ficha BYMA",
        "cupon_frecuencia": "semestral",
        "amortizacion": "Ver prospecto",
        "amortizacion_tipo": "bullet",
        "notas": "Emisión may 2025 (BYMA Clase 24). TIR ref. pendiente verificación día hábil.",
        "categoria": "ON corporativa",
    },
    "TLCFO": {
        "nombre": "Telecom ON 2028 (Clase 14)",
        "tipo": "ON corporativa",
        "sector": "Telecomunicaciones",
        "moneda": "USD",
        "ley": "Nueva York",
        "tir_fecha_referencia": REF,
        "vencimiento": "2028-02-10",
        "cupon": "Ver prospecto / ficha BYMA",
        "cupon_frecuencia": "semestral",
        "amortizacion": "Ver prospecto",
        "amortizacion_tipo": "bullet",
        "notas": "Emisión feb 2023 (BYMA Clase 14). TIR ref. pendiente verificación día hábil.",
        "categoria": "ON corporativa",
    },
    "TLCTO": {
        "nombre": "Telecom ON 2036 (Clase 27)",
        "tipo": "ON corporativa",
        "sector": "Telecomunicaciones",
        "moneda": "USD",
        "ley": "Nueva York",
        "tir_fecha_referencia": REF,
        "vencimiento": "2036-01-20",
        "cupon": "Ver prospecto / ficha BYMA",
        "cupon_frecuencia": "semestral",
        "amortizacion": "Ver prospecto",
        "amortizacion_tipo": "bullet",
        "notas": "Emisión ene 2026 (BYMA Clase 27). TIR ref. pendiente verificación día hábil.",
        "categoria": "ON corporativa",
    },
    "IRCPO": {
        "nombre": "IRSA ON 2035 (Clase XXIV)",
        "tipo": "ON corporativa",
        "sector": "Real estate",
        "moneda": "USD",
        "ley": "Nueva York",
        "tir_fecha_referencia": REF,
        "vencimiento": "2035-03-31",
        "cupon": "Ver prospecto / ficha BYMA",
        "cupon_frecuencia": "semestral",
        "amortizacion": "Ver prospecto",
        "amortizacion_tipo": "amortizacion_parcial",
        "notas": "Canje desde Clase XIV (IRCFO) mar 2025. TIR ref. pendiente verificación día hábil.",
        "categoria": "ON corporativa",
    },
}


def main() -> None:
    data = json.loads(INFO.read_text(encoding="utf-8"))
    merged = 0
    for ticker, entry in NUEVOS.items():
        if ticker not in data:
            data[ticker] = entry
            merged += 1
        else:
            data[ticker].update(entry)
    INFO.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(1 for k in data if not k.startswith("_"))
    print(f"info_fija: {merged} entradas nuevas, total {total}")


if __name__ == "__main__":
    main()
