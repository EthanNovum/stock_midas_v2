import sqlite3

from fastapi import APIRouter, Depends

from app.dependencies import get_conn
from app.repositories import market
from app.timeutils import now_iso

router = APIRouter(prefix="/market")


@router.get("/status")
def status() -> dict:
    return {**market.status(), "lastUpdated": now_iso()}


@router.get("/indices")
def indices(_: str = "cn", conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return market.indices(conn)


@router.get("/movers")
def movers(direction: str, limit: int = 10, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return market.movers(conn, direction, limit)
