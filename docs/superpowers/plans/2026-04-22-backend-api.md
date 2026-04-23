# Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a FastAPI + sqlite3 + Pydantic backend that matches `backend/API.md` and supports the current frontend, including AkShare-triggered data sync and MA120 screener signals.

**Architecture:** FastAPI routers call small repository modules backed by sqlite3. Startup initializes schema and non-screener seed data. AkShare integration is isolated behind a service that fetches live data and marks the sync job failed when the upstream source is unavailable.

**Tech Stack:** Python 3.12, FastAPI, sqlite3, Pydantic v2, pytest, AkShare.

---

### Task 1: Test Backend Contract

**Files:**
- Create: `backend/tests/test_api.py`
- Create: `backend/tests/conftest.py`

- [x] Write tests for health, screener MA120 fields, data sync job lifecycle, settings, and reports.
- [x] Run the tests and confirm they fail because backend modules do not exist.

### Task 2: Application Skeleton

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/app/database.py`
- Create: `backend/app/schemas.py`
- Create: `backend/app/repositories/*.py`
- Create: `backend/app/routers/*.py`

- [ ] Implement FastAPI app factory and sqlite initialization.
- [ ] Register `/api/v1` routers and CORS.
- [ ] Seed non-screener local data only; selected stock data must come from AkShare sync.

### Task 3: Screener And Data Sync

**Files:**
- Create: `backend/app/services/akshare_sync.py`
- Modify: `backend/app/repositories/screener.py`
- Modify: `backend/app/repositories/data_sync.py`
- Modify: `backend/app/routers/screener.py`
- Modify: `backend/app/routers/data_sync.py`

- [ ] Implement MA120 threshold calculation: buy when `price < ma120 * 0.88`, sell when `price > ma120 * 1.12`, else hold.
- [ ] Implement data sync job creation, latest-job lookup, job status lookup, and dataset status.
- [ ] Use upsert into `stock_fundamentals` and `stock_daily_prices`.

### Task 4: Remaining Frontend APIs

**Files:**
- Modify routers and repositories for market, news, watchlists, portfolio, reports, settings, notifications, and search.

- [ ] Return seeded data that matches frontend expectations.
- [ ] Keep request and response field aliases compatible with `backend/API.md`.

### Task 5: Verification

**Files:**
- Modify: `backend/README.md`

- [ ] Run `python3 -m pytest backend/tests -q`.
- [ ] Run `uvicorn app.main:app` from `backend/` and check `/api/v1/health`.
- [ ] Document local backend run command.
