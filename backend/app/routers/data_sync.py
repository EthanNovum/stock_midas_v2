import sqlite3

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.database import connect
from app.dependencies import get_conn
from app.repositories import data_sync
from app.schemas import DataSyncJobCreate
from app.services import akshare_sync

router = APIRouter(prefix="/data-sync")


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
def create_job(
    payload: DataSyncJobCreate,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    data_sync.cleanup_stale_active_jobs(conn)
    active_job = data_sync.get_active_job(conn)
    if active_job:
        raise HTTPException(status_code=409, detail="Data sync job already in progress")

    job = data_sync.create_job(conn, payload)
    background_tasks.add_task(process_job, job["jobId"], payload)
    return job


def process_job(job_id: str, payload: DataSyncJobCreate) -> None:
    with connect() as conn:
        try:
            data_sync.mark_running(conn, job_id, "正在更新 AkShare 数据")
            updated_rows, failed_rows, message = akshare_sync.run_sync(
                conn,
                payload,
                progress_callback=lambda completed, total, message: data_sync.mark_progress(
                    conn,
                    job_id,
                    completed,
                    total,
                    message,
                ),
            )
        except Exception as exc:
            data_sync.mark_finished(conn, job_id, 0, 1, f"数据更新失败: {exc}")
        else:
            data_sync.mark_finished(conn, job_id, updated_rows, failed_rows, message)


@router.get("/jobs/latest")
def latest_job(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    job = data_sync.get_latest_job(conn)
    if not job:
        raise HTTPException(status_code=404, detail="No data sync job found")
    return job


@router.get("/jobs/{job_id}")
def get_job(job_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    job = data_sync.get_job(conn, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Data sync job not found")
    return job


@router.get("/datasets")
def datasets(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return data_sync.dataset_status(conn)
