#!/usr/bin/env python3
"""Prueba manual de DolarAPI (Fase 1). Uso: python scripts/probar_dolarapi.py"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_cotizaciones import ahora_iso_argentina
from providers.dolarapi import consultar_tipo_cambio


def main() -> int:
    resultado = consultar_tipo_cambio(ahora_iso_argentina())
    print(json.dumps(resultado, indent=2, ensure_ascii=False))
    return 0 if not resultado.get("error") else 1


if __name__ == "__main__":
    raise SystemExit(main())
