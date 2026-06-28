#!/usr/bin/env python3
"""Prueba manual de Data912 contra tickers conocidos."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from providers.data912 import consultar_precios_backup

TICKERS = ("AL30", "YMCIO", "DNC7O", "TSC4O")


def main() -> int:
    print("Consultando Data912 (arg_bonds + arg_corp)...")
    backup, meta = consultar_precios_backup(list(TICKERS))
    print(json.dumps(meta, indent=2, ensure_ascii=False))
    print("\nTickers de prueba:")
    for t in TICKERS:
        row = backup.get(t)
        if row:
            print(f"  {t}: c={row.get('precio')} bid={row.get('px_bid')} ask={row.get('px_ask')} panel={row.get('panel')}")
        else:
            print(f"  {t}: NO ENCONTRADO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
