#!/usr/bin/env python3
"""
Consulta cotizaciones de ONs y bonos soberanos vía BYMA Open Data (PyOBD)
y guarda el resultado en docs/data/cotizaciones.json para GitHub Pages.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

import pandas as pd
from pyobd import BymaData

# Ruta de salida relativa a la raíz del repositorio
RAIZ_REPO = Path(__file__).resolve().parent.parent
ARCHIVO_SALIDA = RAIZ_REPO / "docs" / "data" / "cotizaciones.json"

# Zona horaria del mercado argentino
TZ_ARGENTINA = ZoneInfo("America/Argentina/Buenos_Aires")

# Reintentos para errores de red / HTTP transitorios
MAX_REINTENTOS = int(os.environ.get("BYMA_MAX_RETRIES", "3"))
ESPERA_REINTENTO_SEG = float(os.environ.get("BYMA_RETRY_DELAY", "2.0"))

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
)
logger = logging.getLogger(__name__)

# Especies a consultar: se cargan desde docs/data/info_fija.json (fuente única).
# YMCUO fue removido: ticker existe en mercado pero NO en BYMA Open Data gratuito.


def cargar_meta_info_fija() -> dict[str, dict[str, Any]]:
    """Metadatos completos por ticker desde info_fija.json."""
    ruta = RAIZ_REPO / "docs" / "data" / "info_fija.json"
    data = json.loads(ruta.read_text(encoding="utf-8"))
    return {
        k: v for k, v in data.items() if not k.startswith("_") and isinstance(v, dict)
    }


INFO_FIJA = cargar_meta_info_fija()


def escala_precio_byma(info: dict[str, Any] | None) -> str:
    """
    usd_mil — BYMA devuelve USD por 100 nominal × 1000 (AL/GD canje).
    ars_peso — BYMA devuelve cotización en pesos (pantalla BCBA); convertir con MEP.
    """
    if not info:
        return "usd_mil"
    return str(info.get("precio_byma_escala") or "usd_mil")


def tc_mep_venta(tipo_cambio: dict[str, Any] | None) -> float | None:
    if not tipo_cambio or tipo_cambio.get("error"):
        return None
    mep = tipo_cambio.get("mep") or {}
    try:
        v = mep.get("venta_ars")
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def convertir_precio_raw_a_panel(
    raw: float | None,
    info: dict[str, Any] | None,
    tc_mep: float | None,
) -> tuple[float | None, str | None]:
    """Normaliza precio BYMA/Data912 al formato interno del panel (USD/100 × 1000)."""
    if raw is None or raw <= 0:
        return None, None
    if escala_precio_byma(info) == "ars_peso":
        if not tc_mep or tc_mep <= 0:
            return None, "sin_tipo_cambio"
        usd_por_100 = raw / tc_mep
        return round(usd_por_100 * 1000, 4), "ars_peso"
    return round(float(raw), 4), "usd_mil"


def convertir_serie_precios_a_panel(
    serie: list[dict[str, Any]],
    info: dict[str, Any] | None,
    tc_mep: float | None = None,
    mep_por_fecha: dict[str, float] | None = None,
    mep_fuentes: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Convierte OHLC BYMA (ARS) al formato panel; guarda *_ars y mep_venta por punto."""
    if escala_precio_byma(info) != "ars_peso":
        return serie

    mep_map = mep_por_fecha or {}
    fuente_map = mep_fuentes or {}
    ohlc = ("open", "high", "low", "close")
    out: list[dict[str, Any]] = []

    for punto in serie:
        item = dict(punto)
        fecha = str(item.get("date", ""))
        mep = mep_map.get(fecha) or tc_mep
        if not mep or mep <= 0:
            out.append(item)
            continue

        mep_previo = item.get("mep_venta")
        for col in ohlc:
            ars_key = f"{col}_ars"
            raw: float | None = None
            if item.get(ars_key) is not None:
                raw = float(item[ars_key])
            elif item.get(col) is not None:
                val = float(item[col])
                if val > 120000:
                    raw = val
                elif mep_previo:
                    raw = val * float(mep_previo) / 1000
                elif tc_mep:
                    raw = val * tc_mep / 1000
            if raw is not None:
                item[ars_key] = round(raw, 4)
                item[col] = round(raw / mep * 1000, 4)

        item["mep_venta"] = mep
        item["conversion_mep_fuente"] = fuente_map.get(fecha, "fetch_actual_fallback")
        out.append(item)
    return out


def metadata_conversion_ars_peso() -> dict[str, str]:
    return {
        "escala": "ars_peso",
        "mep_fuente": "argentinadatos.com + cache mep_historico.json",
        "mep_aplicacion": "por_fecha_en_cada_punto",
        "nota": (
            "Precios BYMA en pesos (pantalla BCBA) convertidos a USD/100 del panel "
            "con MEP venta del dia de cada cierre."
        ),
    }


def cargar_instrumentos_desde_info_fija() -> list[dict[str, str]]:
    """Lee tickers activos del panel desde info_fija.json."""
    ruta = RAIZ_REPO / "docs" / "data" / "info_fija.json"
    if not ruta.exists():
        raise FileNotFoundError(f"No se encontró {ruta}")
    data = json.loads(ruta.read_text(encoding="utf-8"))
    instrumentos: list[dict[str, str]] = []
    for ticker, meta in sorted(data.items()):
        if ticker.startswith("_") or not isinstance(meta, dict):
            continue
        instrumentos.append(
            {
                "ticker": ticker,
                "nombre": meta.get("nombre", ticker),
                "sector": meta.get("sector", "Otros"),
            }
        )
    return instrumentos


INSTRUMENTOS = cargar_instrumentos_desde_info_fija()

# Tipos de liquidación a probar (en orden de preferencia)
LIQUIDACIONES = ("CI", "24HS")

# Feriados inamovibles Argentina (respaldo si falla get_market_time)
FERIADOS_ARG_2026 = {
    "2026-01-01",
    "2026-02-16",
    "2026-02-17",
    "2026-03-24",
    "2026-04-02",
    "2026-04-03",
    "2026-05-01",
    "2026-05-25",
    "2026-06-17",
    "2026-07-09",
    "2026-08-17",
    "2026-10-12",
    "2026-11-20",
    "2026-12-08",
    "2026-12-25",
}


def ahora_iso_argentina() -> str:
    """Devuelve timestamp ISO8601 en hora Argentina."""
    return datetime.now(TZ_ARGENTINA).isoformat(timespec="seconds")


def configurar_sesion_byma(cliente: BymaData) -> None:
    """Refuerza headers de navegador real (PyOBD ya trae base; actualizamos UA)."""
    cliente.session.session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
            "Referer": "https://open.bymadata.com.ar/",
        }
    )


def con_reintentos(
    etiqueta: str,
    funcion: Callable[[], Any],
    max_intentos: int = MAX_REINTENTOS,
) -> Any:
    """Ejecuta una llamada a BYMA con reintentos y backoff ante errores de red."""
    ultimo_error: Exception | None = None
    for intento in range(1, max_intentos + 1):
        try:
            return funcion()
        except Exception as exc:  # noqa: BLE001
            ultimo_error = exc
            if intento < max_intentos:
                espera = ESPERA_REINTENTO_SEG * intento
                logger.warning(
                    "  [%s] intento %s/%s falló: %s — reintento en %.1fs",
                    etiqueta,
                    intento,
                    max_intentos,
                    exc,
                    espera,
                )
                time.sleep(espera)
            else:
                logger.error(
                    "  [%s] agotados %s intentos: %s",
                    etiqueta,
                    max_intentos,
                    exc,
                )
    raise ultimo_error  # type: ignore[misc]


def valor_positivo(fila: pd.Series, columna: str) -> float | None:
    """Lee una columna numérica de BYMA si es > 0."""
    if columna not in fila.index:
        return None
    valor = fila[columna]
    if valor is None:
        return None
    try:
        numerico = float(valor)
    except (TypeError, ValueError):
        return None
    if numerico > 0:
        return round(numerico, 4)
    return None


def valor_numerico(fila: pd.Series, columna: str) -> float | None:
    """Lee una columna numérica BYMA (puede ser 0)."""
    if columna not in fila.index:
        return None
    valor = fila[columna]
    if valor is None:
        return None
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def hay_actividad_intradia(fila: pd.Series) -> bool:
    """
    Evidencia de operación en la rueda del día (no basta settlement/closing sin volumen).
    Issue #1: evitar marcar intradía cuando BYMA devuelve ceros de precio pero campos de cierre.
    """
    for columna in ("volume", "tradeVolume", "volumeAmount", "numberOfOrders"):
        v = valor_numerico(fila, columna)
        if v is not None and v > 0:
            return True
    trade = valor_numerico(fila, "trade")
    return trade is not None and trade > 0


def extraer_precio_intradia(fila: pd.Series) -> float | None:
    """Precio intradiario solo si hubo actividad real; no usa closingPrice (suele arrastrar cierre)."""
    if not hay_actividad_intradia(fila):
        return None
    for columna in ("trade", "settlementPrice", "vwap"):
        precio = valor_positivo(fila, columna)
        if precio is not None:
            return precio
    return None


def extraer_precio_cierre_anterior(fila: pd.Series) -> float | None:
    """Cierre anterior reportado en la cotización actual."""
    for columna in ("previousClosingPrice", "previousSettlementPrice"):
        precio = valor_positivo(fila, columna)
        if precio is not None:
            return precio
    return None


def evaluar_estado_mercado(cliente: BymaData) -> dict[str, Any]:
    """
    Determina si el mercado está cerrado (fin de semana, feriado o BYMA no laborable).
    Usa get_market_time() como fuente principal y feriados locales como respaldo.
    """
    ahora = datetime.now(TZ_ARGENTINA)
    fecha_hoy = ahora.date().isoformat()
    es_fin_semana = ahora.weekday() >= 5
    es_feriado_local = fecha_hoy in FERIADOS_ARG_2026

    info_byma: dict[str, Any] = {}
    es_dia_habil_byma: bool | None = None
    error_byma: str | None = None

    try:
        info_byma = con_reintentos("market-time", lambda: cliente.get_market_time())
        if "isWorkingDay" in info_byma:
            es_dia_habil_byma = bool(info_byma["isWorkingDay"])
        logger.info(
            "  BYMA market-time: isWorkingDay=%s apertura=%s cierre=%s",
            info_byma.get("isWorkingDay"),
            info_byma.get("marketOpeningTime"),
            info_byma.get("marketClosingTime"),
        )
    except Exception as exc:  # noqa: BLE001
        error_byma = str(exc)
        logger.warning("  No se pudo consultar market-time: %s", exc)

    if es_fin_semana:
        motivo = "fin de semana"
    elif es_dia_habil_byma is False:
        motivo = "feriado o día no laborable (BYMA)"
    elif es_feriado_local:
        motivo = f"feriado argentino ({fecha_hoy})"
    elif es_dia_habil_byma is True:
        motivo = None
    else:
        # Sin respuesta BYMA: conservador con fin de semana / feriado local
        motivo = "fin de semana" if es_fin_semana else (
            f"feriado argentino ({fecha_hoy})" if es_feriado_local else None
        )

    mercado_cerrado = motivo is not None

    return {
        "mercado_cerrado": mercado_cerrado,
        "motivo_mercado_cerrado": motivo,
        "es_fin_semana": es_fin_semana,
        "es_feriado_local": es_feriado_local,
        "is_working_day_byma": es_dia_habil_byma,
        "market_time_byma": info_byma,
        "error_market_time": error_byma,
        "fecha_consulta": fecha_hoy,
        "hora_consulta_art": ahora.strftime("%H:%M"),
    }


def cargar_paneles(cliente: BymaData) -> pd.DataFrame:
    """Carga paneles de ONs y bonos soberanos como respaldo."""
    partes = []
    for metodo in ("get_corporate_bonds", "get_government_bonds"):
        try:
            df = con_reintentos(metodo, lambda m=metodo: getattr(cliente, m)())
            if df is not None and len(df) > 0:
                partes.append(df)
                logger.info("  Panel %s: %s filas", metodo, len(df))
        except Exception as exc:  # noqa: BLE001
            logger.warning("  Panel %s no disponible: %s", metodo, exc)
    if not partes:
        return pd.DataFrame()
    return pd.concat(partes, ignore_index=True)


def buscar_en_panel(paneles: pd.DataFrame, ticker: str) -> dict | None:
    """Busca un ticker en los paneles BYMA."""
    if paneles.empty or "symbol" not in paneles.columns:
        return None
    filas = paneles[paneles["symbol"] == ticker]
    if filas.empty:
        return None
    for _, fila in filas.iterrows():
        if extraer_precio_intradia(fila) or extraer_precio_cierre_anterior(fila):
            return fila.to_dict()
    return filas.iloc[0].to_dict()


def obtener_cotizacion(
    cliente: BymaData, ticker: str, paneles: pd.DataFrame
) -> tuple[dict | None, list[str]]:
    """
    Consulta cotización probando liquidaciones CI / 24HS.
    Devuelve la fila y un log de diagnóstico por liquidación.
    """
    ultimo_error: str | None = None
    diagnostico: list[str] = []

    for liquidacion in LIQUIDACIONES:
        try:
            df = con_reintentos(
                f"quote-{ticker}-{liquidacion}",
                lambda liq=liquidacion: cliente.get_current_quote(ticker, settlement=liq),
            )
            if df is not None and len(df) > 0:
                fila = df.iloc[0]
                diag = (
                    f"{liquidacion}: settlement={fila.get('settlementPrice')} "
                    f"trade={fila.get('trade')} prevClose={fila.get('previousClosingPrice')}"
                )
                diagnostico.append(diag)
                logger.info("    %s", diag)
                return fila.to_dict(), diagnostico
            diagnostico.append(f"{liquidacion}: sin filas")
        except Exception as exc:  # noqa: BLE001
            ultimo_error = str(exc)
            diagnostico.append(f"{liquidacion}: ERROR {exc}")
            logger.warning("    %s: %s", liquidacion, exc)

    fila_panel = buscar_en_panel(paneles, ticker)
    if fila_panel is not None:
        diagnostico.append("panel: fila encontrada")
        logger.info("    panel: usando fila del panel general")
        return fila_panel, diagnostico

    if ultimo_error:
        raise RuntimeError(ultimo_error)
    return None, diagnostico


def obtener_ultimo_cierre_historico(
    cliente: BymaData, ticker: str
) -> tuple[float | None, str | None, str | None]:
    """
    Último cierre desde histórico diario BYMA.
    Los bonos/ONs suelen requerir sufijo ' 24HS' en el símbolo.
    """
    fin = datetime.now(TZ_ARGENTINA).date()
    inicio = fin - timedelta(days=45)
    from_date = inicio.isoformat()
    to_date = fin.isoformat()

    simbolos = [f"{ticker} 24HS", f"{ticker} CI", ticker]

    for simbolo in simbolos:
        try:
            df = con_reintentos(
                f"history-{simbolo}",
                lambda s=simbolo: cliente.get_daily_history(s, from_date, to_date),
            )
            if df is None or len(df) == 0:
                logger.info("    histórico %s: sin datos", simbolo)
                continue
            df = df[df["close"] > 0]
            if len(df) == 0:
                continue
            ultima = df.iloc[-1]
            precio = round(float(ultima["close"]), 4)
            fecha = str(ultima["date"])
            logger.info(
                "    histórico %s: último cierre=%s fecha=%s",
                simbolo,
                precio,
                fecha,
            )
            return precio, fecha, simbolo
        except Exception as exc:  # noqa: BLE001
            logger.warning("    histórico %s: %s", simbolo, exc)

    return None, None, None


def resolver_precio(
    cliente: BymaData,
    serie: pd.Series,
    ticker: str,
) -> tuple[float | None, str | None, str | None]:
    """
    Resuelve precio con fallback:
    1) intradiario
    2) cierre anterior en cotización
    3) último cierre del histórico diario
    """
    intradia = extraer_precio_intradia(serie)
    if intradia is not None:
        return intradia, "intradia", None

    cierre = extraer_precio_cierre_anterior(serie)
    if cierre is not None:
        return cierre, "ultimo_cierre", "cotizacion_anterior"

    hist_precio, hist_fecha, hist_simbolo = obtener_ultimo_cierre_historico(
        cliente, ticker
    )
    if hist_precio is not None:
        fuente = f"historico_{hist_fecha}"
        if hist_simbolo:
            fuente = f"{fuente}_{hist_simbolo.replace(' ', '_')}"
        return hist_precio, "ultimo_cierre", fuente

    return None, None, None


def calcular_variacion_pct(
    precio: float | None,
    precio_anterior: float | None,
) -> float | None:
    """Calcula variación porcentual respecto al cierre anterior."""
    if precio is None or precio_anterior is None or precio_anterior == 0:
        return None
    return round((precio - precio_anterior) / precio_anterior * 100, 2)


def construir_item(
    instrumento: dict,
    cliente: BymaData,
    paneles: pd.DataFrame,
    timestamp_consulta: str,
    mercado_cerrado: bool,
    info: dict[str, Any] | None = None,
    tc_mep: float | None = None,
) -> dict:
    """Arma el objeto JSON de un instrumento, manejando errores sin detener el resto."""
    ticker = instrumento["ticker"]
    base: dict[str, Any] = {
        "ticker": ticker,
        "nombre": instrumento["nombre"],
        "sector": instrumento["sector"],
        "timestamp_consulta": timestamp_consulta,
    }

    try:
        fila, _diagnostico = obtener_cotizacion(cliente, ticker, paneles)
        if fila is None:
            return {
                **base,
                "precio": None,
                "precio_tipo": None,
                "variacion_pct": None,
                "error": True,
                "mensaje_error": "Sin datos de cotización en BYMA",
            }

        serie = pd.Series(fila)
        precio, precio_tipo, fuente_precio = resolver_precio(cliente, serie, ticker)

        anterior = extraer_precio_cierre_anterior(serie)
        if anterior is None and precio_tipo == "ultimo_cierre" and len(serie.index):
            # Para histórico, intentar penúltimo día si tenemos solo un cierre
            pass

        variacion = None
        if precio_tipo == "intradia":
            variacion = calcular_variacion_pct(precio, anterior)

        nombre_api = fila.get("description") or fila.get("securityDesc")
        nombre = instrumento["nombre"]
        if nombre_api and isinstance(nombre_api, str) and nombre_api.strip():
            nombre = nombre_api.strip()

        if precio is None:
            msg = (
                "Precio no disponible (mercado cerrado)"
                if mercado_cerrado
                else "Precio no disponible en BYMA"
            )
            return {
                **base,
                "nombre": nombre,
                "precio": None,
                "precio_tipo": None,
                "variacion_pct": None,
                "error": True,
                "mensaje_error": msg,
            }

        precio_raw = precio
        precio_conv, escala_aplicada = convertir_precio_raw_a_panel(precio, info, tc_mep)
        if precio_conv is None and escala_precio_byma(info) == "ars_peso":
            return {
                **base,
                "nombre": nombre,
                "precio": None,
                "precio_tipo": None,
                "variacion_pct": None,
                "error": True,
                "mensaje_error": "Precio en pesos BYMA sin tipo de cambio MEP para convertir a USD",
            }
        precio = precio_conv if precio_conv is not None else precio

        item: dict[str, Any] = {
            **base,
            "nombre": nombre,
            "precio": precio,
            "precio_tipo": precio_tipo,
            "variacion_pct": variacion,
            "error": False,
        }
        if escala_aplicada == "ars_peso" and precio_raw is not None:
            item["precio_byma_raw_ars"] = round(float(precio_raw), 4)
            item["precio_conversion"] = {
                "escala": "ars_peso",
                "tc_mep": tc_mep,
                "usd_por_100": round(precio / 1000, 4),
            }
        if fuente_precio:
            item["precio_fuente"] = fuente_precio
        if precio_tipo == "ultimo_cierre":
            item["precio_etiqueta"] = "cierre anterior"
        return item

    except Exception as exc:  # noqa: BLE001
        logger.error("    EXCEPCIÓN %s: %s", ticker, exc)
        return {
            **base,
            "precio": None,
            "precio_tipo": None,
            "variacion_pct": None,
            "error": True,
            "mensaje_error": str(exc),
        }


def determinar_fetch_status(
    mercado_cerrado: bool,
    instrumentos: list[dict],
    error_conexion: bool,
) -> tuple[str, str]:
    """Define fetch_status global y mensaje para la UI."""
    total = len(instrumentos)
    ok = sum(1 for i in instrumentos if not i.get("error"))
    intradia = sum(1 for i in instrumentos if i.get("precio_tipo") == "intradia")
    errores = total - ok

    if error_conexion and ok == 0:
        return "error", "No se pudo conectar con BYMA Open Data."

    if mercado_cerrado:
        if ok == 0:
            return (
                "mercado_cerrado",
                "Mercado cerrado. No hay cotizaciones intradiarias; "
                "se intentó usar cierres anteriores sin éxito.",
            )
        return (
            "mercado_cerrado",
            f"Mercado cerrado. Mostrando últimos cierres disponibles ({ok}/{total} instrumentos).",
        )

    if ok == 0:
        return "error", f"BYMA respondió pero ningún instrumento tiene precio ({errores} fallos)."

    if intradia == total:
        return "ok", f"Cotizaciones intradiarias obtenidas ({ok}/{total})."

    if errores > 0:
        return (
            "parcial",
            f"Datos parciales: {intradia} intradiarios, {ok - intradia} cierres, {errores} sin precio.",
        )

    return (
        "ok",
        f"Datos obtenidos en horario de mercado ({intradia} intradiarios, "
        f"{ok - intradia} cierres de referencia).",
    )


def main() -> int:
    """Ejecuta la consulta completa y persiste el JSON."""
    logger.info("=== Iniciando consulta BYMA Open Data ===")
    logger.info("Timestamp ART: %s", ahora_iso_argentina())

    cliente = BymaData()
    configurar_sesion_byma(cliente)
    timestamp_global = ahora_iso_argentina()

    logger.info("Evaluando estado de mercado...")
    estado_mercado = evaluar_estado_mercado(cliente)
    mercado_cerrado = estado_mercado["mercado_cerrado"]
    if mercado_cerrado:
        logger.info(
            "  MERCADO CERRADO: %s",
            estado_mercado.get("motivo_mercado_cerrado", "desconocido"),
        )
    else:
        logger.info("  Mercado abierto (día hábil BYMA).")

    logger.info("Cargando paneles de respaldo (ONs y bonos)...")
    paneles = cargar_paneles(cliente)

    logger.info("Consultando tipo de cambio (DolarAPI)...")
    try:
        from providers.dolarapi import consultar_tipo_cambio

        tipo_cambio = consultar_tipo_cambio(timestamp_global)
    except Exception as exc:  # noqa: BLE001
        logger.warning("DolarAPI omitido: %s", exc)
        tipo_cambio = {
            "fuente": "dolarapi.com",
            "timestamp_consulta": timestamp_global,
            "error": True,
            "mensaje_error": str(exc),
        }

    tc_mep = tc_mep_venta(tipo_cambio)
    if tc_mep:
        logger.info("  MEP venta (conversión ars_peso): %s", tc_mep)
    try:
        from providers.mep_historico import registrar_mep_fetch

        registrar_mep_fetch(tipo_cambio)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Cache MEP histórico omitido: %s", exc)

    instrumentos_resultado: list[dict] = []
    error_conexion_global = bool(estado_mercado.get("error_market_time"))

    for instrumento in INSTRUMENTOS:
        ticker = instrumento["ticker"]
        logger.info("Consultando %s...", ticker)
        item = construir_item(
            instrumento,
            cliente,
            paneles,
            timestamp_global,
            mercado_cerrado,
            INFO_FIJA.get(ticker),
            tc_mep,
        )
        instrumentos_resultado.append(item)

        if item.get("error"):
            logger.info("  -> ERROR: %s", item.get("mensaje_error", "?"))
        else:
            logger.info(
                "  -> OK precio=%s tipo=%s variacion=%s",
                item.get("precio"),
                item.get("precio_tipo"),
                item.get("variacion_pct"),
            )

    fetch_status, fetch_mensaje = determinar_fetch_status(
        mercado_cerrado,
        instrumentos_resultado,
        error_conexion_global,
    )

    logger.info("Consultando precios de respaldo (Data912)...")
    try:
        from providers.data912 import consultar_precios_backup, enriquecer_con_backup

        tickers = [i["ticker"] for i in instrumentos_resultado]
        backup_map, data912_meta = consultar_precios_backup(tickers)
        enriquecer_con_backup(instrumentos_resultado, backup_map, INFO_FIJA, tc_mep)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Data912 omitido: %s", exc)
        data912_meta = {
            "fuente": "data912.com",
            "error": True,
            "mensaje_error": str(exc),
        }
        for item in instrumentos_resultado:
            item["fuentes_consultadas"] = ["byma"]

    ok_count = sum(1 for i in instrumentos_resultado if not i.get("error"))

    payload = {
        "ultima_actualizacion": timestamp_global,
        "fetch_status": fetch_status,
        "fetch_mensaje": fetch_mensaje,
        "mercado": {
            "cerrado": mercado_cerrado,
            "motivo": estado_mercado.get("motivo_mercado_cerrado"),
            "es_fin_semana": estado_mercado.get("es_fin_semana"),
            "is_working_day_byma": estado_mercado.get("is_working_day_byma"),
        },
        "tipo_cambio": tipo_cambio,
        "data912": data912_meta,
        "instrumentos": instrumentos_resultado,
    }

    ARCHIVO_SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with ARCHIVO_SALIDA.open("w", encoding="utf-8") as archivo:
        json.dump(payload, archivo, ensure_ascii=False, indent=2)
        archivo.write("\n")
    logger.info("=== Finalizado ===")
    logger.info("Guardado en %s", ARCHIVO_SALIDA)
    logger.info("fetch_status=%s (%s)", fetch_status, fetch_mensaje)
    logger.info("Instrumentos con precio: %s/%s", ok_count, len(instrumentos_resultado))

    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from historico_precios import ejecutar_incremental

        logger.info("--- Histórico de precios (incremental) ---")
        ejecutar_incremental()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Histórico incremental omitido o falló (cotizaciones guardadas): %s", exc)

    return 0


if __name__ == "__main__":
    sys.exit(main())
