import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import PlainTextResponse

from app.dependencies import get_conn
from app.repositories import portfolio
from app.schemas import TradeCreate, TradeUpdate

router = APIRouter(prefix="/portfolio")


@router.get("/summary")
def summary(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return portfolio.summary(conn)


@router.get("/holdings")
def holdings(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return portfolio.holdings(conn)


@router.get("/allocation")
def allocation(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return portfolio.allocation(conn)


@router.get("/trades")
def list_trades(portfolio_id: int = 1, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return portfolio.list_trades(conn, portfolio_id)


@router.post("/trades", status_code=201)
def create_trade(payload: TradeCreate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return portfolio.create_trade(conn, payload)
    except portfolio.PortfolioError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/trades/{trade_id}")
def update_trade(trade_id: int, payload: TradeUpdate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return portfolio.update_trade(conn, trade_id, payload)
    except portfolio.PortfolioError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/trades/{trade_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trade(trade_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> Response:
    try:
        portfolio.delete_trade(conn, trade_id)
    except portfolio.PortfolioError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/report")
def report(format: str = "csv", conn: sqlite3.Connection = Depends(get_conn)) -> PlainTextResponse:
    content = portfolio.report_csv(conn)
    media_type = "text/csv" if format == "csv" else "text/plain"
    return PlainTextResponse(
        content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="portfolio-report.{format}"'},
    )
