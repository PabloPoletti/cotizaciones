"""
Precios de respaldo vía Data912 (https://data912.com) — complementario a BYMA.
No reemplaza el precio principal del panel; solo precio_backup + trazabilidad.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

BASE = "https://data912.com/live"
USER_AGENT = "cotizaciones-panel/1.0 (github.com/PabloPoletti/cotizaciones)"
PANELS = ("arg_bonds", "arg_corp", "arg_notes", "arg_cedears")
MIN_INTERVAL_SEC = 0.5  # ~120 req/min máx.; aquí usamos 2 requests por corrida


def _fetch_panel(path: str) -> list[dict[str, Any]]:
    url = f"{BASE}/{path}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"Data912 {path}: respuesta inesperada ({type(data).__name__})")
    return data


def _normalizar_fila(row: dict[str, Any], panel: str) -> dict[str, Any]:
    return {
        "precio": row.get("c"),
        "px_bid": row.get("px_bid"),
        "px_ask": row.get("px_ask"),
        "pct_change": row.get("pct_change"),
        "volumen": row.get("v"),
        "panel": panel,
        "fuente": "data912.com",
    }


def consultar_precios_backup(tickers: list[str]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """
    Descarga paneles arg_bonds, arg_corp, arg_notes y arg_cedears y arma lookup por ticker.
    Devuelve (mapa ticker → backup, metadatos de la consulta).
    """
    meta: dict[str, Any] = {
        "fuente": "data912.com",
        "paneles_consultados": list(PANELS),
        "error": False,
        "mensaje_error": None,
    }
    lookup: dict[str, dict[str, Any]] = {}
    errores: list[str] = []

    for i, panel in enumerate(PANELS):
        if i > 0:
            time.sleep(MIN_INTERVAL_SEC)
        try:
            filas = _fetch_panel(panel)
            meta[f"filas_{panel}"] = len(filas)
            for row in filas:
                sym = str(row.get("symbol", "")).strip().upper()
                if not sym:
                    continue
                lookup[sym] = _normalizar_fila(row, panel)
            logger.info("  Data912 %s: %s instrumentos", panel, len(filas))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
            errores.append(f"{panel}: {exc}")
            logger.warning("  Data912 %s falló: %s", panel, exc)

    if errores:
        meta["error_parcial"] = True
        meta["mensaje_error_parcial"] = "; ".join(errores)
        if len(errores) == len(PANELS):
            meta["error"] = True
            meta["mensaje_error"] = meta["mensaje_error_parcial"]

    tickers_set = {t.upper() for t in tickers}
    encontrados = {t: lookup[t] for t in tickers_set if t in lookup}
    meta["tickers_solicitados"] = len(tickers_set)
    meta["tickers_encontrados"] = len(encontrados)

    return encontrados, meta


def enriquecer_con_backup(
    instrumentos: list[dict[str, Any]],
    backup: dict[str, dict[str, Any]],
    info_fija: dict[str, dict[str, Any]] | None = None,
    tc_mep: float | None = None,
) -> None:
    """Agrega precio_backup y fuentes_consultadas sin modificar precio BYMA."""
    from fetch_cotizaciones import convertir_precio_raw_a_panel, escala_precio_byma

    for item in instrumentos:
        fuentes = ["byma"]
        ticker = str(item.get("ticker", "")).upper()
        bk = backup.get(ticker)
        if bk and bk.get("precio") is not None:
            info = (info_fija or {}).get(ticker)
            raw = float(bk["precio"])
            conv, escala = convertir_precio_raw_a_panel(raw, info, tc_mep)
            backup_out = dict(bk)
            if escala == "ars_peso" and conv is not None:
                backup_out["precio_raw_ars"] = round(raw, 4)
                backup_out["precio"] = conv
                for campo in ("px_bid", "px_ask"):
                    if backup_out.get(campo) is not None:
                        c, _ = convertir_precio_raw_a_panel(float(backup_out[campo]), info, tc_mep)
                        if c is not None:
                            backup_out[campo] = c
            item["precio_backup"] = backup_out
            fuentes.append("data912")
        item["fuentes_consultadas"] = fuentes
