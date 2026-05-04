import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_conn
from app.repositories import stocks
from app.schemas import StockMetadataUpdate

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
