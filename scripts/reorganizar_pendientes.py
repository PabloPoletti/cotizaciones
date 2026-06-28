#!/usr/bin/env python3
"""Reorganiza instrumentos_pendientes.json desde reportes de descubrimiento y verificaciones previas."""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
OUT = RAIZ / "docs" / "data" / "instrumentos_pendientes.json"
REPORTES = (
    RAIZ / "docs" / "data" / "descubrimiento_filtrado_muestra.json",
    RAIZ / "docs" / "data" / "descubrimiento_filtrado_resto.json",
)

PENDIENTE_DIA_HABIL = [
    {"ticker": "S29E5", "nota": "Formato ticker incorrecto; probar S31L6, S31G6, etc."},
    {"ticker": "S30E5", "nota": "Sin filas quote fin de semana — re-verificar día hábil"},
    {"ticker": "S31E5", "nota": "Sin filas quote fin de semana — re-verificar día hábil"},
    {"ticker": "S28F6", "nota": "Sin filas quote fin de semana — re-verificar día hábil"},
    {"ticker": "T15D5", "nota": "Sin filas quote fin de semana — re-verificar día hábil"},
    {"ticker": "T30A6", "nota": "Sin filas quote fin de semana — re-verificar día hábil"},
    {"ticker": "TZX25", "nota": "Posible ticker obsoleto (usar TZXD6) — re-verificar día hábil"},
    {"ticker": "T2X7", "nota": "Sin filas quote fin de semana — re-verificar día hábil"},
    {"ticker": "TX27", "nota": "Sin filas quote fin de semana — re-verificar día hábil"},
    {"ticker": "T2X4", "nota": "Sin filas quote fin de semana — re-verificar día hábil"},
    {"ticker": "S30J6", "nota": "Distinto de T30J6 (confirmado en panel) — re-verificar día hábil"},
    {"ticker": "SF28D", "nota": "Santa Fe — sin filas quote fin de semana"},
    {"ticker": "SF27D", "nota": "Santa Fe — sin filas quote fin de semana"},
    {"ticker": "CH28D", "nota": "Chaco — sin filas quote fin de semana"},
    {"ticker": "TDF27D", "nota": "Tierra del Fuego — sin filas quote fin de semana"},
    {"ticker": "CABA27D", "nota": "CABA puede operar como BACAD/BACAO — re-verificar día hábil"},
    {"ticker": "CABA28D", "nota": "Sin filas quote fin de semana"},
    {"ticker": "BPY6D", "nota": "BOPREAL serie 3 — sin filas fin de semana"},
    {"ticker": "BPY8D", "nota": "Sin filas quote fin de semana"},
    {"ticker": "TLTD", "nota": "CEDEAR ETF — sin filas fin de semana"},
    {"ticker": "SHYD", "nota": "CEDEAR ETF — sin filas fin de semana"},
    {"ticker": "BPO27", "nota": "En panel pero sin histórico BYMA Open Data — re-verificar día hábil"},
    {"ticker": "BPO28", "nota": "En panel pero sin histórico BYMA Open Data — re-verificar día hábil"},
]

NO_EXISTE_BYMA = [
    {"ticker": "YMCUO", "nota": "No expuesto en BYMA Open Data gratuito (confirmado)"},
    {"ticker": "MRC27D", "nota": "Córdoba Capital municipal — sin filas en Open Data"},
    {"ticker": "MRC28D", "nota": "Córdoba Capital municipal — sin filas en Open Data"},
    {"ticker": "ROS26D", "nota": "Rosario municipal — sin filas en Open Data"},
    {"ticker": "ROS28D", "nota": "Rosario municipal — sin filas en Open Data"},
    {"ticker": "MUNCO26", "nota": "Ticker hipotético — sin filas"},
    {"ticker": "MUNBA26", "nota": "Ticker hipotético — sin filas"},
    {"ticker": "LEFI", "nota": "Instrumento interbancario — no listado en Open Data"},
    {"ticker": "LELIQ", "nota": "LELIQ — no mercado secundario abierto BYMA"},
]

RE_VENC = re.compile(r"vencimiento\s+(\d{4}-\d{2}-\d{2})\s*<\s*2028", re.I)
RE_LIQ = re.compile(r"vol prom\s+([\d.]+)\s*<\s*p33 panel\s+([\d.]+)", re.I)


def clasificar_rechazo(entry: dict, emisor: str, fuente: str) -> tuple[str, dict] | None:
    motivo = entry.get("motivo") or ""
    ticker = entry.get("ticker")
    if not ticker:
        return None
    base = {
        "ticker": ticker,
        "emisor": emisor,
        "clase": entry.get("clase"),
        "fuente_reporte": fuente,
    }
    if "sin precio BYMA" in motivo.lower():
        return "ticker_no_existe_byma", {**base, "nota": motivo}
    if "sin volumen histórico" in motivo.lower():
        return "pendiente_verificar_dia_habil", {
            **base,
            "nota": "Sin volumen histórico BYMA en corrida — re-verificar día hábil",
            "vencimiento": entry.get("vencimiento"),
        }
    m = RE_LIQ.search(motivo)
    if m or "liquidez baja" in motivo.lower():
        return "rechazado_liquidez_baja", {
            **base,
            "vencimiento": entry.get("vencimiento"),
            "volumen_promedio": entry.get("volumen_promedio") or (float(m.group(1)) if m else None),
            "umbral_p33_panel": float(m.group(2)) if m else entry.get("umbral_p33"),
            "motivo": motivo,
        }
    m = RE_VENC.search(motivo)
    if m or ("vencimiento" in motivo.lower() and "< 2028" in motivo):
        venc = entry.get("vencimiento") or (m.group(1) if m else None)
        return "rechazado_vencimiento", {**base, "vencimiento": venc, "motivo": motivo}
    return "pendiente_verificar_dia_habil", {**base, "nota": motivo}


def main() -> None:
    buckets: dict[str, list] = {
        "pendiente_verificar_dia_habil": [{**x, "categoria": "pendiente_verificar_dia_habil"} for x in PENDIENTE_DIA_HABIL],
        "rechazado_liquidez_baja": [],
        "rechazado_vencimiento": [],
        "ticker_no_existe_byma": [{**x, "categoria": "ticker_no_existe_byma"} for x in NO_EXISTE_BYMA],
    }
    seen = {b["ticker"] for b in buckets["ticker_no_existe_byma"]}
    seen.update(b["ticker"] for b in buckets["pendiente_verificar_dia_habil"])

    for reporte in REPORTES:
        if not reporte.exists():
            continue
        data = json.loads(reporte.read_text(encoding="utf-8"))
        fuente = str(reporte.relative_to(RAIZ)).replace("\\", "/")
        p33 = None
        crit = data.get("criterios", {}).get("liquidez_minima", "")
        m = re.search(r"\(([\d.]+)\)", crit)
        if m:
            p33 = float(m.group(1))
        for _key, em in data.get("emisores", {}).items():
            emisor = em.get("nombre", _key)
            for rej in em.get("rechazados", []):
                if rej.get("en_panel"):
                    continue
                cls = clasificar_rechazo(rej, emisor, fuente)
                if not cls:
                    continue
                cat, item = cls
                if p33 and cat == "rechazado_liquidez_baja" and not item.get("umbral_p33_panel"):
                    item["umbral_p33_panel"] = p33
                item["categoria"] = cat
                t = item["ticker"]
                if t in seen:
                    continue
                seen.add(t)
                buckets[cat].append(item)

    # MSSDO from resto - sin precio
    if "MSSDO" not in seen:
        buckets["ticker_no_existe_byma"].append(
            {
                "ticker": "MSSDO",
                "emisor": "MSU Energy",
                "clase": "Serie XII",
                "vencimiento": "2032-11-14",
                "nota": "Sin precio BYMA en corrida jun 2026",
                "fuente_reporte": "docs/data/descubrimiento_filtrado_resto.json",
                "categoria": "ticker_no_existe_byma",
            }
        )

    for k in buckets:
        buckets[k].sort(key=lambda x: (x.get("emisor") or "", x["ticker"]))

    payload = {
        "_comentario": (
            "Tickers fuera del panel activo (59 inst.). Organizado por motivo de exclusión. "
            "No modifica info_fija.json."
        ),
        "fecha_reorganizacion": date.today().isoformat(),
        "criterios_panel_referencia": {
            "vencimiento_minimo": "2028-01-01",
            "liquidez_minima": "volumen_promedio >= p33 del panel",
            "max_series_por_emisor": 3,
        },
        "conteo": {k: len(v) for k, v in buckets.items()},
        **buckets,
        "notas_ampliacion_jun2026": {
            "agregados_al_panel": ["YMCXO", "YM39O", "YM42O", "PNICO", "PNECO", "PNRCO", "TSC4O", "DNCAO", "TLCPO", "TLCFO", "TLCTO", "IRCPO"],
            "reportes": [str(p.relative_to(RAIZ)).replace("\\", "/") for p in REPORTES if p.exists()],
        },
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Escrito {OUT}")
    print("Conteo:", payload["conteo"])


if __name__ == "__main__":
    main()
