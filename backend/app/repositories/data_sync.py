import json
import sqlite3
import time
from datetime import datetime, timedelta
from uuid import uuid4

from app.database import json_dump
from app.services import redis_sync_state
from app.timeutils import now_iso


ACTIVE_STATUSES = ("queued", "running", "paused")


class DataSyncStopped(RuntimeError):
    pass


def _poll_interval_for_status(status: str) -> int:
    if status == "running":
        return 2000
    if status in {"queued", "paused"}:
        return 3000
    return 0


def _merge_realtime_fields(job: dict, realtime: dict | None, fallback_backend: str = "sqlite-fallback") -> dict:
    if not job:
        return job

    merged = dict(job)
    if realtime:
        for key in (
            "status",
            "message",
            "totalTasks",
            "completedTasks",
            "progressPercent",
            "startedAt",
            "finishedAt",
            "updatedRows",
            "failedRows",
            "pollIntervalMs",
        ):
            if key in realtime and realtime[key] is not None:
                merged[key] = realtime[key]
        merged["isRealtime"] = True
        merged["backend"] = "redis"
        if "pollIntervalMs" not in merged or not merged["pollIntervalMs"]:
            merged["pollIntervalMs"] = _poll_interval_for_status(str(merged.get("status") or ""))
        return merged

    merged["isRealtime"] = False
    merged["backend"] = fallback_backend
    merged["pollIntervalMs"] = _poll_interval_for_status(str(merged.get("status") or ""))
    return merged


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def cleanup_stale_active_jobs(conn: sqlite3.Connection, stale_after_minutes: int = 15) -> int:
    cutoff = datetime.now().astimezone() - timedelta(minutes=stale_after_minutes)
    rows = conn.execute(
        """
        SELECT id, status, created_at, started_at
        FROM data_sync_jobs
        WHERE status IN ('queued', 'running')
        """
    ).fetchall()

    stale_ids: list[str] = []
    for row in rows:
        reference_time = _parse_iso(row["started_at"]) or _parse_iso(row["created_at"])
        if reference_time and reference_time <= cutoff:
            stale_ids.append(row["id"])

    for job_id in stale_ids:
        conn.execute(
            """
            UPDATE data_sync_jobs
            SET status='failed',
                finished_at=?,
                failed_rows=CASE WHEN failed_rows > 0 THEN failed_rows ELSE 1 END,
                message='Data sync job marked as stale and closed automatically'
            WHERE id=?
            """,
            (now_iso(), job_id),
        )

    if stale_ids:
        conn.commit()
    return len(stale_ids)


def get_active_job(conn: sqlite3.Connection) -> dict | None:
    active_job_id = redis_sync_state.get_active_job()
    if active_job_id:
        active = get_job(conn, active_job_id)
        if active and active.get("status") in ACTIVE_STATUSES:
            return active

    row = conn.execute(
        """
        SELECT * FROM data_sync_jobs
        WHERE status IN ('queued', 'running', 'paused')
        ORDER BY created_at DESC
        LIMIT 1
        """
    ).fetchone()
    return to_job(row) if row else None


def create_job(conn: sqlite3.Connection, request) -> dict:
    job_id = f"sync-{now_iso().replace(':', '').replace('-', '').replace('+', '-')}-{uuid4().hex[:6]}"
    timestamp = now_iso()
    conn.execute(
        """
        INSERT INTO data_sync_jobs (
            id, source, status, scopes_json, markets_json, symbols_json,
            trade_date, start_date, end_date, full_refresh, full_universe,
            limit_value, update_mode, total_tasks,
            completed_tasks, message, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            request.source,
            "queued",
            json_dump([scope.value for scope in request.scopes]),
            json_dump(request.markets),
            json_dump(request.symbols) if request.symbols else None,
            request.trade_date.isoformat() if request.trade_date else None,
            request.start_date.isoformat() if request.start_date else None,
            request.end_date.isoformat() if request.end_date else None,
            1 if request.full_refresh else 0,
            1 if request.full_universe else 0,
            request.limit,
            request.update_mode.value,
            estimate_total_tasks(request),
            0,
            "AkShare 数据同步任务已提交",
            timestamp,
        ),
    )
    conn.commit()
    job = get_job(conn, job_id)
    if job:
        redis_sync_state.init_job_state(job)
        redis_sync_state.set_active_job(job_id)
    return job


def mark_running(conn: sqlite3.Connection, job_id: str, message: str) -> None:
    started_at = now_iso()
    conn.execute(
        """
        UPDATE data_sync_jobs
        SET status='running', started_at=COALESCE(started_at, ?), message=?
        WHERE id=? AND status IN ('queued', 'running')
        """,
        (started_at, message, job_id),
    )
    conn.commit()
    redis_sync_state.set_active_job(job_id)
    redis_sync_state.set_control_state(job_id, paused=False, stopped=False)
    redis_sync_state.update_job_state(
        job_id,
        {
            "status": "running",
            "message": message,
            "startedAt": started_at,
            "pollIntervalMs": _poll_interval_for_status("running"),
        },
    )


def mark_progress(conn: sqlite3.Connection, job_id: str, completed_tasks: int, total_tasks: int, message: str) -> None:
    wait_until_resumed(conn, job_id)
    progress = calculate_progress_percent(completed_tasks, total_tasks, "running")
    conn.execute(
        """
        UPDATE data_sync_jobs
        SET completed_tasks=?, total_tasks=?, message=?
        WHERE id=?
        """,
        (completed_tasks, total_tasks, message, job_id),
    )
    conn.commit()
    redis_sync_state.update_job_state(
        job_id,
        {
            "status": "running",
            "completedTasks": completed_tasks,
            "totalTasks": total_tasks,
            "progressPercent": progress,
            "message": message,
            "pollIntervalMs": _poll_interval_for_status("running"),
        },
    )


def mark_finished(conn: sqlite3.Connection, job_id: str, updated_rows: int, failed_rows: int, message: str) -> None:
    row = conn.execute("SELECT status, total_tasks FROM data_sync_jobs WHERE id=?", (job_id,)).fetchone()
    if row and row["status"] == "stopped":
        conn.commit()
        redis_sync_state.update_job_state(
            job_id,
            {
                "status": "stopped",
                "message": "数据更新已停止",
                "pollIntervalMs": 0,
            },
            finished=True,
        )
        redis_sync_state.clear_active_job(job_id)
        return
    total_tasks = row["total_tasks"] if row else 0
    status = "success" if failed_rows == 0 else "failed"
    completed_tasks = total_tasks if failed_rows == 0 else 0
    finished_at = now_iso()
    conn.execute(
        """
        UPDATE data_sync_jobs
        SET status=?, finished_at=?, completed_tasks=?, updated_rows=?, failed_rows=?, message=?
        WHERE id=?
        """,
        (status, finished_at, completed_tasks, updated_rows, failed_rows, message, job_id),
    )
    conn.commit()
    redis_sync_state.update_job_state(
        job_id,
        {
            "status": status,
            "finishedAt": finished_at,
            "completedTasks": completed_tasks,
            "totalTasks": total_tasks,
            "progressPercent": calculate_progress_percent(completed_tasks, total_tasks, status),
            "updatedRows": updated_rows,
            "failedRows": failed_rows,
            "message": message,
            "pollIntervalMs": 0,
        },
        finished=True,
    )


def pause_job(conn: sqlite3.Connection, job_id: str) -> dict | None:
    row = conn.execute("SELECT status FROM data_sync_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    if row["status"] in {"queued", "running"}:
        message = "数据更新已暂停，可继续或停止"
        conn.execute(
            "UPDATE data_sync_jobs SET status='paused', message=? WHERE id=?",
            (message, job_id),
        )
        conn.commit()
        redis_sync_state.set_control_state(job_id, paused=True)
        redis_sync_state.update_job_state(
            job_id,
            {
                "status": "paused",
                "message": message,
                "pollIntervalMs": _poll_interval_for_status("paused"),
            },
        )
    return get_job(conn, job_id)


def resume_job(conn: sqlite3.Connection, job_id: str) -> dict | None:
    row = conn.execute("SELECT status FROM data_sync_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    if row["status"] == "paused":
        message = "正在继续更新 AkShare 数据"
        conn.execute(
            "UPDATE data_sync_jobs SET status='running', message=? WHERE id=?",
            (message, job_id),
        )
        conn.commit()
        redis_sync_state.set_active_job(job_id)
        redis_sync_state.set_control_state(job_id, paused=False, stopped=False)
        redis_sync_state.update_job_state(
            job_id,
            {
                "status": "running",
                "message": message,
                "pollIntervalMs": _poll_interval_for_status("running"),
            },
        )
    return get_job(conn, job_id)


def stop_job(conn: sqlite3.Connection, job_id: str, message: str = "数据更新已停止") -> dict | None:
    row = conn.execute("SELECT status, total_tasks, completed_tasks FROM data_sync_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    if row["status"] in ACTIVE_STATUSES:
        finished_at = now_iso()
        conn.execute(
            """
            UPDATE data_sync_jobs
            SET status='stopped', finished_at=?, message=?
            WHERE id=?
            """,
            (finished_at, message, job_id),
        )
        conn.commit()
        redis_sync_state.set_control_state(job_id, stopped=True)
        redis_sync_state.update_job_state(
            job_id,
            {
                "status": "stopped",
                "finishedAt": finished_at,
                "message": message,
                "progressPercent": calculate_progress_percent(
                    int(row["completed_tasks"] or 0),
                    int(row["total_tasks"] or 0),
                    "stopped",
                ),
                "pollIntervalMs": 0,
            },
            finished=True,
        )
        redis_sync_state.clear_active_job(job_id)
    return get_job(conn, job_id)


def wait_until_resumed(conn: sqlite3.Connection, job_id: str) -> None:
    while True:
        control = redis_sync_state.get_control_state(job_id)
        if control and control.get("stopped"):
            raise DataSyncStopped("数据更新已停止")
        if control and control.get("paused"):
            time.sleep(0.5)
            continue

        row = conn.execute("SELECT status FROM data_sync_jobs WHERE id=?", (job_id,)).fetchone()
        status = row["status"] if row else "stopped"
        if status == "stopped":
            raise DataSyncStopped("数据更新已停止")
        if status != "paused":
            return
        time.sleep(0.5)


def get_job(conn: sqlite3.Connection, job_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM data_sync_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    base_job = to_job(row)
    realtime = redis_sync_state.get_job_state(job_id)
    return _merge_realtime_fields(base_job, realtime)


def get_latest_job(conn: sqlite3.Connection) -> dict | None:
    active_job_id = redis_sync_state.get_active_job()
    if active_job_id:
        active = get_job(conn, active_job_id)
        if active:
            return active

    row = conn.execute("SELECT * FROM data_sync_jobs ORDER BY created_at DESC LIMIT 1").fetchone()
    if not row:
        return None
    base_job = to_job(row)
    realtime = redis_sync_state.get_job_state(base_job["jobId"])
    return _merge_realtime_fields(base_job, realtime)


def dataset_status(conn: sqlite3.Connection) -> dict:
    fundamentals = conn.execute("SELECT COUNT(*) AS rows, MAX(updated_at) AS updated_at FROM stock_fundamentals").fetchone()
    prices = conn.execute(
        """
        SELECT
            COUNT(*) AS rows,
            COUNT(DISTINCT symbol) AS stock_count,
            MIN(trade_date) AS from_date,
            MAX(trade_date) AS to_date,
            MAX(updated_at) AS updated_at
        FROM stock_daily_prices
        """
    ).fetchone()
    return {
        "items": [
            {
                "scope": "stock_basic",
                "rows": fundamentals["rows"],
                "stockCount": fundamentals["rows"],
                "updatedAt": fundamentals["updated_at"],
            },
            {
                "scope": "daily_prices",
                "rows": prices["rows"],
                "stockCount": prices["stock_count"],
                "fromDate": prices["from_date"],
                "toDate": prices["to_date"],
                "updatedAt": prices["updated_at"],
            },
            {
                "scope": "fundamentals",
                "rows": fundamentals["rows"],
                "stockCount": fundamentals["rows"],
                "updatedAt": fundamentals["updated_at"],
            },
        ]
    }


def to_job(row: sqlite3.Row) -> dict:
    total_tasks = row["total_tasks"]
    completed_tasks = row["completed_tasks"]
    return {
        "jobId": row["id"],
        "source": row["source"],
        "status": row["status"],
        "scopes": json.loads(row["scopes_json"]),
        "markets": json.loads(row["markets_json"]),
        "symbols": json.loads(row["symbols_json"]) if row["symbols_json"] else [],
        "limit": row["limit_value"],
        "updateMode": row["update_mode"],
        "tradeDate": row["trade_date"],
        "startDate": row["start_date"],
        "endDate": row["end_date"],
        "fullUniverse": bool(row["full_universe"]),
        "totalTasks": total_tasks,
        "completedTasks": completed_tasks,
        "progressPercent": calculate_progress_percent(completed_tasks, total_tasks, row["status"]),
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
        "updatedRows": row["updated_rows"],
        "failedRows": row["failed_rows"],
        "message": row["message"],
        "isRealtime": False,
        "backend": "sqlite-fallback",
        "pollIntervalMs": _poll_interval_for_status(str(row["status"] or "")),
    }


def estimate_total_tasks(request) -> int:
    if request.symbols:
        return min(len(request.symbols), request.limit)
    if request.full_universe:
        return 10000
    return request.limit


def calculate_progress_percent(completed_tasks: int, total_tasks: int, status: str) -> int:
    if status == "success":
        return 100
    if total_tasks <= 0:
        return 0
    return max(0, min(99, round(completed_tasks / total_tasks * 100)))
