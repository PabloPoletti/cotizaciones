#!/usr/bin/env python3
"""Carga inicial del histórico (~90 días). Ejecutar una vez vía workflow manual."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from historico_precios import VENTANA_DIAS_DEFAULT, ejecutar_bootstrap

if __name__ == "__main__":
    dias = VENTANA_DIAS_DEFAULT
    if "--dias" in sys.argv:
        dias = int(sys.argv[sys.argv.index("--dias") + 1])
    sys.exit(ejecutar_bootstrap(dias))
