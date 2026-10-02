# Backup and recovery

Database backups are mandatory before migrations and before each public release.

## PostgreSQL

From the repository root on Linux/macOS:

```bash
./ops/backup_postgres.sh
```

Restore only during an announced maintenance window:

```bash
UVMS_ALLOW_RESTORE=YES ./ops/restore_postgres.sh backups/uvms-ai-YYYYMMDDTHHMMSSZ.dump
```

The backup script writes a temporary archive, validates it with `pg_restore --list`,
then publishes the dump and a SHA-256 sidecar when `sha256sum` is available. It
expands database user/name inside the PostgreSQL container, so custom `.env`
values are respected.

The restore script is intentionally destructive only after the explicit
`UVMS_ALLOW_RESTORE=YES` gate. By default it creates an automatic pre-restore
backup, stops Nginx/Web/API to prevent writes during restore, restores with
ownership/ACLs stripped, then starts the application again. API startup runs
Alembic and reference-data seeding before accepting traffic.

## Uploaded files

If `UVMS_STORAGE_BACKEND=local`, back up the Docker `uvms_uploads` volume independently. For S3/R2, enable provider-side versioning/lifecycle protection where available.

## Recovery drill

At least once before paid launch: restore a recent DB dump to a separate environment,
confirm `/ready`, sign in, open chats/projects, and download a stored file. A
backup that has never been restored is not considered verified. Keep the drill
date, dump checksum and result in the release evidence.
