import sqlite3


def search(conn: sqlite3.Connection, q: str, limit: int) -> dict:
    term = f"%{q}%"
    stock_rows = conn.execute(
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
    remaining = max(limit - len(stock_rows), 0)
    report_rows = conn.execute(
        """
        SELECT id, title, institution || ' · ' || report_date AS subtitle
        FROM research_reports
        WHERE title LIKE ? OR institution LIKE ? OR ticker LIKE ?
        LIMIT ?
        """,
        (term, term, term, remaining),
    ).fetchall()
    return {
        "items": [
            {"type": "stock", **dict(row)} for row in stock_rows
        ]
        + [
            {"type": "report", **dict(row)} for row in report_rows
        ]
    }
