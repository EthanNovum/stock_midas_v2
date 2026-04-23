import sqlite3

from fastapi import APIRouter, Depends

from app.dependencies import get_conn
from app.repositories import news

router = APIRouter(prefix="/news")


@router.get("")
def list_news(category: str | None = None, limit: int = 10, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return news.list_news(conn, category, limit)
