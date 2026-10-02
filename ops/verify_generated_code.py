"""Explicit local QA verification of reviewed generated code, never an API execution endpoint.

Examples:
  python ops/verify_generated_code.py answer.py --run-python-tests
  python ops/verify_generated_code.py Component.tsx --web-root apps/web

Run only code you have reviewed, in a disposable QA environment. No provider calls,
automatic repairs, credential access, or assertion that compilation proves semantics.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def verify(source, *, web_root=None, run_python_tests=False):
    source = Path(source).resolve()
    if source.suffix == '.py':
        compile(source.read_text(encoding='utf-8'), str(source), 'exec')
        if not run_python_tests:
            return {'syntax': 'PASS', 'execution': 'NOT_RUN'}
        # No application environment or secrets passed to generated tests.
        env = {key: value for key, value in os.environ.items() if key.upper() in {
            'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'LANG'}}
        with tempfile.TemporaryDirectory(prefix='uvms-code-qa-') as work:
            copied = Path(work) / 'generated_tests.py'
            copied.write_text(source.read_text(encoding='utf-8'), encoding='utf-8')
            result = subprocess.run([sys.executable, '-I', str(copied)], cwd=work, env=env,
                                    capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=45)
        return {'syntax': 'PASS', 'execution': 'PASS' if result.returncode == 0 else 'FAIL',
                'exit_code': result.returncode, 'diagnostics': (result.stdout + result.stderr)[-15000:]}
    if source.suffix not in {'.tsx', '.ts'} or not web_root:
        raise ValueError('Use .py, or .ts/.tsx with --web-root pointing to installed Web dependencies.')
    web = Path(web_root).resolve()
    # Locate the fixture under Web so normal React module/type resolution applies.
    with tempfile.TemporaryDirectory(prefix='.generated-qa-', dir=web) as work:
        work = Path(work)
        (work / source.name).write_text(source.read_text(encoding='utf-8'), encoding='utf-8')
        config = {'compilerOptions': {'target': 'ES2020', 'lib': ['ES2020', 'DOM'], 'module': 'ESNext',
            'moduleResolution': 'node', 'jsx': 'react-jsx', 'strict': True, 'esModuleInterop': True,
            'skipLibCheck': True, 'outDir': './build', 'noEmitOnError': True}, 'include': [source.name]}
        (work / 'tsconfig.json').write_text(json.dumps(config), encoding='utf-8')
        result = subprocess.run(['node', str(web / 'node_modules/typescript/bin/tsc'), '-p', str(work)],
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=45)
        emitted = [p.name for p in (work / 'build').glob('*.js')]
        return {'compile': 'PASS' if result.returncode == 0 and emitted else 'FAIL',
                'exit_code': result.returncode, 'emitted': emitted,
                'diagnostics': (result.stdout + result.stderr).replace(str(work), '<fixture>')[-15000:]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--web-root')
    parser.add_argument('--run-python-tests', action='store_true')
    args = parser.parse_args()
    try:
        report = verify(args.source, web_root=args.web_root, run_python_tests=args.run_python_tests)
    except (OSError, SyntaxError, ValueError, subprocess.TimeoutExpired) as error:
        report = {'verification': 'FAIL', 'diagnostics': str(error)}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(1 if 'FAIL' in report.values() else 0)
