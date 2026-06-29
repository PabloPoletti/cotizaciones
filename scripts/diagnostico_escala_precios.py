#!/usr/bin/env python3
"""Diagnóstico escala precios BYMA: AO27/AO28/AN29 vs AL30/GD30/AL29."""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from pyobd import BymaData

from fetch_cotizaciones import configurar_sesion_byma, con_reintentos
from historico_precios import fetch_daily_history

TICKERS = ["AO27", "AO28", "AN29", "AL29", "AL30", "GD30"]
RAIZ = Path(__file__).resolve().parent.parent
OUT = RAIZ / "docs" / "data" / "diagnostico_escala_precios.json"


def fila_a_dict(df: pd.DataFrame) -> dict:
    if df is None or len(df) == 0:
        return {}
    row = df.iloc[0]
    return {k: (None if pd.isna(v) else (float(v) if isinstance(v, (int, float)) else str(v))) for k, v in row.items()}


def main() -> None:
    cliente = BymaData()
    configurar_sesion_byma(cliente)
    fin = date.today()
    inicio = fin - timedelta(days=14)

    reporte: dict = {"fecha": fin.isoformat(), "tickers": {}}

    for ticker in TICKERS:
        item: dict = {"quote": {}, "historico": {}}
        for liq in ("CI", "24HS"):
            try:
                df = con_reintentos(
                    f"quote-{ticker}-{liq}",
                    lambda t=ticker, l=liq: cliente.get_current_quote(t, settlement=l),
                )
                item["quote"][liq] = {
                    "columnas": list(df.columns) if df is not None and len(df) else [],
                    "fila": fila_a_dict(df) if df is not None and len(df) else None,
                }
            except Exception as exc:  # noqa: BLE001
                item["quote"][liq] = {"error": str(exc)}

        dfh, sim = fetch_daily_history(cliente, ticker, inicio.isoformat(), fin.isoformat())
        if dfh is not None and len(dfh):
            ult = dfh.iloc[-1].to_dict()
            item["historico"] = {
                "simbolo": sim,
                "filas": len(dfh),
                "ultimo": {k: (float(v) if k != "date" else str(v)) for k, v in ult.items()},
                "muestra": dfh.tail(3).to_dict(orient="records"),
            }
        reporte["tickers"][ticker] = item

        q = item["quote"].get("24HS", {}).get("fila") or item["quote"].get("CI", {}).get("fila") or {}
        h = item["historico"].get("ultimo", {})
        raw_trade = q.get("trade") or q.get("closingPrice") or h.get("close")
        raw_prev = q.get("previousClosingPrice")
        print(f"\n=== {ticker} ===")
        print(f"  quote cols: {item['quote'].get('24HS', {}).get('columnas', [])}")
        print(f"  trade={q.get('trade')} prevClose={raw_prev} close_hist={h.get('close')}")
        if raw_trade and h.get("close"):
            print(f"  ratio hist/quote: {h.get('close') / raw_trade if raw_trade else 'n/a'}")

    OUT.write_text(json.dumps(reporte, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nReporte: {OUT}")


if __name__ == "__main__":
    main()
