"""Quiesced PostgreSQL + local upload backup; never restores the live database.

python ops/backup_production.py --env-file .env --project-name uvms-ai
Add --compose-file docker-compose.https.yml when TLS is enabled.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',default='.env')
    parser.add_argument('--project-name',default='uvms-ai')
    parser.add_argument('--compose-file',action='append',default=[])
    parser.add_argument('--output',default='backups')
    args=parser.parse_args()
    compose=['docker','compose','--project-name',args.project_name,'--env-file',args.env_file,'-f','docker-compose.prod.yml']
    for name in args.compose_file: compose.extend(['-f',name])
    directory=Path(args.output)/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    directory.mkdir(parents=True,mode=0o700)
    def run(command,**kwargs):
        result=subprocess.run(compose+command,stderr=subprocess.PIPE,**kwargs)
        if result.returncode: raise RuntimeError('Backup command failed; inspect container health. Secret-bearing output is withheld.')
        return result
    # Writes stop before both snapshots, preserving DB -> stored-file references.
    # This is a maintenance operation; Uvicorn's graceful timeout drains requests.
    run(['stop','api'],stdout=subprocess.DEVNULL)
    try:
        dump=directory/'postgres.dump'
        with dump.open('wb') as stream:
            run(['exec','-T','postgres','sh','-ec','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=stream)
        with dump.open('rb') as stream:
            run(['exec','-T','postgres','pg_restore','--list'],stdin=stream,stdout=subprocess.DEVNULL)
        uploads=directory/'uploads.tar.gz'
        with uploads.open('wb') as stream:
            run(['run','--rm','--no-deps','-T','--entrypoint','sh','api','-ec','tar -C /data/uploads -czf - .'],stdout=stream)
        with tarfile.open(uploads,'r:gz') as archive:
            for member in archive:
                if member.isfile():
                    content=archive.extractfile(member)
                    while content.read(1024*1024): pass
        manifest={path.name:{'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in (dump,uploads)}
        for path in (dump,uploads):os.chmod(path,0o600)
        (directory/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    finally:
        run(['up','-d','--wait','api'],stdout=subprocess.DEVNULL)
    print(json.dumps({'status':'PASS','backup_directory':str(directory),'archives_verified':2,'api_restarted':True}))


if __name__=='__main__':main()
