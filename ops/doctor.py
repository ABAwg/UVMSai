from __future__ import annotations
import os, platform, shutil, subprocess, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
print("UVMS AI Doctor")
print("OS:", platform.platform())
print("Python:", sys.version.split()[0])
print("Node:", shutil.which("node") or "missing")
print("npm:", shutil.which("npm") or "missing")
print(".env:", "present" if (root / ".env").exists() else "missing")
print("Web node_modules:", "present" if (root / "apps/web/node_modules").exists() else "missing")
print("Mobile node_modules:", "present" if (root / "apps/mobile/node_modules").exists() else "missing")
