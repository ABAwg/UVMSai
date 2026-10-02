from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def fail(message: str, failures: list[str]) -> None:
    failures.append(message)
    print(f"FAIL: {message}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify UVMS release metadata and source safety")
    parser.add_argument(
        "--mode", choices=("archive", "working-tree"), default="archive",
        help="archive rejects generated/private files; working-tree skips local runtime files",
    )
    args = parser.parse_args()
    failures: list[str] = []
    print(f"UVMS AI release verification: {EXPECTED} ({args.mode})")

    manifests = [
        ROOT / "apps/web/package.json",
        ROOT / "apps/mobile/package.json",
    ]
    for path in manifests:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != EXPECTED:
            fail(f"{path.relative_to(ROOT)} version is {data.get('version')}, expected {EXPECTED}", failures)
        lock = json.loads(path.with_name('package-lock.json').read_text(encoding='utf-8'))
        if lock.get('version') != EXPECTED or lock.get('packages', {}).get('', {}).get('version') != EXPECTED:
            fail(f"{path.parent.relative_to(ROOT)} lockfile release version is out of sync", failures)

    api_config = (ROOT / 'services/api/app/config.py').read_text(encoding='utf-8')
    if f'os.getenv("UVMS_RELEASE_VERSION", "{EXPECTED}")' not in api_config:
        fail('API default release version is out of sync', failures)

    app_json = json.loads((ROOT / "apps/mobile/app.json").read_text(encoding="utf-8"))
    if app_json.get("expo", {}).get("version") != EXPECTED:
        fail("apps/mobile/app.json Expo version is out of sync", failures)

    required = [
        "docker-compose.prod.yml",
        ".env.production.example",
        "deploy/nginx/nginx.conf",
        "docs/DEPLOY_PRODUCTION.md",
        "docs/RELEASE_CHECKLIST.md",
        "ops/production_preflight.py",
        "ops/backup_postgres.sh",
        "ops/restore_postgres.sh",
        "ops/sse_probe.py",
        "ops/load_probe.py",
        "PRODUCTION_DEPLOY.md",
        "docker-compose.https.yml",
        "deploy/nginx/https.conf.template",
        "ops/backup_production.py",
    ]
    for rel in required:
        if not (ROOT / rel).is_file():
            fail(f"missing required release file: {rel}", failures)

    forbidden_dirs = {
        "node_modules", "__pycache__", ".next", ".expo", ".git", ".pytest_cache", ".venv",
        ".qa", ".local-run", "playwright-report", "test-results", "storage", "uploads",
        "dist", "build", "backups", "coverage", ".mypy_cache", ".ruff_cache",
    }
    private_files = {".env", ".env.production", ".uvms-runtime.json"}
    files: list[Path] = []
    found_generated_dir = False
    for directory, dirs, names in os.walk(ROOT):
        # Never descend into generated dependency/build trees: a local setup can
        # contain hundreds of thousands of files, none of which is release source.
        for name in list(dirs):
            if name in forbidden_dirs or name.startswith((".next-", "chrome-profile")):
                if args.mode == "archive" and not found_generated_dir:
                    fail(f"forbidden generated directory in release: {(Path(directory) / name).relative_to(ROOT)}", failures)
                    found_generated_dir = True
                dirs.remove(name)
        files.extend(Path(directory) / name for name in names)

    for path in files:
        rel = path.relative_to(ROOT)
        name = path.name.lower()
        is_private_env = name.startswith(".env.") and not name.endswith(".example")
        if name in private_files or is_private_env or name.endswith((".db", ".sqlite", ".sqlite3", ".db-wal", ".db-shm", ".dump", ".pem", ".pfx", ".key", ".log", ".pyc", ".tsbuildinfo")):
            if args.mode == "archive":
                fail(f"private/runtime file included: {rel}", failures)
            continue
        if path.stat().st_size > 3_000_000:
            continue
        if rel.parts and rel.parts[0] in {"services", "apps"} and "tests" in rel.parts:
            continue
        if path.name.endswith(".example") or path.name in {".env.example", ".env.production.example"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        # Catch common live-key shapes while allowing explicit examples/placeholders.
        if re.search(r"(?i)(openai_api_key|openrouter_api_key|gemini_api_key|groq_api_key)[ \t]*=[ \t]*(?!$|CHANGE_ME|YOUR_)[^\s#]{12,}", text, re.MULTILINE):
            fail(f"possible provider secret in {rel}", failures)
        if re.search(r"\bsk-[A-Za-z0-9_-]{20,}\b", text):
            fail(f"possible API secret token in {rel}", failures)
        if re.search(r"\bAIza[A-Za-z0-9_-]{35}\b", text):
            fail(f"possible Google API secret token in {rel}", failures)
        if re.search(r"\bgsk_[A-Za-z0-9_-]{20,}\b", text):
            fail(f"possible Groq API secret token in {rel}", failures)
        if re.search(r'(?:NEXT|EXPO)_PUBLIC_[A-Z_]*(?:GEMINI_API_KEY|GROQ_API_KEY|GOOGLE_CREDENTIAL|PROVIDER_SECRET)', text):
            fail(f"public provider credential configuration in {rel}", failures)

    if failures:
        print(f"Release verification FAILED: {len(failures)} issue(s)")
        return 1
    print("Release verification PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
