#!/usr/bin/env python3
"""
Histórico diario BYMA (OHLCV) y métricas derivadas para el panel.
Bootstrap: carga ~90 días una vez. Incremental: merge de últimos días solamente.
"""

from __future__ import annotations

import json
import logging
import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
from pyobd import BymaData

from fetch_cotizaciones import (
    INSTRUMENTOS,
    RAIZ_REPO,
    TZ_ARGENTINA,
    ahora_iso_argentina,
    configurar_sesion_byma,
    con_reintentos,
)

ARCHIVO_HISTORICO = RAIZ_REPO / "docs" / "data" / "historico_precios.json"
VENTANA_DIAS_DEFAULT = 90
DIAS_LIQUIDEZ_DEFAULT = 25
DIAS_INCREMENTAL = 5

logger = logging.getLogger(__name__)


def simbolos_byma(ticker: str) -> list[str]:
    """Variantes de símbolo que usa BYMA para bonos/ONs."""
    return [f"{ticker} 24HS", f"{ticker} CI", ticker]


def fetch_daily_history(
    cliente: BymaData,
    ticker: str,
    from_date: str,
    to_date: str,
) -> tuple[pd.DataFrame | None, str | None]:
    """Trae histórico diario probando sufijos BYMA."""
    for simbolo in simbolos_byma(ticker):
        try:
            df = con_reintentos(
                f"history-{simbolo}",
                lambda s=simbolo: cliente.get_daily_history(s, from_date, to_date),
            )
            if df is None or len(df) == 0:
                logger.info("  %s histórico %s: sin filas", ticker, simbolo)
                continue
            df = df.copy()
            df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
            df = df[df["close"] > 0]
            if len(df) == 0:
                continue
            logger.info("  %s: %s filas vía %s", ticker, len(df), simbolo)
            return df, simbolo
        except Exception as exc:  # noqa: BLE001
            logger.warning("  %s histórico %s: %s", ticker, simbolo, exc)
    return None, None


def df_a_serie(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Convierte DataFrame BYMA a lista JSON compacta."""
    serie: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        vol = row.get("volume")
        item: dict[str, Any] = {
            "date": str(row["date"]),
            "open": round(float(row["open"]), 4),
            "high": round(float(row["high"]), 4),
            "low": round(float(row["low"]), 4),
            "close": round(float(row["close"]), 4),
            "volume": round(float(vol), 2) if vol is not None and not pd.isna(vol) else 0.0,
        }
        serie.append(item)
    return serie


def merge_series(existing: list[dict], incoming: list[dict]) -> list[dict]:
    """Merge por fecha; incoming pisa duplicados."""
    by_date: dict[str, dict] = {p["date"]: p for p in existing}
    for p in incoming:
        by_date[p["date"]] = p
    return [by_date[d] for d in sorted(by_date.keys())]


def trim_series(serie: list[dict], ventana_dias: int) -> list[dict]:
    if not serie:
        return serie
    corte = (date.today() - timedelta(days=ventana_dias)).isoformat()
    return [p for p in serie if p["date"] >= corte]


def dias_habiles_con_volumen(serie: list[dict], limite: int) -> list[float]:
    """Últimos N días con volumen > 0 (más recientes primero)."""
    vols = [p["volume"] for p in reversed(serie) if p.get("volume", 0) > 0]
    return vols[:limite]


def close_en_fecha(serie: list[dict], target: date) -> float | None:
    key = target.isoformat()
    for p in reversed(serie):
        if p["date"] == key:
            return float(p["close"])
    return None


def close_mas_cercano(serie: list[dict], target: date, max_dias: int = 7) -> float | None:
    """Cierre en target o el día anterior más cercano (hasta max_dias)."""
    for offset in range(max_dias + 1):
        c = close_en_fecha(serie, target - timedelta(days=offset))
        if c is not None:
            return c
    return None


def variacion_pct(desde: float | None, hasta: float | None) -> float | None:
    if desde is None or hasta is None or desde == 0:
        return None
    return round((hasta - desde) / desde * 100, 2)


def calcular_metricas(serie: list[dict], dias_liquidez: int) -> dict[str, Any]:
    if not serie:
        return {}

    hoy = date.today()
    ultimo_close = float(serie[-1]["close"])
    inicio_close = float(serie[0]["close"])

    vols = dias_habiles_con_volumen(serie, dias_liquidez)
    vol_prom = round(sum(vols) / len(vols), 2) if vols else None

    c7 = close_mas_cercano(serie, hoy - timedelta(days=7))
    c30 = close_mas_cercano(serie, hoy - timedelta(days=30))

    closes = [float(p["close"]) for p in serie[-31:]]
    retornos: list[float] = []
    for i in range(1, len(closes)):
        prev = closes[i - 1]
        if prev > 0:
            retornos.append((closes[i] - prev) / prev * 100)
    volatilidad = None
    if len(retornos) >= 5:
        media = sum(retornos) / len(retornos)
        var = sum((r - media) ** 2 for r in retornos) / len(retornos)
        volatilidad = round(math.sqrt(var), 2)

    max_close = closes[0] if closes else ultimo_close
    drawdown_min = 0.0
    precio_max = max_close
    for c in closes:
        if c > max_close:
            max_close = c
        if max_close > 0:
            dd = (c - max_close) / max_close * 100
            if dd < drawdown_min:
                drawdown_min = dd
        precio_max = max(precio_max, c)

    return {
        "volumen_promedio": vol_prom,
        "var_7d_pct": variacion_pct(c7, ultimo_close),
        "var_30d_pct": variacion_pct(c30, ultimo_close),
        "var_desde_inicio_pct": variacion_pct(inicio_close, ultimo_close),
        "volatilidad_30d_pct": volatilidad,
        "drawdown_max_pct": round(drawdown_min, 2) if closes else None,
        "precio_max_ventana": round(precio_max, 4) if closes else None,
        "fecha_inicio_serie": serie[0]["date"],
        "ultimo_cierre": round(ultimo_close, 4),
        "ultima_fecha": serie[-1]["date"],
    }


def cargar_archivo() -> dict[str, Any]:
    if not ARCHIVO_HISTORICO.exists():
        return {
            "ultima_actualizacion": None,
            "ventana_dias": VENTANA_DIAS_DEFAULT,
            "dias_liquidez": DIAS_LIQUIDEZ_DEFAULT,
            "instrumentos": {},
        }
    data = json.loads(ARCHIVO_HISTORICO.read_text(encoding="utf-8"))
    data.pop("_comentario", None)
    data.setdefault("instrumentos", {})
    return data


def guardar_archivo(data: dict[str, Any]) -> None:
    ARCHIVO_HISTORICO.parent.mkdir(parents=True, exist_ok=True)
    out = {
        "ultima_actualizacion": data.get("ultima_actualizacion"),
        "ventana_dias": data.get("ventana_dias", VENTANA_DIAS_DEFAULT),
        "dias_liquidez": data.get("dias_liquidez", DIAS_LIQUIDEZ_DEFAULT),
        "instrumentos": data.get("instrumentos", {}),
    }
    with ARCHIVO_HISTORICO.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")


def procesar_ticker(
    cliente: BymaData,
    ticker: str,
    from_date: str,
    to_date: str,
    existente: dict | None,
    ventana_dias: int,
    dias_liquidez: int,
) -> dict[str, Any]:
    df, simbolo = fetch_daily_history(cliente, ticker, from_date, to_date)
    prev_serie = (existente or {}).get("serie") or []
    prev_simbolo = (existente or {}).get("simbolo_byma")

    if df is None:
        if prev_serie:
            serie = trim_series(prev_serie, ventana_dias)
            metricas = calcular_metricas(serie, dias_liquidez)
            return {
                "simbolo_byma": prev_simbolo,
                "error": None,
                "metricas": metricas,
                "serie": serie,
            }
        return {
            "simbolo_byma": None,
            "error": "Sin histórico BYMA",
            "metricas": {},
            "serie": [],
        }

    incoming = df_a_serie(df)
    serie = trim_series(merge_series(prev_serie, incoming), ventana_dias)
    metricas = calcular_metricas(serie, dias_liquidez)
    return {
        "simbolo_byma": simbolo,
        "error": None,
        "metricas": metricas,
        "serie": serie,
    }


def ejecutar_bootstrap(ventana_dias: int = VENTANA_DIAS_DEFAULT) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    fin = datetime.now(TZ_ARGENTINA).date()
    inicio = fin - timedelta(days=ventana_dias + 10)

    logger.info("=== Bootstrap histórico BYMA (%s días) ===", ventana_dias)
    cliente = BymaData()
    configurar_sesion_byma(cliente)

    data = cargar_archivo()
    data["ventana_dias"] = ventana_dias
    data["dias_liquidez"] = DIAS_LIQUIDEZ_DEFAULT
    data["instrumentos"] = {}

    from_str = inicio.isoformat()
    to_str = fin.isoformat()

    for i, inst in enumerate(INSTRUMENTOS, 1):
        ticker = inst["ticker"]
        logger.info("[%s/%s] Bootstrap %s…", i, len(INSTRUMENTOS), ticker)
        data["instrumentos"][ticker] = procesar_ticker(
            cliente,
            ticker,
            from_str,
            to_str,
            None,
            ventana_dias,
            DIAS_LIQUIDEZ_DEFAULT,
        )

    data["ultima_actualizacion"] = ahora_iso_argentina()
    guardar_archivo(data)
    ok = sum(1 for v in data["instrumentos"].values() if v.get("serie"))
    logger.info("=== Bootstrap finalizado: %s/%s con serie ===", ok, len(INSTRUMENTOS))
    logger.info("Guardado en %s", ARCHIVO_HISTORICO)
    return 0


def ejecutar_incremental() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    fin = datetime.now(TZ_ARGENTINA).date()
    inicio = fin - timedelta(days=DIAS_INCREMENTAL)

    logger.info("=== Actualización incremental histórico BYMA ===")
    cliente = BymaData()
    configurar_sesion_byma(cliente)

    data = cargar_archivo()
    ventana = data.get("ventana_dias", VENTANA_DIAS_DEFAULT)
    dias_liq = data.get("dias_liquidez", DIAS_LIQUIDEZ_DEFAULT)
    instrumentos = data.setdefault("instrumentos", {})

    from_str = inicio.isoformat()
    to_str = fin.isoformat()

    for i, inst in enumerate(INSTRUMENTOS, 1):
        ticker = inst["ticker"]
        logger.info("[%s/%s] Incremental %s…", i, len(INSTRUMENTOS), ticker)
        existente = instrumentos.get(ticker)
        instrumentos[ticker] = procesar_ticker(
            cliente,
            ticker,
            from_str,
            to_str,
            existente,
            ventana,
            dias_liq,
        )

    data["ultima_actualizacion"] = ahora_iso_argentina()
    guardar_archivo(data)
    ok = sum(1 for v in instrumentos.values() if v.get("serie"))
    logger.info("=== Incremental finalizado: %s/%s con serie ===", ok, len(INSTRUMENTOS))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("bootstrap", "incremental"):
        print("Uso: python scripts/historico_precios.py bootstrap|incremental [--dias N]", file=sys.stderr)
        sys.exit(1)

    if sys.argv[1] == "bootstrap":
        dias = VENTANA_DIAS_DEFAULT
        if "--dias" in sys.argv:
            dias = int(sys.argv[sys.argv.index("--dias") + 1])
        sys.exit(ejecutar_bootstrap(dias))
    sys.exit(ejecutar_incremental())
