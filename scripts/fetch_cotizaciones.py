#!/usr/bin/env python3
"""
Consulta cotizaciones de ONs y bonos soberanos vía BYMA Open Data (PyOBD)
y guarda el resultado en docs/data/cotizaciones.json para GitHub Pages.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
from pyobd import BymaData

# Ruta de salida relativa a la raíz del repositorio
RAIZ_REPO = Path(__file__).resolve().parent.parent
ARCHIVO_SALIDA = RAIZ_REPO / "docs" / "data" / "cotizaciones.json"

# Zona horaria del mercado argentino
TZ_ARGENTINA = ZoneInfo("America/Argentina/Buenos_Aires")

# Especies a consultar con nombre y sector para el panel
INSTRUMENTOS = [
    {"ticker": "YMCIO", "nombre": "YPF 2029", "sector": "Petróleo y gas"},
    {"ticker": "YMCUO", "nombre": "YPF 2029 (dual)", "sector": "Petróleo y gas"},
    {"ticker": "TTC9O", "nombre": "TGS 2029", "sector": "Gas natural"},
    {"ticker": "TTCDO", "nombre": "TGS (dual)", "sector": "Gas natural"},
    {"ticker": "PN35O", "nombre": "Pan American 2035", "sector": "Petróleo y gas"},
    {"ticker": "PNDCO", "nombre": "Pan American (dual)", "sector": "Petróleo y gas"},
    {"ticker": "TSC3O", "nombre": "Telecom 2028", "sector": "Telecomunicaciones"},
    {"ticker": "DNC7O", "nombre": "Edenor 2027", "sector": "Utilities"},
    {"ticker": "IRCFO", "nombre": "IRSA 2028", "sector": "Real estate"},
    {"ticker": "RAC5O", "nombre": "YPF Luz 2025", "sector": "Utilities"},
    {"ticker": "TLCMO", "nombre": "Telecom (dual)", "sector": "Telecomunicaciones"},
    {"ticker": "YFCJO", "nombre": "YPF Luz (dual)", "sector": "Utilities"},
    {"ticker": "GN49O", "nombre": "Genneia 2049", "sector": "Utilities"},
    {"ticker": "RUCDO", "nombre": "IRSA (dual)", "sector": "Real estate"},
    {"ticker": "AL30", "nombre": "Bono AL30", "sector": "Soberanos"},
    {"ticker": "GD30", "nombre": "Bono GD30", "sector": "Soberanos"},
    {"ticker": "GD35", "nombre": "Bono GD35", "sector": "Soberanos"},
]

# Tipos de liquidación a probar (en orden de preferencia)
LIQUIDACIONES = ("CI", "24HS")


def ahora_iso_argentina() -> str:
    """Devuelve timestamp ISO8601 en hora Argentina."""
    return datetime.now(TZ_ARGENTINA).isoformat(timespec="seconds")


def extraer_precio(fila) -> float | None:
    """
    Obtiene el último precio disponible de una fila de cotización BYMA.
    Prioriza precio de rueda, operado, cierre y VWAP.
    """
    columnas = (
        "settlementPrice",
        "trade",
        "closingPrice",
        "vwap",
        "previousClosingPrice",
        "previousSettlementPrice",
    )
    for columna in columnas:
        if columna not in fila.index:
            continue
        valor = fila[columna]
        if valor is None:
            continue
        try:
            numerico = float(valor)
        except (TypeError, ValueError):
            continue
        if numerico > 0:
            return round(numerico, 4)
    return None


def calcular_variacion_pct(precio: float | None, precio_anterior: float | None) -> float | None:
    """Calcula variación porcentual respecto al cierre anterior."""
    if precio is None or precio_anterior is None or precio_anterior == 0:
        return None
    return round((precio - precio_anterior) / precio_anterior * 100, 2)


def cargar_paneles(cliente: BymaData) -> pd.DataFrame:
    """
    Carga paneles de ONs y bonos soberanos como respaldo.
    Se consulta una sola vez por ejecución para no saturar la API.
    """
    partes = []
    for metodo in ("get_corporate_bonds", "get_government_bonds"):
        try:
            df = getattr(cliente, metodo)()
            if df is not None and len(df) > 0:
                partes.append(df)
        except Exception:  # noqa: BLE001
            continue
    if not partes:
        return pd.DataFrame()
    return pd.concat(partes, ignore_index=True)


def buscar_en_panel(paneles: pd.DataFrame, ticker: str) -> dict | None:
    """Busca un ticker en los paneles BYMA (prioriza fila con precio > 0)."""
    if paneles.empty or "symbol" not in paneles.columns:
        return None
    filas = paneles[paneles["symbol"] == ticker]
    if filas.empty:
        return None
    # Preferir la fila con mayor precio disponible
    for _, fila in filas.iterrows():
        if extraer_precio(fila) is not None:
            return fila.to_dict()
    return filas.iloc[0].to_dict()


def obtener_cotizacion(
    cliente: BymaData, ticker: str, paneles: pd.DataFrame
) -> dict | None:
    """
    Consulta la cotización de un ticker probando distintos plazos de liquidación.
    Si falla, intenta recuperar datos del panel general de ONs/bonos.
    """
    ultimo_error = None

    for liquidacion in LIQUIDACIONES:
        try:
            df = cliente.get_current_quote(ticker, settlement=liquidacion)
            if df is not None and len(df) > 0:
                return df.iloc[0].to_dict()
        except Exception as exc:  # noqa: BLE001 — queremos seguir con otras especies
            ultimo_error = str(exc)

    fila_panel = buscar_en_panel(paneles, ticker)
    if fila_panel is not None:
        return fila_panel

    if ultimo_error:
        raise RuntimeError(ultimo_error)
    return None


def construir_item(
    instrumento: dict,
    cliente: BymaData,
    paneles: pd.DataFrame,
    timestamp_consulta: str,
) -> dict:
    """Arma el objeto JSON de un instrumento, manejando errores sin detener el resto."""
    ticker = instrumento["ticker"]
    base = {
        "ticker": ticker,
        "nombre": instrumento["nombre"],
        "sector": instrumento["sector"],
        "timestamp_consulta": timestamp_consulta,
    }

    try:
        fila = obtener_cotizacion(cliente, ticker, paneles)
        if fila is None:
            return {
                **base,
                "precio": None,
                "variacion_pct": None,
                "error": True,
                "mensaje_error": "Sin datos de cotización en BYMA",
            }

        serie = pd.Series(fila)
        precio = extraer_precio(serie)

        anterior = None
        for col in ("previousClosingPrice", "previousSettlementPrice"):
            if col in serie.index and serie[col] is not None:
                try:
                    val = float(serie[col])
                    if val > 0:
                        anterior = val
                        break
                except (TypeError, ValueError):
                    continue

        variacion = calcular_variacion_pct(precio, anterior)

        # Si BYMA trae descripción, la usamos como nombre alternativo
        nombre_api = fila.get("description") or fila.get("securityDesc")
        nombre = instrumento["nombre"]
        if nombre_api and isinstance(nombre_api, str) and nombre_api.strip():
            nombre = nombre_api.strip()

        item = {
            **base,
            "nombre": nombre,
            "precio": precio,
            "variacion_pct": variacion,
            "error": precio is None,
        }
        if precio is None:
            item["mensaje_error"] = "Precio no disponible (mercado cerrado o sin operaciones)"
        return item

    except Exception as exc:  # noqa: BLE001
        return {
            **base,
            "precio": None,
            "variacion_pct": None,
            "error": True,
            "mensaje_error": str(exc),
        }


def main() -> int:
    """Ejecuta la consulta completa y persiste el JSON."""
    print("Iniciando consulta BYMA Open Data...")
    cliente = BymaData()
    timestamp_global = ahora_iso_argentina()
    print("  Cargando paneles de respaldo (ONs y bonos)...")
    paneles = cargar_paneles(cliente)

    instrumentos_resultado = []
    for instrumento in INSTRUMENTOS:
        print(f"  Consultando {instrumento['ticker']}...")
        item = construir_item(instrumento, cliente, paneles, timestamp_global)
        instrumentos_resultado.append(item)
        estado = "OK" if not item.get("error") else f"ERROR: {item.get('mensaje_error', '?')}"
        print(f"    -> {estado}")

    payload = {
        "ultima_actualizacion": timestamp_global,
        "instrumentos": instrumentos_resultado,
    }

    ARCHIVO_SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with ARCHIVO_SALIDA.open("w", encoding="utf-8") as archivo:
        json.dump(payload, archivo, ensure_ascii=False, indent=2)
        archivo.write("\n")

    print(f"Guardado en {ARCHIVO_SALIDA}")
    errores = sum(1 for i in instrumentos_resultado if i.get("error"))
    if errores:
        print(f"Advertencia: {errores} instrumento(s) con error (el archivo se generó igual).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
