.PHONY: api web mobile test migrate docker-up docker-down preflight smoke load-probe backup

api:
	cd services/api && uvicorn app.main:app --reload --port 8000

web:
	cd apps/web && npm run dev

mobile:
	cd apps/mobile && npm run start

migrate:
	cd services/api && alembic upgrade head

test:
	cd services/api && PYTHONPATH=. pytest -q

preflight:
	python ops/production_preflight.py .env

smoke:
	python ops/smoke_test.py $${UVMS_PUBLIC_WEB_URL:-http://localhost}

load-probe:
	python ops/load_probe.py $${UVMS_PUBLIC_WEB_URL:-http://localhost}/live --requests 100 --concurrency 10

backup:
	./ops/backup_postgres.sh

docker-up:
	docker compose up -d postgres redis api

docker-down:
	docker compose down
