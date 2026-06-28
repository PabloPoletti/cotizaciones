"""
Tipo de cambio vía DolarAPI (https://dolarapi.com) — complementario a BYMA.
No reemplaza precios de instrumentos; solo referencia ARS/USD para el panel.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

BASE = "https://dolarapi.com/v1/dolares"
USER_AGENT = "cotizaciones-panel/1.0 (github.com/PabloPoletti/cotizaciones)"

ENDPOINTS = {
    "oficial": f"{BASE}/oficial",
    "mep": f"{BASE}/bolsa",
}


def _fetch_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _normalizar_cotizacion(data: dict[str, Any], endpoint: str, alias: str) -> dict[str, Any]:
    return {
        "alias": alias,
        "casa": data.get("casa"),
        "nombre": data.get("nombre"),
        "compra_ars": data.get("compra"),
        "venta_ars": data.get("venta"),
        "fecha_actualizacion_fuente": data.get("fechaActualizacion"),
        "endpoint": endpoint,
    }


def consultar_tipo_cambio(timestamp_consulta: str) -> dict[str, Any]:
    """
    Consulta dólar oficial y MEP (casa bolsa).
    Falla de forma aislada: devuelve error parcial sin lanzar excepción.
    """
    resultado: dict[str, Any] = {
        "fuente": "dolarapi.com",
        "timestamp_consulta": timestamp_consulta,
        "error": False,
        "mensaje_error": None,
    }
    errores: list[str] = []

    for alias, url in ENDPOINTS.items():
        try:
            raw = _fetch_json(url)
            resultado[alias] = _normalizar_cotizacion(raw, url, alias)
            logger.info(
                "  DolarAPI %s: compra=%s venta=%s (actualizado %s)",
                alias,
                raw.get("compra"),
                raw.get("venta"),
                raw.get("fechaActualizacion"),
            )
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            errores.append(f"{alias}: {exc}")
            logger.warning("  DolarAPI %s falló: %s", alias, exc)

    if errores:
        if len(errores) == len(ENDPOINTS):
            resultado["error"] = True
            resultado["mensaje_error"] = "; ".join(errores)
        else:
            resultado["error_parcial"] = True
            resultado["mensaje_error_parcial"] = "; ".join(errores)

    if "mep" in resultado:
        resultado["mep"]["nota"] = "DolarAPI casa=bolsa (dólar MEP / bolsa)"

    return resultado
