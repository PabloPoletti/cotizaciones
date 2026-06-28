#!/usr/bin/env python3
"""Actualización incremental del histórico (últimos días). Invocado desde el cron."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from historico_precios import ejecutar_incremental

if __name__ == "__main__":
    sys.exit(ejecutar_incremental())
