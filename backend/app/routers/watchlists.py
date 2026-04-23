import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.dependencies import get_conn
from app.repositories import watchlists
from app.schemas import WatchlistCreate, WatchlistStockCreate, WatchlistUpdate

router = APIRouter(prefix="/watchlists")


@router.get("")
def list_watchlists(group_by: str = "sector", conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return watchlists.list_watchlists(conn, group_by)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_watchlist(payload: WatchlistCreate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return watchlists.create_watchlist(conn, payload)
    except watchlists.WatchlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{watchlist_id}")
def update_watchlist(watchlist_id: str, payload: WatchlistUpdate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return watchlists.update_watchlist(conn, watchlist_id, payload)
    except watchlists.WatchlistError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watchlist(watchlist_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> Response:
    try:
        watchlists.delete_watchlist(conn, watchlist_id)
    except watchlists.WatchlistError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/stocks", status_code=status.HTTP_201_CREATED)
def add_stock_to_default(payload: WatchlistStockCreate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return watchlists.add_stock_to_default(conn, payload)
    except watchlists.WatchlistError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{watchlist_id}/stocks", status_code=status.HTTP_201_CREATED)
def add_stock(watchlist_id: str, payload: WatchlistStockCreate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return watchlists.add_stock(conn, watchlist_id, payload)
    except watchlists.WatchlistError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{watchlist_id}/stocks/{symbol}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stock(watchlist_id: str, symbol: str, conn: sqlite3.Connection = Depends(get_conn)) -> Response:
    try:
        watchlists.delete_stock(conn, watchlist_id, symbol)
    except watchlists.WatchlistError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
