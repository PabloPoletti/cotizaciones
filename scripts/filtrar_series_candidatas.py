#!/usr/bin/env python3
"""Aplica criterios de inclusión a candidatos descubiertos (muestra 4 emisores)."""
from __future__ import annotations

import json
import math
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from pyobd import BymaData

from descubrir_series import EMISORES, MUESTRA_KEYS, descubrir_emisor

# Emisores pendientes tras la muestra inicial (YPF, Tecpetrol, Pan American, Genneia).
RESTO_KEYS = (
    "tgs",
    "edenor",
    "telecom",
    "irsa",
    "raghsa",
    "msu",
    "cordoba",
    "mendoza",
    "salta",
    "neuquen",
    "buenos_aires",
    "caba",
)
from historico_precios import DIAS_LIQUIDEZ_DEFAULT, calcular_metricas, df_a_serie, fetch_daily_history

RAIZ = Path(__file__).resolve().parent.parent
HIST = RAIZ / "docs" / "data" / "historico_precios.json"
INFO = RAIZ / "docs" / "data" / "info_fija.json"

VENC_MIN = date(2028, 1, 1)
VENC_IDEAL_MIN = date(2028, 1, 1)
VENC_IDEAL_MAX = date(2033, 12, 31)
MAX_POR_EMISOR = 3


def parse_fecha(s: str | None) -> date | None:
    if not s:
        return None
    s = str(s)[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def umbral_liquidez_panel() -> float | None:
    """Percentil 33 del volumen promedio del panel actual (= límite 'baja' liquidez)."""
    hp = json.loads(HIST.read_text(encoding="utf-8"))
    info = json.loads(INFO.read_text(encoding="utf-8"))
    panel = {k for k in info if not k.startswith("_")}
    vols = sorted(
        hp.get("instrumentos", {}).get(t, {}).get("metricas", {}).get("volumen_promedio")
        for t in panel
        if hp.get("instrumentos", {}).get(t, {}).get("metricas", {}).get("volumen_promedio")
    )
    vols = [v for v in vols if v and v > 0]
    if len(vols) < 3:
        return None
    idx = math.floor(len(vols) * 0.33)
    return vols[idx]


def volumen_candidato(cliente: BymaData, ticker: str, ventana: int = 90) -> tuple[float | None, dict]:
    fin = date.today()
    inicio = fin - timedelta(days=ventana)
    df, sim = fetch_daily_history(cliente, ticker, inicio.isoformat(), fin.isoformat())
    if df is None or len(df) == 0:
        return None, {}
    serie = df_a_serie(df)
    m = calcular_metricas(serie, DIAS_LIQUIDEZ_DEFAULT)
    return m.get("volumen_promedio"), m


def puntaje_candidato(venc: date | None, vol: float | None, p33: float | None) -> float:
    if venc is None or vol is None:
        return -1.0
    score = math.log10(max(vol, 1))
    if VENC_IDEAL_MIN <= venc <= VENC_IDEAL_MAX:
        score += 2.0
    elif venc >= VENC_MIN:
        score += 0.5
    if p33 and vol >= p33 * 2:
        score += 0.5
    return score


def filtrar_emisor(candidatos: list[dict], p33: float | None, cliente: BymaData, pausa: float) -> dict:
    rechazados: list[dict] = []
    pool: list[dict] = []

    for s in candidatos:
        if s.get("en_panel"):
            continue
        if not s.get("tiene_precio"):
            rechazados.append({**s, "motivo": "sin precio BYMA"})
            continue
        venc = parse_fecha(s.get("vencimiento"))
        if venc is None or venc < VENC_MIN:
            rechazados.append({**s, "motivo": f"vencimiento {s.get('vencimiento')} < 2028"})
            continue

        vol, metricas = volumen_candidato(cliente, s["ticker"])
        time.sleep(pausa * 0.3)
        if vol is None:
            rechazados.append({**s, "motivo": "sin volumen histórico"})
            continue
        if p33 is not None and vol < p33:
            rechazados.append(
                {**s, "motivo": f"liquidez baja (vol prom {vol:.0f} < p33 panel {p33:.0f})", "volumen_promedio": vol}
            )
            continue

        enriched = {
            **s,
            "vencimiento_date": venc.isoformat(),
            "volumen_promedio": vol,
            "ultimo_cierre": metricas.get("ultimo_cierre"),
            "puntaje": puntaje_candidato(venc, vol, p33),
        }
        pool.append(enriched)

    pool.sort(key=lambda x: (-x["puntaje"], -x["volumen_promedio"], x["vencimiento_date"]))
    seleccionados = pool[:MAX_POR_EMISOR]
    return {
        "candidatos_nuevos_con_precio": len([s for s in candidatos if not s["en_panel"] and s.get("tiene_precio")]),
        "rechazados": rechazados,
        "aprobados_pool": pool,
        "seleccionados": seleccionados,
    }


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Filtra candidatos descubiertos por criterios de inclusión.")
    ap.add_argument(
        "--grupo",
        choices=("muestra", "resto", "all"),
        default="resto",
        help="muestra=4 emisores iniciales; resto=12 emisores pendientes; all=todos",
    )
    ap.add_argument("--json", type=Path, help="Ruta del reporte JSON de salida")
    args = ap.parse_args()

    if args.grupo == "muestra":
        keys = MUESTRA_KEYS
        default_out = RAIZ / "docs" / "data" / "descubrimiento_filtrado_muestra.json"
    elif args.grupo == "resto":
        keys = RESTO_KEYS
        default_out = RAIZ / "docs" / "data" / "descubrimiento_filtrado_resto.json"
    else:
        keys = tuple(EMISORES.keys())
        default_out = RAIZ / "docs" / "data" / "descubrimiento_filtrado_all.json"
    out = args.json or default_out

    panel = {k for k in json.loads(INFO.read_text(encoding="utf-8")) if not k.startswith("_")}
    p33 = umbral_liquidez_panel()
    print(f"Grupo: {args.grupo} ({len(keys)} emisores)")
    print(f"Umbral liquidez (p33 panel, {len(panel)} inst.): {p33}")

    cliente = BymaData()
    corp = cliente.get_corporate_bonds()
    corp_bases = {str(s).split(".")[0].upper() for s in corp["symbol"]}

    reporte = {
        "fecha": datetime.now().isoformat(),
        "grupo": args.grupo,
        "criterios": {
            "vencimiento_minimo": "2028-01-01",
            "liquidez_minima": f"volumen_promedio >= p33 panel ({p33})",
            "max_por_emisor": MAX_POR_EMISOR,
            "ventana_vencimiento_ideal": "2028-2033",
        },
        "emisores": {},
        "resumen": {},
    }

    total_sel = 0
    for key in keys:
        cfg = EMISORES[key]
        desc = descubrir_emisor(cliente, key, cfg, corp_bases, panel, 0.08)
        filtrado = filtrar_emisor(desc["series"], p33, cliente, 0.08)
        reporte["emisores"][key] = {
            "nombre": cfg["nombre"],
            "en_panel": [s["ticker"] for s in desc["series"] if s["en_panel"]],
            **filtrado,
        }
        total_sel += len(filtrado["seleccionados"])
        print(f"\n{cfg['nombre']}:")
        print(f"  Candidatos nuevos con precio: {filtrado['candidatos_nuevos_con_precio']}")
        print(f"  Rechazados: {len(filtrado['rechazados'])} | Pool OK: {len(filtrado['aprobados_pool'])} | Seleccionados: {len(filtrado['seleccionados'])}")
        for s in filtrado["seleccionados"]:
            print(
                f"    + {s['ticker']} — venc {s['vencimiento_date']} — "
                f"vol prom {s['volumen_promedio']:.0f} — {s.get('clase', '')}"
            )

    reporte["resumen"] = {
        "series_seleccionadas_total": total_sel,
        "instrumentos_panel_antes": len(panel),
        "instrumentos_panel_despues_estimado": len(panel) + total_sel,
    }
    out.write_text(json.dumps(reporte, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nReporte: {out}")
    print(f"Total seleccionadas: {total_sel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
