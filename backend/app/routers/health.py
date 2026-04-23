import sqlite3

from fastapi import APIRouter, Depends

from app.dependencies import get_conn
from app.timeutils import now_iso

router = APIRouter()


@router.get("/health")
def health(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    conn.execute("SELECT 1").fetchone()
    return {"status": "ok", "database": "ok", "time": now_iso()}
