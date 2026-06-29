"""
MEP venta histórico para conversión ars_peso → USD/100 del panel.

Fuente principal: ArgentinaDatos (dólar bolsa / MEP por fecha).
Respaldo: cache local docs/data/mep_historico.json (incluye MEP de cada fetch DolarAPI).
"""
from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

USER_AGENT = "cotizaciones-panel/1.0 (github.com/PabloPoletti/cotizaciones)"
ARGDATOS_BASE = "https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa"
MIN_INTERVAL_SEC = 0.15

RAIZ = Path(__file__).resolve().parent.parent.parent
ARCHIVO_CACHE = RAIZ / "docs" / "data" / "mep_historico.json"


def _cargar_cache() -> dict[str, Any]:
    if not ARCHIVO_CACHE.exists():
        return {"fuente": "mep_historico", "registros": {}}
    data = json.loads(ARCHIVO_CACHE.read_text(encoding="utf-8"))
    data.setdefault("registros", {})
    return data


def _guardar_cache(data: dict[str, Any]) -> None:
    ARCHIVO_CACHE.parent.mkdir(parents=True, exist_ok=True)
    out = {
        "fuente": data.get("fuente", "mep_historico"),
        "ultima_actualizacion": data.get("ultima_actualizacion"),
        "registros": data.get("registros", {}),
    }
    ARCHIVO_CACHE.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def registrar_mep_fetch(tipo_cambio: dict[str, Any] | None) -> None:
    """Persiste MEP venta del fetch actual (DolarAPI) indexado por fecha Argentina."""
    if not tipo_cambio or tipo_cambio.get("error"):
        return
    mep = tipo_cambio.get("mep") or {}
    venta = mep.get("venta_ars")
    if venta is None:
        return
    ts = str(tipo_cambio.get("timestamp_consulta") or "")[:10]
    if len(ts) != 10:
        ts = date.today().isoformat()
    cache = _cargar_cache()
    cache["registros"][ts] = {
        "venta_ars": float(venta),
        "fuente": "dolarapi.com",
        "timestamp_consulta": tipo_cambio.get("timestamp_consulta"),
    }
    cache["ultima_actualizacion"] = tipo_cambio.get("timestamp_consulta")
    _guardar_cache(cache)


def _fetch_argentinadatos(fecha: date) -> dict[str, Any] | None:
    path = fecha.strftime("%Y/%m/%d")
    url = f"{ARGDATOS_BASE}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        logger.debug("ArgentinaDatos MEP %s: %s", path, exc)
        return None


def consultar_mep_venta_fecha(
    fecha_iso: str,
    max_dias_atras: int = 7,
) -> tuple[float | None, str | None]:
    """
    MEP venta para YYYY-MM-DD.
    Devuelve (valor, fuente) con fuente argentinadatos.com | dolarapi.com | cache_local.
    """
    cache = _cargar_cache()
    registros = cache.get("registros") or {}

    if fecha_iso in registros and registros[fecha_iso].get("venta_ars"):
        return float(registros[fecha_iso]["venta_ars"]), str(registros[fecha_iso].get("fuente", "cache_local"))

    try:
        target = date.fromisoformat(fecha_iso)
    except ValueError:
        return None, None

    for offset in range(max_dias_atras + 1):
        d = target - timedelta(days=offset)
        key = d.isoformat()
        if key in registros and registros[key].get("venta_ars"):
            return float(registros[key]["venta_ars"]), str(registros[key].get("fuente", "cache_local"))

        if offset > 0:
            time.sleep(MIN_INTERVAL_SEC)
        raw = _fetch_argentinadatos(d)
        if not raw:
            continue
        venta = raw.get("venta")
        if venta is None:
            continue
        venta_f = float(venta)
        registros[key] = {
            "venta_ars": venta_f,
            "fuente": "argentinadatos.com",
            "fecha_cotizacion": raw.get("fecha") or key,
        }
        cache["registros"] = registros
        cache["ultima_actualizacion"] = key
        _guardar_cache(cache)
        if key == fecha_iso:
            return venta_f, "argentinadatos.com"
        if offset == 0:
            return venta_f, "argentinadatos.com"

    return None, None


def obtener_mep_ventas(
    fechas: list[str],
    fallback: float | None = None,
) -> tuple[dict[str, float], dict[str, str]]:
    """
    Mapa fecha → MEP venta para un conjunto de fechas (sin duplicar requests).
    Si falta una fecha, usa fallback con fuente fetch_actual_fallback.
    """
    unicas = sorted({f for f in fechas if f})
    valores: dict[str, float] = {}
    fuentes: dict[str, str] = {}

    for i, fecha in enumerate(unicas):
        if i > 0:
            time.sleep(MIN_INTERVAL_SEC)
        mep, fuente = consultar_mep_venta_fecha(fecha)
        if mep is not None and fuente:
            valores[fecha] = mep
            fuentes[fecha] = fuente
        elif fallback and fallback > 0:
            valores[fecha] = fallback
            fuentes[fecha] = "fetch_actual_fallback"

    return valores, fuentes
