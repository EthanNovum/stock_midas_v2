import sqlite3


def list_reports(
    conn: sqlite3.Connection,
    q: str | None,
    rating: str | None,
    institution: str | None,
    ticker: str | None,
    page: int,
    page_size: int,
) -> dict:
    where = []
    params: list[object] = []
    if q:
        where.append("(title LIKE ? OR institution LIKE ? OR ticker LIKE ?)")
        term = f"%{q}%"
        params.extend([term, term, term])
    if rating:
        where.append("rating=?")
        params.append(rating)
    if institution:
        where.append("institution=?")
        params.append(institution)
    if ticker:
        where.append("ticker=?")
        params.append(ticker)

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) FROM research_reports {where_sql}", params).fetchone()[0]
    rows = conn.execute(
        f"""
        SELECT id, title, ticker, ticker_name AS tickerName, rating, institution, report_date AS date
        FROM research_reports
        {where_sql}
        ORDER BY report_date DESC
        LIMIT ? OFFSET ?
        """,
        [*params, page_size, (page - 1) * page_size],
    ).fetchall()
    return {"items": [dict(row) for row in rows], "page": page, "pageSize": page_size, "total": total}


def get_report(conn: sqlite3.Connection, report_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT id, title, ticker, ticker_name AS tickerName, rating, institution,
               report_date AS date, content
        FROM research_reports
        WHERE id=?
        """,
        (report_id,),
    ).fetchone()
    if not row:
        return None
    kline_rows = conn.execute(
        "SELECT date, open, close, high, low, volume FROM report_klines WHERE report_id=? ORDER BY id",
        (report_id,),
    ).fetchall()
    return {**dict(row), "klineData": [dict(item) for item in kline_rows]}


def create_report(conn: sqlite3.Connection, payload) -> dict:
    row = conn.execute("SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) + 1 AS id FROM research_reports").fetchone()
    report_id = str(row["id"])
    conn.execute(
        """
        INSERT INTO research_reports
        (id, title, ticker, ticker_name, rating, institution, report_date, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """,
        (
            report_id,
            payload.title,
            payload.ticker,
            payload.ticker_name,
            payload.rating.value,
            payload.institution,
            payload.date.isoformat(),
            payload.content,
        ),
    )
    conn.commit()
    return {"id": report_id}
