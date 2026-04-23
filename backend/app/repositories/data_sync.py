import json
import sqlite3
from datetime import datetime, timedelta
from uuid import uuid4

from app.database import json_dump
from app.timeutils import now_iso


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
    row = conn.execute(
        """
        SELECT * FROM data_sync_jobs
        WHERE status IN ('queued', 'running')
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
            trade_date, full_refresh, limit_value, update_mode, total_tasks,
            completed_tasks, message, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            request.source,
            "queued",
            json_dump([scope.value for scope in request.scopes]),
            json_dump(request.markets),
            json_dump(request.symbols) if request.symbols else None,
            request.trade_date.isoformat() if request.trade_date else None,
            1 if request.full_refresh else 0,
            request.limit,
            request.update_mode.value,
            estimate_total_tasks(request),
            0,
            "AkShare 数据同步任务已提交",
            timestamp,
        ),
    )
    conn.commit()
    return get_job(conn, job_id)


def mark_running(conn: sqlite3.Connection, job_id: str, message: str) -> None:
    conn.execute(
        "UPDATE data_sync_jobs SET status='running', started_at=?, message=? WHERE id=?",
        (now_iso(), message, job_id),
    )
    conn.commit()


def mark_progress(conn: sqlite3.Connection, job_id: str, completed_tasks: int, total_tasks: int, message: str) -> None:
    conn.execute(
        """
        UPDATE data_sync_jobs
        SET completed_tasks=?, total_tasks=?, message=?
        WHERE id=?
        """,
        (completed_tasks, total_tasks, message, job_id),
    )
    conn.commit()


def mark_finished(conn: sqlite3.Connection, job_id: str, updated_rows: int, failed_rows: int, message: str) -> None:
    row = conn.execute("SELECT total_tasks FROM data_sync_jobs WHERE id=?", (job_id,)).fetchone()
    total_tasks = row["total_tasks"] if row else 0
    completed_tasks = total_tasks if failed_rows == 0 else 0
    conn.execute(
        """
        UPDATE data_sync_jobs
        SET status=?, finished_at=?, completed_tasks=?, updated_rows=?, failed_rows=?, message=?
        WHERE id=?
        """,
        ("success" if failed_rows == 0 else "failed", now_iso(), completed_tasks, updated_rows, failed_rows, message, job_id),
    )
    conn.commit()


def get_job(conn: sqlite3.Connection, job_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM data_sync_jobs WHERE id=?", (job_id,)).fetchone()
    return to_job(row) if row else None


def get_latest_job(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute("SELECT * FROM data_sync_jobs ORDER BY created_at DESC LIMIT 1").fetchone()
    return to_job(row) if row else None


def dataset_status(conn: sqlite3.Connection) -> dict:
    fundamentals = conn.execute("SELECT COUNT(*) AS rows, MAX(updated_at) AS updated_at FROM stock_fundamentals").fetchone()
    prices = conn.execute("SELECT COUNT(*) AS rows, MAX(updated_at) AS updated_at FROM stock_daily_prices").fetchone()
    return {
        "items": [
            {"scope": "stock_basic", "rows": fundamentals["rows"], "updatedAt": fundamentals["updated_at"]},
            {"scope": "daily_prices", "rows": prices["rows"], "updatedAt": prices["updated_at"]},
            {"scope": "fundamentals", "rows": fundamentals["rows"], "updatedAt": fundamentals["updated_at"]},
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
        "limit": row["limit_value"],
        "updateMode": row["update_mode"],
        "totalTasks": total_tasks,
        "completedTasks": completed_tasks,
        "progressPercent": calculate_progress_percent(completed_tasks, total_tasks, row["status"]),
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
        "updatedRows": row["updated_rows"],
        "failedRows": row["failed_rows"],
        "message": row["message"],
    }


def estimate_total_tasks(request) -> int:
    if request.symbols:
        return min(len(request.symbols), request.limit)
    return request.limit


def calculate_progress_percent(completed_tasks: int, total_tasks: int, status: str) -> int:
    if status == "success":
        return 100
    if total_tasks <= 0:
        return 0
    return max(0, min(99, round(completed_tasks / total_tasks * 100)))
