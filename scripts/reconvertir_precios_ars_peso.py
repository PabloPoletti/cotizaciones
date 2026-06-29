#!/usr/bin/env python3
"""Reconvierte precios ars_peso (cotizaciones + histórico) con MEP por fecha."""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_cotizaciones import (  # noqa: E402
    INFO_FIJA,
    convertir_precio_raw_a_panel,
    convertir_serie_precios_a_panel,
    escala_precio_byma,
    metadata_conversion_ars_peso,
    tc_mep_venta,
)
from historico_precios import calcular_metricas, cargar_archivo, guardar_archivo  # noqa: E402
from providers.mep_historico import obtener_mep_ventas, registrar_mep_fetch  # noqa: E402

COT = RAIZ / "docs" / "data" / "cotizaciones.json"
MEP_FLAT_USADO = 1502.5  # MEP del fetch que aplicó conversión plana errónea


def parece_sin_convertir(precio: float) -> bool:
    return precio > 120000


def recuperar_serie_raw_ars(serie: list[dict], mep_flat: float) -> list[dict]:
    """Restaura *_ars en puntos convertidos con MEP único."""
    out: list[dict] = []
    ohlc = ("open", "high", "low", "close")
    for punto in serie:
        item = dict(punto)
        mep_prev = item.get("mep_venta") or mep_flat
        for col in ohlc:
            ars_key = f"{col}_ars"
            if item.get(ars_key) is not None:
                continue
            val = item.get(col)
            if val is None:
                continue
            if float(val) > 120000:
                item[ars_key] = round(float(val), 4)
            else:
                item[ars_key] = round(float(val) * float(mep_prev) / 1000, 4)
        out.append(item)
    return out


def reconverter_cotizaciones(tc_mep: float) -> int:
    data = json.loads(COT.read_text(encoding="utf-8"))
    registrar_mep_fetch(data.get("tipo_cambio"))
    n = 0
    for item in data.get("instrumentos", []):
        ticker = item.get("ticker", "")
        info = INFO_FIJA.get(ticker)
        if escala_precio_byma(info) != "ars_peso":
            continue
        precio = item.get("precio")
        if precio is None:
            continue
        raw = float(item.get("precio_byma_raw_ars") or precio)
        if not item.get("precio_byma_raw_ars") and not parece_sin_convertir(float(precio)):
            raw = float(precio) * tc_mep / 1000
        if not parece_sin_convertir(raw) and item.get("precio_byma_raw_ars"):
            raw = float(item["precio_byma_raw_ars"])
        if not parece_sin_convertir(raw):
            continue
        conv, escala = convertir_precio_raw_a_panel(raw, info, tc_mep)
        if conv is None:
            continue
        item["precio_byma_raw_ars"] = round(raw, 4)
        item["precio"] = conv
        item["precio_conversion"] = {
            "escala": escala,
            "tc_mep": tc_mep,
            "tc_mep_fuente": "dolarapi_fetch_actual",
            "usd_por_100": round(conv / 1000, 4),
        }
        bk = item.get("precio_backup")
        if bk and bk.get("precio") is not None:
            raw_bk = float(bk.get("precio_raw_ars") or bk["precio"])
            if not bk.get("precio_raw_ars") and float(bk["precio"]) <= 120000:
                raw_bk = float(bk["precio"]) * tc_mep / 1000
            conv_bk, _ = convertir_precio_raw_a_panel(raw_bk, info, tc_mep)
            if conv_bk is not None:
                bk["precio_raw_ars"] = round(raw_bk, 4)
                bk["precio"] = conv_bk
        n += 1
        print(f"  cot {ticker}: {raw:.0f} ARS -> panel {conv} (MEP fetch {tc_mep})")
    COT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return n


def reconverter_historico(tc_mep: float) -> int:
    data = cargar_archivo()
    dias_liq = data.get("dias_liquidez", 25)
    n = 0
    for ticker, block in data.get("instrumentos", {}).items():
        info = INFO_FIJA.get(ticker)
        if escala_precio_byma(info) != "ars_peso":
            continue
        serie = block.get("serie") or []
        if not serie:
            continue
        raw_serie = recuperar_serie_raw_ars(serie, MEP_FLAT_USADO)
        fechas = [str(p["date"]) for p in raw_serie]
        mep_map, mep_fuentes = obtener_mep_ventas(fechas, tc_mep)
        block["serie"] = convertir_serie_precios_a_panel(
            raw_serie, info, tc_mep, mep_map, mep_fuentes
        )
        block["metricas"] = calcular_metricas(block["serie"], dias_liq)
        block["conversion_ars_peso"] = metadata_conversion_ars_peso()
        n += 1
        ult = block["serie"][-1]
        print(
            f"  hist {ticker}: close_ars={ult.get('close_ars')} "
            f"MEP={ult.get('mep_venta')} ({ult.get('conversion_mep_fuente')}) "
            f"-> close={ult.get('close')}"
        )
    guardar_archivo(data)
    return n


def main() -> int:
    data = json.loads(COT.read_text(encoding="utf-8"))
    tc_mep = tc_mep_venta(data.get("tipo_cambio"))
    if not tc_mep:
        print("ERROR: sin MEP venta en cotizaciones.json", file=sys.stderr)
        return 1
    print(f"MEP fetch actual (spot): {tc_mep}")
    nc = reconverter_cotizaciones(tc_mep)
    nh = reconverter_historico(tc_mep)
    print(f"Listo: {nc} cotizaciones, {nh} series historicas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
