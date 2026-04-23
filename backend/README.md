# Midas Backend

FastAPI + sqlite3 + Pydantic backend for the Midas stock research terminal.

## Run

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The sqlite database defaults to `backend/data/midas.sqlite3`. Override it with:

```bash
MIDAS_DB_PATH=/tmp/midas.sqlite3 uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## AkShare Sync

The settings page calls:

```http
POST /api/v1/data-sync/jobs
```

The sync service calls AkShare directly and writes screener data into sqlite3. The screener starts empty until this job succeeds. If AkShare or the upstream data source is unavailable, the job is marked `failed` and the error is exposed through `GET /api/v1/data-sync/jobs/{jobId}`.

When Eastmoney snapshot/history endpoints abort the connection, the sync service falls back to AkShare's A-share code list plus Tencent/Sina daily price endpoints. You can cap each run with `MIDAS_AKSHARE_LIMIT`, defaulting to `300`.

`POST /api/v1/data-sync/jobs` accepts:

- `limit`: max stock tasks for this run, default `300`
- `updateMode`: `full` for full data refresh, `price_only` for latest-price refresh on existing screener rows

Job status responses include `totalTasks`, `completedTasks`, and `progressPercent`. The frontend shows a confirmation modal before submitting and refreshes progress only when the user clicks the refresh button, plus one delayed status fetch about 10 seconds after submission.

## Dashboard Market Data

`GET /api/v1/market/indices` and `GET /api/v1/news` call AkShare directly for real A-share index data and finance news. The backend no longer seeds dashboard index trends, dashboard news, or default watchlist stock items; the dashboard watchlist only shows user watchlist entries that match synced stock data.

## Test

```bash
python3 -m pytest backend/tests -q
```
