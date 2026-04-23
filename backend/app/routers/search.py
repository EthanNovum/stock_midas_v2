import sqlite3

from fastapi import APIRouter, Depends

from app.dependencies import get_conn
from app.repositories import search as search_repo

router = APIRouter(prefix="/search")


@router.get("")
def search(q: str, limit: int = 10, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return search_repo.search(conn, q, min(limit, 50))
