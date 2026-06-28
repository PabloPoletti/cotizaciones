#!/usr/bin/env python3
"""
Verifica tickers contra PyOBD / paneles BYMA Open Data.
Uso: python scripts/verify_tickers.py [--fase 1|2|3|4|all] [--json report.json]

Estados:
  confirmado     — símbolo en panel BYMA o get_current_quote devuelve filas
  pendiente      — sin filas hoy (fin de semana/feriado) pero sin error de especie
  descartado     — error explícito de especie no encontrada o ausente del universo
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
from pyobd import BymaData

TZ = ZoneInfo("America/Argentina/Buenos_Aires")

FASES: dict[str, list[str]] = {
    "1": [
        # Soberanos USD ley argentina
        "AL29", "AL30", "AL35", "AL41",
        # Soberanos USD ley NY
        "GD29", "GD30", "GD35", "GD38", "GD41", "GD46",
        # ARS tasa fija (Lecaps / bonos peso — candidatos líquidos jun 2026)
        "S29E5", "S30E5", "S31E5", "S32E5", "S28F6", "S29F6",
        "T15D5", "T30A6", "T30J6",
        # ARS CER (Boncer)
        "TX26", "TX28", "TZX25", "TZX26", "T2X7", "TX27",
        # ARS dollar-linked (candidatos)
        "TVPP", "T2X4", "DICP",
    ],
    "2": [
        "CO26D", "CO27D", "PM29D", "SA24D", "NDT5D", "BA37D",
        "SF28D", "SF27D", "CH28D", "TDF27D",
        "BACAD", "BACAO", "CABA27D", "CABA28D",
    ],
    "3": [
        "MRC27D", "MRC28D", "ROS26D", "ROS28D", "MUNCO26", "MUNBA26",
    ],
    "4": [
        "BPO27", "BPY6D", "BPO28", "BPY8D", "BPOD7", "LEFI", "LELIQ",
        "GD35D", "SPYD", "TLTD", "SHYD",
    ],
}

NOT_FOUND_PATTERNS = re.compile(
    r"not found|no encontr|invalid symbol|unknown symbol|especie|404|400",
    re.I,
)


def cargar_universo(cliente: BymaData) -> set[str]:
    simbolos: set[str] = set()
    for metodo in ("get_government_bonds", "get_corporate_bonds"):
        try:
            df = getattr(cliente, metodo)()
            if df is not None and len(df) and "symbol" in df.columns:
                simbolos.update(df["symbol"].astype(str).str.strip().tolist())
        except Exception as exc:  # noqa: BLE001
            print(f"  WARN panel {metodo}: {exc}", file=sys.stderr)
    return simbolos


def probar_quote(cliente: BymaData, ticker: str) -> tuple[bool, bool, str]:
    """Devuelve (tiene_fila, error_especie, detalle)."""
    tiene_fila = False
    error_especie = False
    detalles: list[str] = []

    for liq in ("CI", "24HS"):
        try:
            df = cliente.get_current_quote(ticker, settlement=liq)
            if df is not None and len(df) > 0:
                tiene_fila = True
                row = df.iloc[0]
                detalles.append(
                    f"{liq}: trade={row.get('trade')} prevClose={row.get('previousClosingPrice')}"
                )
            else:
                detalles.append(f"{liq}: sin filas")
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            detalles.append(f"{liq}: ERROR {msg[:120]}")
            if NOT_FOUND_PATTERNS.search(msg):
                error_especie = True

    return tiene_fila, error_especie, "; ".join(detalles)


def clasificar(ticker: str, en_panel: bool, tiene_fila: bool, error_especie: bool) -> str:
    if error_especie and not en_panel and not tiene_fila:
        return "descartado"
    if en_panel or tiene_fila:
        return "confirmado"
    if error_especie:
        return "descartado"
    return "pendiente"


def verificar_fase(cliente: BymaData, universo: set[str], tickers: list[str]) -> list[dict]:
    resultados = []
    for ticker in tickers:
        en_panel = ticker in universo
        tiene_fila, error_especie, detalle = probar_quote(cliente, ticker)
        estado = clasificar(ticker, en_panel, tiene_fila, error_especie)
        resultados.append(
            {
                "ticker": ticker,
                "estado": estado,
                "en_panel_byma": en_panel,
                "quote_filas": tiene_fila,
                "error_especie": error_especie,
                "detalle": detalle,
            }
        )
    return resultados


def resumir(resultados: list[dict]) -> dict[str, int]:
    counts = {"confirmado": 0, "pendiente": 0, "descartado": 0}
    for r in resultados:
        counts[r["estado"]] = counts.get(r["estado"], 0) + 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fase", default="1", help="1|2|3|4|all o lista CSV de tickers")
    parser.add_argument("--json", type=Path, help="Guardar reporte JSON")
    parser.add_argument("--list-universe", action="store_true", help="Listar símbolos gobierno")
    args = parser.parse_args()

    cliente = BymaData()
    universo = cargar_universo(cliente)

    if args.list_universe:
        gob = sorted(s for s in universo if s[:2] in {"AL", "GD", "TX", "TZ", "S2", "S3", "BP", "CO", "PM"})
        print(json.dumps(gob[:200], indent=2))
        return 0

    if args.fase == "all":
        fases = list(FASES.keys())
    elif args.fase in FASES:
        fases = [args.fase]
    elif "," in args.fase:
        tickers = [t.strip().upper() for t in args.fase.split(",") if t.strip()]
        resultados = verificar_fase(cliente, universo, tickers)
        print(json.dumps({"fecha": datetime.now(TZ).isoformat(), "resultados": resultados}, indent=2))
        return 0
    else:
        print(f"Fase desconocida: {args.fase}", file=sys.stderr)
        return 1

    reporte = {
        "fecha_verificacion": datetime.now(TZ).isoformat(),
        "nota": "Fin de semana: 'pendiente' no implica ticker inválido.",
        "universo_panel_total": len(universo),
        "fases": {},
    }

    for f in fases:
        tickers = FASES[f]
        ya = {"AL30", "GD30", "GD35"} if f == "1" else set()
        nuevos = [t for t in tickers if t not in ya]
        resultados = verificar_fase(cliente, universo, tickers)
        reporte["fases"][f] = {
            "tickers": tickers,
            "nuevos_vs_panel_actual": nuevos,
            "resumen": resumir(resultados),
            "resultados": resultados,
        }
        print(f"\n=== Fase {f} ===")
        print(f"Resumen: {reporte['fases'][f]['resumen']}")
        for r in resultados:
            flag = {"confirmado": "+", "pendiente": "?", "descartado": "x"}[r["estado"]]
            print(f"  [{flag}] {r['ticker']:8} panel={r['en_panel_byma']} quote={r['quote_filas']}")

    if args.json:
        args.json.write_text(json.dumps(reporte, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nReporte guardado en {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
