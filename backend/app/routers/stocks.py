import sqlite3

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from app.database import connect
from app.dependencies import get_conn
from app.repositories import data_sync, stocks
from app.schemas import (
    DataSyncJobCreate,
    DataSyncScope,
    DataSyncUpdateMode,
    StockDailyRefreshRequest,
    StockMetadataUpdate,
)
from app.services import akshare_sync

router = APIRouter(prefix="/stocks")


@router.get("/{symbol}/detail")
def stock_detail(
    symbol: str,
    range: str = Query(default="daily"),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return stocks.get_stock_detail(conn, symbol, range)
    except stocks.StockDetailError as exc:
        status_code = 400 if str(exc) == "无效的走势图区间" else 404
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.patch("/{symbol}/metadata")
def update_stock_metadata(
    symbol: str,
    payload: StockMetadataUpdate,
    range: str = Query(default="daily"),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        return stocks.update_stock_metadata(
            conn,
            symbol,
            range_name=range,
            industry=payload.industry,
            ownership=payload.ownership,
        )
    except stocks.StockDetailError as exc:
        status_code = 404 if str(exc) == "股票不存在" else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.post("/{symbol}/refresh-daily", status_code=status.HTTP_202_ACCEPTED)
def refresh_stock_daily(
    symbol: str,
    payload: StockDailyRefreshRequest,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    try:
        normalized_symbol = stocks.normalize_symbol(symbol)
        stocks.get_stock_detail(conn, normalized_symbol, "daily")
    except stocks.StockDetailError as exc:
        status_code = 404 if str(exc) == "股票不存在" else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    data_sync.cleanup_stale_active_jobs(conn)
    active_job = data_sync.get_active_job(conn)
    if active_job:
        raise HTTPException(status_code=409, detail="Data sync job already in progress")

    job_payload = DataSyncJobCreate(
        scopes=[DataSyncScope.daily_prices],
        symbols=[normalized_symbol],
        updateMode=payload.update_mode,
        startDate=payload.start_date,
        endDate=payload.end_date,
        fullRefresh=False,
        fullUniverse=False,
        limit=1,
    )
    job = data_sync.create_job(conn, job_payload)
    background_tasks.add_task(_process_stock_refresh_job, job["jobId"], job_payload)
    return job


def _process_stock_refresh_job(job_id: str, payload: DataSyncJobCreate) -> None:
    with connect() as conn:
        try:
            data_sync.wait_until_resumed(conn, job_id)
            symbol = payload.symbols[0] if payload.symbols else ""
            data_sync.mark_running(conn, job_id, f"正在刷新 {symbol} 日报数据")
            updated_rows, failed_rows, message = akshare_sync.run_sync(
                conn,
                payload,
                progress_callback=lambda completed, total, progress_message: data_sync.mark_progress(
                    conn,
                    job_id,
                    completed,
                    total,
                    progress_message,
                ),
            )
        except data_sync.DataSyncStopped as exc:
            data_sync.stop_job(conn, job_id, str(exc))
        except Exception as exc:
            data_sync.mark_finished(conn, job_id, 0, 1, f"个股日报刷新失败: {exc}")
        else:
            final_message = message
            if payload.symbols:
                final_message = f"{payload.symbols[0]} 日报刷新完成，共写入 {updated_rows} 条记录"
            data_sync.mark_finished(conn, job_id, updated_rows, failed_rows, final_message)
