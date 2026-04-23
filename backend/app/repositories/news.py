import sqlite3

from app.services import market_data


def list_news(conn: sqlite3.Connection, category: str | None, limit: int) -> dict:
    _ = conn
    return {"items": market_data.fetch_news_items(limit=limit, category=category)}
