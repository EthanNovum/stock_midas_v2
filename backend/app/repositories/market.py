import sqlite3

from app.repositories.utils import rows_to_dicts
from app.services import market_data


def status() -> dict:
    return market_data.market_status()


def indices(_conn: sqlite3.Connection) -> dict:
    return {"items": market_data.fetch_index_items()}


def movers(conn: sqlite3.Connection, direction: str, limit: int) -> dict:
    order = "DESC" if direction == "gainers" else "ASC"
    rows = conn.execute(
        f"""
        SELECT f.symbol, f.name, p.pct_change AS pctChange
        FROM stock_fundamentals f
        JOIN (
            SELECT symbol, MAX(trade_date) AS latest_trade_date
            FROM stock_daily_prices
            GROUP BY symbol
        ) latest ON latest.symbol = f.symbol
        JOIN stock_daily_prices p
            ON p.symbol = latest.symbol
            AND p.trade_date = latest.latest_trade_date
        WHERE p.pct_change IS NOT NULL
        ORDER BY p.pct_change {order}
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return {"items": rows_to_dicts(rows)}
