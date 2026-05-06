import base64
import binascii
import sqlite3

from app.repositories import watchlists


RATING_LABELS = {
    "buy": "买入",
    "hold": "维持",
    "sell": "卖出",
}


def normalize_institution_name(name: str | None) -> str:
    return (name or "").strip()


def institution_exists(conn: sqlite3.Connection, name: str) -> bool:
    if conn.execute("SELECT 1 FROM report_institutions WHERE name=?", (name,)).fetchone():
        return True
    return conn.execute("SELECT 1 FROM research_reports WHERE institution=? LIMIT 1", (name,)).fetchone() is not None


def list_reports(
    conn: sqlite3.Connection,
    q: str | None,
    rating: str | None,
    institution: str | None,
    ticker: str | None,
    page: int,
    page_size: int,
) -> dict:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    where = []
    params: list[object] = []
    if q:
        where.append(
            """
            (
                title LIKE ?
                OR content LIKE ?
                OR institution LIKE ?
                OR ticker LIKE ?
                OR ticker_name LIKE ?
                OR EXISTS (
                    SELECT 1
                    FROM report_stocks rs
                    WHERE rs.report_id = research_reports.id
                        AND (rs.symbol LIKE ? OR rs.name LIKE ?)
                )
            )
            """
        )
        term = f"%{q}%"
        params.extend([term, term, term, term, term, term, term])
    if rating:
        where.append("rating=?")
        params.append(rating)
    if institution:
        where.append("institution=?")
        params.append(institution)
    if ticker:
        where.append(
            """
            (
                ticker=?
                OR EXISTS (
                    SELECT 1
                    FROM report_stocks rs
                    WHERE rs.report_id = research_reports.id
                        AND rs.symbol=?
                )
            )
            """
        )
        params.extend([ticker, ticker])

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) FROM research_reports {where_sql}", params).fetchone()[0]
    rows = conn.execute(
        f"""
        SELECT id, title, ticker, ticker_name AS tickerName, rating, institution,
               report_date AS date, source_url AS sourceUrl, source_file_name AS sourceFileName
        FROM research_reports
        {where_sql}
        ORDER BY report_date DESC, created_at DESC
        LIMIT ? OFFSET ?
        """,
        [*params, page_size, (page - 1) * page_size],
    ).fetchall()
    items = [dict(row) for row in rows]
    add_report_stocks(conn, items)
    report_institutions = {
        row["institution"]
        for row in conn.execute("SELECT DISTINCT institution FROM research_reports WHERE institution != ''").fetchall()
    }
    managed_institutions = {
        row["name"] for row in conn.execute("SELECT name FROM report_institutions WHERE name != ''").fetchall()
    }
    institutions = sorted(report_institutions | managed_institutions)
    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "institutions": institutions,
        "institutionRankings": institution_rankings(conn),
    }


def institution_rankings(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
            research_reports.institution,
            COUNT(DISTINCT research_reports.id) AS reportCount,
            COUNT(COALESCE(rs.symbol, research_reports.ticker)) AS stockMentions,
            SUM(CASE WHEN COALESCE(rs.verdict, 'flat') = 'win' THEN 1 ELSE 0 END) AS wins
        FROM research_reports
        LEFT JOIN report_stocks rs ON rs.report_id = research_reports.id
        GROUP BY research_reports.institution
        HAVING stockMentions > 0
        ORDER BY
            CAST(wins AS REAL) / stockMentions DESC,
            wins DESC,
            stockMentions DESC,
            research_reports.institution
        """,
    ).fetchall()
    rankings = []
    for row in rows:
        stock_mentions = row["stockMentions"]
        wins = row["wins"] or 0
        rankings.append(
            {
                "institution": row["institution"],
                "reportCount": row["reportCount"],
                "stockMentions": stock_mentions,
                "wins": wins,
                "winRate": round((wins / stock_mentions) * 100, 2) if stock_mentions else 0,
            }
        )
    return rankings


def get_institution_ranking(conn: sqlite3.Connection, institution: str) -> dict | None:
    row = conn.execute(
        """
        SELECT
            research_reports.institution,
            COUNT(DISTINCT research_reports.id) AS reportCount,
            COUNT(COALESCE(rs.symbol, research_reports.ticker)) AS stockMentions,
            SUM(CASE WHEN COALESCE(rs.verdict, 'flat') = 'win' THEN 1 ELSE 0 END) AS wins
        FROM research_reports
        LEFT JOIN report_stocks rs ON rs.report_id = research_reports.id
        WHERE research_reports.institution=?
        GROUP BY research_reports.institution
        HAVING reportCount > 0
        """,
        (institution,),
    ).fetchone()
    if not row:
        return None

    stock_mentions = row["stockMentions"] or 0
    wins = row["wins"] or 0
    return {
        "institution": row["institution"],
        "reportCount": row["reportCount"],
        "stockMentions": stock_mentions,
        "wins": wins,
        "winRate": round((wins / stock_mentions) * 100, 2) if stock_mentions else 0,
    }


def create_institution(conn: sqlite3.Connection, name: str) -> dict:
    institution_name = normalize_institution_name(name)
    if not institution_name:
        raise ValueError("机构名称不能为空")
    if institution_exists(conn, institution_name):
        raise ValueError("机构已存在")

    conn.execute(
        "INSERT INTO report_institutions (name, created_at) VALUES (?, datetime('now'))",
        (institution_name,),
    )
    conn.commit()
    return {"name": institution_name}


def rename_institution(conn: sqlite3.Connection, institution: str, new_name: str) -> dict | None:
    source_name = normalize_institution_name(institution)
    target_name = normalize_institution_name(new_name)
    if not source_name:
        raise ValueError("机构名称不能为空")
    if not target_name:
        raise ValueError("新机构名称不能为空")

    report_exists = conn.execute(
        "SELECT 1 FROM research_reports WHERE institution=? LIMIT 1",
        (source_name,),
    ).fetchone() is not None
    managed_exists = conn.execute(
        "SELECT 1 FROM report_institutions WHERE name=?",
        (source_name,),
    ).fetchone() is not None
    if not report_exists and not managed_exists:
        return None

    if source_name != target_name and institution_exists(conn, target_name):
        raise ValueError("新机构名称已存在")

    conn.execute(
        """
        UPDATE research_reports
        SET institution=?
        WHERE institution=?
        """,
        (target_name, source_name),
    )
    if managed_exists:
        conn.execute("DELETE FROM report_institutions WHERE name=?", (source_name,))
    if not conn.execute("SELECT 1 FROM research_reports WHERE institution=? LIMIT 1", (target_name,)).fetchone():
        conn.execute(
            "INSERT OR IGNORE INTO report_institutions (name, created_at) VALUES (?, datetime('now'))",
            (target_name,),
        )

    conn.commit()
    return get_institution_ranking(conn, target_name) or {
        "institution": target_name,
        "reportCount": 0,
        "stockMentions": 0,
        "wins": 0,
        "winRate": 0,
    }


def delete_institution(conn: sqlite3.Connection, institution: str) -> dict | None:
    source_name = normalize_institution_name(institution)
    if not source_name:
        raise ValueError("机构名称不能为空")

    ranking = get_institution_ranking(conn, source_name)
    managed_exists = conn.execute(
        "SELECT 1 FROM report_institutions WHERE name=?",
        (source_name,),
    ).fetchone() is not None
    if not ranking and not managed_exists:
        return None

    report_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM research_reports WHERE institution=?",
            (source_name,),
        ).fetchall()
    ]
    if report_ids:
        placeholders = ",".join("?" for _ in report_ids)
        conn.execute(f"DELETE FROM report_stocks WHERE report_id IN ({placeholders})", report_ids)
        conn.execute(f"DELETE FROM report_klines WHERE report_id IN ({placeholders})", report_ids)
    conn.execute("DELETE FROM research_reports WHERE institution=?", (source_name,))
    conn.execute("DELETE FROM report_institutions WHERE name=?", (source_name,))
    conn.commit()
    return ranking or {
        "institution": source_name,
        "reportCount": 0,
        "stockMentions": 0,
        "wins": 0,
        "winRate": 0,
    }


def delete_report(conn: sqlite3.Connection, report_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT id, title, institution
        FROM research_reports
        WHERE id=?
        """,
        (report_id,),
    ).fetchone()
    if not row:
        return None

    conn.execute("DELETE FROM report_stocks WHERE report_id=?", (report_id,))
    conn.execute("DELETE FROM report_klines WHERE report_id=?", (report_id,))
    conn.execute("DELETE FROM research_reports WHERE id=?", (report_id,))
    conn.commit()
    return {"id": row["id"], "title": row["title"], "institution": row["institution"]}


def get_report(conn: sqlite3.Connection, report_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT id, title, ticker, ticker_name AS tickerName, rating, institution,
               report_date AS date, content, source_url AS sourceUrl,
               source_file_name AS sourceFileName, source_file_mime AS sourceFileMime
        FROM research_reports
        WHERE id=?
        """,
        (report_id,),
    ).fetchone()
    if not row:
        return None

    report = dict(row)
    stocks = get_report_stocks(conn, report_id)
    if not stocks and report["ticker"]:
        stocks = [{"symbol": report["ticker"], "name": report["tickerName"], "verdict": "flat"}]

    kline_series = [
        {
            "symbol": stock["symbol"],
            "name": stock["name"] or stock["symbol"],
            "verdict": stock.get("verdict") or "flat",
            **price_series_for_stock(conn, stock["symbol"], report["date"]),
        }
        for stock in stocks
    ]
    fallback_kline = legacy_report_klines(conn, report_id)
    if kline_series:
        kline_series[0]["klineData"] = kline_series[0]["klineData"] or fallback_kline

    return {
        **report,
        "stocks": stocks,
        "klineSeries": kline_series,
        "klineData": kline_series[0]["klineData"] if kline_series else fallback_kline,
    }


def create_report(conn: sqlite3.Connection, payload) -> dict:
    stocks = normalize_payload_stocks(conn, payload)
    if not stocks:
        raise ValueError("请至少选择一只相关股票")

    institution_name = normalize_institution_name(payload.institution)
    if not institution_name:
        raise ValueError("请填写观点方")

    row = conn.execute("SELECT COALESCE(MAX(CAST(id AS INTEGER)), 0) + 1 AS id FROM research_reports").fetchone()
    report_id = str(row["id"])
    primary_stock = stocks[0]
    title = payload.title or default_title(primary_stock, institution_name, payload.rating.value, payload.date.isoformat())
    file_data = decode_file_content(payload.source_file_content)

    conn.execute(
        """
        INSERT INTO research_reports
        (
            id, title, ticker, ticker_name, rating, institution, report_date,
            content, source_url, source_file_name, source_file_mime, source_file_data, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """,
        (
            report_id,
            title,
            primary_stock["symbol"],
            primary_stock["name"] or primary_stock["symbol"],
            payload.rating.value,
            institution_name,
            payload.date.isoformat(),
            payload.content,
            payload.source_url,
            payload.source_file_name,
            payload.source_file_mime,
            file_data,
        ),
    )
    conn.executemany(
        """
        INSERT INTO report_stocks (report_id, symbol, name, verdict)
        VALUES (?, ?, ?, 'flat')
        """,
        [(report_id, stock["symbol"], stock["name"]) for stock in stocks],
    )
    for stock in stocks:
        watchlists.add_stock_to_report_watchlist(conn, stock["symbol"])
    conn.commit()
    return {"id": report_id}


def update_report(conn: sqlite3.Connection, report_id: str, payload) -> dict | None:
    title = payload.title.strip()
    content = payload.content.strip()
    if not title:
        raise ValueError("请填写研报标题")
    if not content:
        raise ValueError("请填写研报正文")

    stocks = normalize_payload_stocks(conn, payload)
    if not stocks:
        raise ValueError("请至少选择一只相关股票")

    existing = conn.execute("SELECT id FROM research_reports WHERE id=?", (report_id,)).fetchone()
    if not existing:
        return None

    primary_stock = stocks[0]
    conn.execute(
        """
        UPDATE research_reports
        SET title=?, ticker=?, ticker_name=?, rating=?, report_date=?, content=?
        WHERE id=?
        """,
        (
            title,
            primary_stock["symbol"],
            primary_stock["name"] or primary_stock["symbol"],
            payload.rating.value,
            payload.date.isoformat(),
            content,
            report_id,
        ),
    )
    conn.execute("DELETE FROM report_stocks WHERE report_id=?", (report_id,))
    conn.executemany(
        """
        INSERT INTO report_stocks (report_id, symbol, name, verdict)
        VALUES (?, ?, ?, 'flat')
        """,
        [(report_id, stock["symbol"], stock["name"]) for stock in stocks],
    )
    for stock in stocks:
        watchlists.add_stock_to_report_watchlist(conn, stock["symbol"])
    conn.commit()
    return get_report(conn, report_id)


def get_report_file(conn: sqlite3.Connection, report_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT source_file_name AS fileName, source_file_mime AS mimeType, source_file_data AS data
        FROM research_reports
        WHERE id=? AND source_file_data IS NOT NULL
        """,
        (report_id,),
    ).fetchone()
    return dict(row) if row else None


def add_report_stocks(conn: sqlite3.Connection, reports: list[dict]) -> None:
    if not reports:
        return
    ids = [report["id"] for report in reports]
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""
        SELECT report_id, symbol, name, verdict
        FROM report_stocks
        WHERE report_id IN ({placeholders})
        ORDER BY id
        """,
        ids,
    ).fetchall()
    stock_map: dict[str, list[dict]] = {}
    for row in rows:
        stock_map.setdefault(row["report_id"], []).append(
            {"symbol": row["symbol"], "name": row["name"], "verdict": row["verdict"] or "flat"}
        )

    for report in reports:
        report["stocks"] = stock_map.get(
            report["id"],
            [{"symbol": report["ticker"], "name": report["tickerName"], "verdict": "flat"}] if report.get("ticker") else [],
        )


def get_report_stocks(conn: sqlite3.Connection, report_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT symbol, name, verdict
        FROM report_stocks
        WHERE report_id=?
        ORDER BY id
        """,
        (report_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def update_report_stock_verdict(conn: sqlite3.Connection, report_id: str, symbol: str, verdict: str) -> dict | None:
    normalized_symbol = normalize_symbol(symbol)
    cursor = conn.execute(
        """
        UPDATE report_stocks
        SET verdict=?
        WHERE report_id=? AND symbol=?
        """,
        (verdict, report_id, normalized_symbol),
    )
    if cursor.rowcount == 0:
        return None
    conn.commit()
    row = conn.execute(
        """
        SELECT symbol, name, verdict
        FROM report_stocks
        WHERE report_id=? AND symbol=?
        """,
        (report_id, normalized_symbol),
    ).fetchone()
    return dict(row) if row else None


def normalize_payload_stocks(conn: sqlite3.Connection, payload) -> list[dict]:
    raw_stocks = [{"symbol": item.symbol, "name": item.name} for item in payload.stocks]
    if not raw_stocks and payload.ticker:
        raw_stocks = [{"symbol": payload.ticker, "name": payload.ticker_name}]

    normalized: list[dict] = []
    seen = set()
    for stock in raw_stocks:
        symbol = normalize_symbol(stock["symbol"])
        if not symbol or symbol in seen:
            continue
        name = (stock["name"] or lookup_stock_name(conn, symbol) or symbol).strip()
        normalized.append({"symbol": symbol, "name": name})
        seen.add(symbol)
    return normalized


def normalize_symbol(symbol: str | None) -> str:
    return (symbol or "").strip().upper()


def lookup_stock_name(conn: sqlite3.Connection, symbol: str) -> str | None:
    row = conn.execute("SELECT name FROM stock_fundamentals WHERE symbol=?", (symbol,)).fetchone()
    return row["name"] if row else None


def default_title(stock: dict, institution: str, rating: str, report_date: str) -> str:
    rating_label = RATING_LABELS.get(rating, rating)
    return f"{stock['name'] or stock['symbol']}：{institution}{report_date}观点（{rating_label}）"


def decode_file_content(content: str | None) -> bytes | None:
    if not content:
        return None
    encoded = content.split(",", 1)[1] if content.startswith("data:") and "," in content else content
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("上传文件内容不是有效的 Base64") from exc


def price_series_for_stock(conn: sqlite3.Connection, symbol: str, start_date: str) -> dict:
    effective_start_date = effective_price_start_date(conn, symbol, start_date)
    rows = conn.execute(
        """
        SELECT trade_date AS date, open, close, high, low, COALESCE(volume, 0) AS volume
        FROM stock_daily_prices
        WHERE symbol=? AND trade_date>=?
        ORDER BY trade_date
        """,
        (symbol, effective_start_date),
    ).fetchall()
    kline_data = [dict(row) for row in rows]
    if len(kline_data) < 2:
        return {"klineData": kline_data, "startClose": None, "latestClose": None, "changePct": None}

    start_close = kline_data[0]["close"]
    latest_close = kline_data[-1]["close"]
    change_pct = ((latest_close - start_close) / start_close) * 100 if start_close else None
    return {
        "klineData": kline_data,
        "startClose": start_close,
        "latestClose": latest_close,
        "changePct": round(change_pct, 2) if change_pct is not None else None,
    }


def effective_price_start_date(conn: sqlite3.Connection, symbol: str, requested_start_date: str) -> str:
    row = conn.execute(
        """
        SELECT MAX(trade_date) AS latest_trade_date
        FROM stock_daily_prices
        WHERE symbol=?
        """,
        (symbol,),
    ).fetchone()
    latest_trade_date = row["latest_trade_date"] if row else None
    if latest_trade_date and requested_start_date > latest_trade_date:
        return latest_trade_date
    return requested_start_date


def legacy_report_klines(conn: sqlite3.Connection, report_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT date, open, close, high, low, volume FROM report_klines WHERE report_id=? ORDER BY id",
        (report_id,),
    ).fetchall()
    return [dict(item) for item in rows]
