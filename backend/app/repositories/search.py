import sqlite3

from app.schemas import DataSyncJobCreate
from app.services import akshare_sync


def search(conn: sqlite3.Connection, q: str, limit: int) -> dict:
    stock_rows = find_stock_rows(conn, q, limit)
    if not stock_rows:
        sync_matching_stock(conn, q, limit)
        stock_rows = find_stock_rows(conn, q, limit)

    remaining = max(limit - len(stock_rows), 0)
    report_rows = find_report_rows(conn, q, remaining)
    return {
        "items": [
            {"type": "stock", **dict(row)} for row in stock_rows
        ]
        + [
            {"type": "report", **dict(row)} for row in report_rows
        ]
    }


def find_stock_rows(conn: sqlite3.Connection, q: str, limit: int) -> list[sqlite3.Row]:
    term = f"%{q}%"
    return conn.execute(
        """
        SELECT
            f.symbol AS id,
            f.name AS title,
            f.symbol || ' · ' || COALESCE(f.sector, '') AS subtitle,
            f.sector AS industry,
            p.close AS latestPrice,
            p.trade_date AS latestTradeDate
        FROM stock_fundamentals f
        LEFT JOIN (
            SELECT symbol, MAX(trade_date) AS latest_trade_date
            FROM stock_daily_prices
            GROUP BY symbol
        ) latest ON latest.symbol = f.symbol
        LEFT JOIN stock_daily_prices p
            ON p.symbol = latest.symbol
            AND p.trade_date = latest.latest_trade_date
        WHERE f.symbol LIKE ? OR f.name LIKE ?
        LIMIT ?
        """,
        (term, term, limit),
    ).fetchall()


def find_report_rows(conn: sqlite3.Connection, q: str, limit: int) -> list[sqlite3.Row]:
    if limit <= 0:
        return []

    term = f"%{q}%"
    return conn.execute(
        """
        SELECT id, title, institution || ' · ' || report_date AS subtitle
        FROM research_reports
        WHERE title LIKE ? OR institution LIKE ? OR ticker LIKE ?
        LIMIT ?
        """,
        (term, term, term, limit),
    ).fetchall()


def sync_matching_stock(conn: sqlite3.Connection, q: str, limit: int) -> None:
    stripped = q.strip()
    if not stripped:
        return

    if is_plain_stock_code(stripped):
        sync_stock_codes(conn, [stripped])
        return

    local_symbols = find_local_stock_symbols(conn, stripped, limit)
    if local_symbols:
        sync_stock_codes(conn, local_symbols)
        return

    if len(stripped) < 2:
        return
    if len(stripped) > 8:
        return

    try:
        import akshare as ak

        rows = akshare_sync.fetch_code_name_rows(ak, DataSyncJobCreate(limit=limit))
        matches = [
            row["code"]
            for row in rows
            if stripped in row["name"] or stripped.upper() in row["code"].upper()
        ][:limit]
        if matches:
            sync_stock_codes(conn, matches)
    except Exception:
        return


def find_local_stock_symbols(conn: sqlite3.Connection, q: str, limit: int) -> list[str]:
    term = f"%{q}%"
    rows = conn.execute(
        """
        SELECT DISTINCT ticker AS symbol
        FROM research_reports
        WHERE ticker LIKE ? OR ticker_name LIKE ?
        LIMIT ?
        """,
        (term, term, limit),
    ).fetchall()
    return [row["symbol"] for row in rows if row["symbol"]]


def sync_stock_codes(conn: sqlite3.Connection, codes: list[str]) -> None:
    try:
        akshare_sync.run_sync(conn, DataSyncJobCreate(symbols=codes, limit=max(len(codes), 1)))
    except Exception:
        return


def is_plain_stock_code(q: str) -> bool:
    return len(q) == 6 and q.isdigit()
