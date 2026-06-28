#!/usr/bin/env python3
"""
Descubrimiento de series BYMA por emisor (PyOBD / Open Data gratuito).

Limitación BYMA Open Data (jun 2026):
  - No hay en PyOBD un endpoint público de "listado por emisor" usable sin auth.
  - issuers-negociable-securities-information responde HTTP 401 sin suscripción.
  - Sí existe el panel negociable-obligations (get_corporate_bonds) y, por ticker,
    get_equity_profile devuelve el campo «emisor».

Estrategia:
  1. Candidatos desde get_corporate_bonds (símbolos únicos, típicamente *O USD).
  2. Filtrar por emisor vía get_equity_profile (o prefijo heurístico + confirmación).
  3. Verificar precio real con get_daily_history (misma lógica que fetch_cotizaciones).
  4. Comparar con info_fija.json; lo nuevo con precio va a reporte JSON.
     No escribe info_fija.json — series sin prospecto verificado quedan como pendientes.

Uso:
  python scripts/descubrir_series.py --muestra
  python scripts/descubrir_series.py --emisor ypf,tecpetrol,pan_american
  python scripts/descubrir_series.py --all
  python scripts/descubrir_series.py --muestra --json docs/data/descubrimiento_muestra.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from pyobd import BymaData

RAIZ = Path(__file__).resolve().parent.parent
INFO_FIJA = RAIZ / "docs" / "data" / "info_fija.json"
PENDIENTES = RAIZ / "docs" / "data" / "instrumentos_pendientes.json"
TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# Emisores del panel actual: clave interna → patrones emisor BYMA + prefijos ticker
EMISORES: dict[str, dict] = {
    "ypf": {
        "nombre": "YPF S.A.",
        "match_emisor": ("YPF S.A.", "YPF"),
        "prefixes": ("YM",),
        "suffix": "O",
    },
    "ypf_luz": {
        "nombre": "YPF Luz",
        "match_emisor": ("YPF LUZ", "LUZ"),
        "prefixes": ("YF",),
        "suffix": "O",
    },
    "tecpetrol": {
        "nombre": "Tecpetrol S.A.",
        "match_emisor": ("TECPETROL",),
        "prefixes": ("TT",),
        "suffix": "O",
    },
    "pan_american": {
        "nombre": "Pan American Energy",
        "match_emisor": ("PAN AMERICAN",),
        "prefixes": ("PN",),
        "suffix": "O",
    },
    "tgs": {
        "nombre": "TGS",
        "match_emisor": ("TGS", "TRANSPORTADORA DE GAS"),
        "prefixes": ("TS", "TG"),
        "suffix": "O",
    },
    "edenor": {
        "nombre": "Edenor",
        "match_emisor": ("EDENOR",),
        "prefixes": ("DN", "ED"),
        "suffix": "O",
    },
    "telecom": {
        "nombre": "Telecom",
        "match_emisor": ("TELECOM", "TELECOM ARGENTINA"),
        "prefixes": ("TL", "TE"),
        "suffix": "O",
    },
    "irsa": {
        "nombre": "IRSA",
        "match_emisor": ("IRSA",),
        "prefixes": ("IR",),
        "suffix": "O",
    },
    "raghsa": {
        "nombre": "Raghsa",
        "match_emisor": ("RAGHSA", "AYSA"),
        "prefixes": ("RA",),
        "suffix": "O",
    },
    "genneia": {
        "nombre": "Genneia",
        "match_emisor": ("GENNEIA",),
        "prefixes": ("GN",),
        "suffix": "O",
    },
    "msu": {
        "nombre": "MSU Energy",
        "match_emisor": ("MSU",),
        "prefixes": ("RU", "MS"),
        "suffix": "O",
    },
    "cordoba": {"nombre": "Córdoba", "match_emisor": ("CORDOBA", "PROVINCIA DE CORDOBA"), "prefixes": ("CO",), "suffix": "D"},
    "mendoza": {"nombre": "Mendoza", "match_emisor": ("MENDOZA",), "prefixes": ("PM",), "suffix": "D"},
    "salta": {"nombre": "Salta", "match_emisor": ("SALTA",), "prefixes": ("SA",), "suffix": "D"},
    "neuquen": {"nombre": "Neuquén", "match_emisor": ("NEUQUEN",), "prefixes": ("ND",), "suffix": "D"},
    "buenos_aires": {"nombre": "Buenos Aires", "match_emisor": ("BUENOS AIRES", "PROVINCIA DE BUENOS AIRES"), "prefixes": ("BA",), "suffix": "D"},
    "caba": {"nombre": "CABA", "match_emisor": ("CABA", "CIUDAD DE BUENOS AIRES"), "prefixes": ("BAC",), "suffix": "D"},
}

MUESTRA_KEYS = ("ypf", "tecpetrol", "pan_american", "genneia")


def cargar_panel() -> set[str]:
    data = json.loads(INFO_FIJA.read_text(encoding="utf-8"))
    return {k for k, v in data.items() if not k.startswith("_") and isinstance(v, dict)}


def base_symbol(symbol: str) -> str:
    return str(symbol).strip().upper().split(".")[0]


def candidatos_por_prefijo(corp_bases: set[str], cfg: dict) -> list[str]:
    suf = cfg.get("suffix", "O")
    out = []
    for b in corp_bases:
        if not b.endswith(suf):
            continue
        if any(b.startswith(p) for p in cfg["prefixes"]):
            out.append(b)
    return sorted(out)


def emisor_coincide(emisor_byma: str, cfg: dict) -> bool:
    e = emisor_byma.upper()
    return any(m.upper() in e for m in cfg["match_emisor"])


def perfil_emisor(cliente: BymaData, ticker: str) -> dict | None:
    try:
        df = cliente.get_equity_profile(ticker)
    except Exception:
        return None
    if df is None or len(df) == 0:
        return None
    row = {str(r["campo"]): r["valor"] for _, r in df.iterrows()}
    em = str(row.get("emisor", "")).strip()
    if not em:
        return None
    return {
        "emisor": em,
        "clase": str(row.get("denominacion", "")).strip(),
        "vencimiento": str(row.get("fechaVencimiento", ""))[:10],
        "fecha_emision": str(row.get("fechaEmision", ""))[:10] or None,
        "isin": str(row.get("codigoIsin", "")).strip() or None,
    }


def ultimo_cierre_historico(cliente: BymaData, ticker: str) -> tuple[float | None, str | None, str | None]:
    fin = datetime.now(TZ).date()
    inicio = fin - timedelta(days=45)
    for simbolo in (f"{ticker} 24HS", f"{ticker} CI", ticker):
        try:
            df = cliente.get_daily_history(simbolo, inicio.isoformat(), fin.isoformat())
            if df is None or len(df) == 0:
                continue
            df = df[df["close"] > 0]
            if len(df) == 0:
                continue
            u = df.iloc[-1]
            return float(u["close"]), str(u["date"])[:10], simbolo
        except Exception:
            continue
    return None, None, None


def descubrir_emisor(
    cliente: BymaData,
    key: str,
    cfg: dict,
    corp_bases: set[str],
    panel: set[str],
    pausa_seg: float,
) -> dict:
    candidatos = candidatos_por_prefijo(corp_bases, cfg)
    series: list[dict] = []
    perfiles_cache: dict[str, dict | None] = {}

    for ticker in candidatos:
        if ticker not in perfiles_cache:
            perfiles_cache[ticker] = perfil_emisor(cliente, ticker)
            time.sleep(pausa_seg)
        perf = perfiles_cache[ticker]
        if not perf or not emisor_coincide(perf["emisor"], cfg):
            continue

        px, fecha, simbolo = ultimo_cierre_historico(cliente, ticker)
        time.sleep(pausa_seg * 0.5)

        series.append(
            {
                "ticker": ticker,
                "clase": perf["clase"],
                "vencimiento": perf["vencimiento"],
                "emisor_byma": perf["emisor"],
                "en_panel": ticker in panel,
                "tiene_precio": px is not None,
                "ultimo_cierre": px,
                "fecha_cierre": fecha,
                "simbolo_historico": simbolo,
                "isin": perf.get("isin"),
            }
        )

    clases = {s["clase"] for s in series if s["clase"]}
    clases_panel = {s["clase"] for s in series if s["en_panel"]}
    nuevas = [s for s in series if not s["en_panel"]]
    nuevas_con_precio = [s for s in nuevas if s["tiene_precio"]]

    return {
        "emisor": cfg["nombre"],
        "candidatos_prefijo": len(candidatos),
        "series_confirmadas_emisor": len(series),
        "clases_distintas": len(clases),
        "clases_en_panel": len(clases_panel),
        "clases_nuevas": len(clases - clases_panel),
        "tickers_nuevos": len(nuevas),
        "tickers_nuevos_con_precio": len(nuevas_con_precio),
        "series": series,
        "pendientes_info_fija": [
            {
                "ticker": s["ticker"],
                "clase": s["clase"],
                "vencimiento": s["vencimiento"],
                "ultimo_cierre": s["ultimo_cierre"],
                "fecha_cierre": s["fecha_cierre"],
                "nota": "Precio BYMA OK — completar cupón/TIR/ley desde prospecto antes de info_fija.json",
            }
            for s in nuevas_con_precio
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Descubrir series BYMA por emisor")
    parser.add_argument("--muestra", action="store_true", help=f"Solo {', '.join(MUESTRA_KEYS)}")
    parser.add_argument("--emisor", help="Claves CSV: ypf,tecpetrol,...")
    parser.add_argument("--all", action="store_true", help="Todos los emisores configurados")
    parser.add_argument("--json", type=Path, help="Ruta salida JSON")
    parser.add_argument("--pausa", type=float, default=0.12, help="Segundos entre llamadas BYMA")
    args = parser.parse_args()

    if args.muestra:
        keys = list(MUESTRA_KEYS)
    elif args.all:
        keys = list(EMISORES.keys())
    elif args.emisor:
        keys = [k.strip().lower() for k in args.emisor.split(",") if k.strip()]
        bad = [k for k in keys if k not in EMISORES]
        if bad:
            print(f"Emisores desconocidos: {bad}", file=sys.stderr)
            return 1
    else:
        parser.print_help()
        return 1

    panel = cargar_panel()
    cliente = BymaData()
    corp = cliente.get_corporate_bonds()
    corp_bases = {base_symbol(s) for s in corp["symbol"].astype(str)}

    reporte = {
        "fecha": datetime.now(TZ).isoformat(),
        "limitacion_byma": (
            "Sin endpoint gratuito de búsqueda por emisor. "
            "Descubrimiento: get_corporate_bonds + get_equity_profile(emisor) + histórico precio."
        ),
        "panel_actual": len(panel),
        "candidatos_o_panel_corp": len([b for b in corp_bases if b.endswith("O")]),
        "emisores": {},
    }

    for key in keys:
        print(f"\n--- {EMISORES[key]['nombre']} ---", flush=True)
        res = descubrir_emisor(cliente, key, EMISORES[key], corp_bases, panel, args.pausa)
        reporte["emisores"][key] = res
        print(
            f"  Series confirmadas: {res['series_confirmadas_emisor']} | "
            f"Nuevas con precio: {res['tickers_nuevos_con_precio']} | "
            f"Clases nuevas: {res['clases_nuevas']}"
        )

    total_nuevas = sum(r["tickers_nuevos_con_precio"] for r in reporte["emisores"].values())
    reporte["resumen"] = {
        "emisores_analizados": len(keys),
        "tickers_nuevos_con_precio_total": total_nuevas,
    }

    out = args.json or RAIZ / "docs" / "data" / "descubrimiento_series.json"
    out.write_text(json.dumps(reporte, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nReporte: {out}")
    print(f"Total nuevos con precio (muestra): {total_nuevas}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
