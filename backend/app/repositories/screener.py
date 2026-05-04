import json
import sqlite3

from app.repositories.utils import format_market_cap
from app.services import market_data


SORT_COLUMNS = {
    "marketCap": "f.market_cap",
    "price": "p.close",
    "change": "p.pct_change",
    "pe": "f.pe_ttm",
    "dividend": "f.dividend_yield",
    "signal": "CASE f.signal WHEN 'sell' THEN 1 WHEN 'hold' THEN 2 WHEN 'buy' THEN 3 ELSE 0 END",
    "ma120": "f.ma120",
    "symbol": "f.symbol",
    "name": "f.name",
}


def get_options(conn: sqlite3.Connection) -> dict:
    ownership_rows = conn.execute(
        """
        SELECT DISTINCT COALESCE(NULLIF(o.ownership, ''), f.ownership) AS ownership
        FROM stock_fundamentals f
        LEFT JOIN stock_metadata_overrides o ON o.symbol = f.symbol
        WHERE COALESCE(NULLIF(o.ownership, ''), f.ownership) IS NOT NULL
            AND COALESCE(NULLIF(o.ownership, ''), f.ownership) != ''
        ORDER BY ownership
        """
    ).fetchall()
    exchange_rows = conn.execute(
        """
        SELECT DISTINCT exchange
        FROM stock_fundamentals
        WHERE exchange IS NOT NULL AND exchange != ''
        ORDER BY exchange
        """
    ).fetchall()

    return {
        "numericFilters": [
            {"key": "pe", "label": "市盈率 (PE) <", "operator": "lt", "defaultValue": 15},
            {"key": "dividend", "label": "股息率 (%) >", "operator": "gt", "defaultValue": 3.5},
            {"key": "marketCap", "label": "市值 (亿 ¥) >", "operator": "gt", "defaultValue": 500},
        ],
        "ownership": [row["ownership"] for row in ownership_rows],
        "exchanges": [row["exchange"] for row in exchange_rows],
    }


def query(conn: sqlite3.Connection, payload) -> dict:
    where = []
    params: list[object] = []

    if payload.ownership:
        placeholders = ",".join("?" for _ in payload.ownership)
        where.append(f"COALESCE(NULLIF(o.ownership, ''), f.ownership) IN ({placeholders})")
        params.extend(payload.ownership)

    if payload.exchanges:
        placeholders = ",".join("?" for _ in payload.exchanges)
        where.append(f"f.exchange IN ({placeholders})")
        params.extend(payload.exchanges)

    if payload.signals:
        placeholders = ",".join("?" for _ in payload.signals)
        where.append(f"f.signal IN ({placeholders})")
        params.extend(getattr(signal, "value", signal) for signal in payload.signals)

    filters = payload.filters or {}
    pe_filter = filters.get("pe")
    if isinstance(pe_filter, dict) and pe_filter.get("value") is not None:
        operator = "<" if pe_filter.get("operator") == "lt" else ">"
        where.append("f.pe_ttm > 0")
        where.append(f"f.pe_ttm {operator} ?")
        params.append(float(pe_filter["value"]))

    dividend_filter = filters.get("dividend")
    if isinstance(dividend_filter, dict) and dividend_filter.get("value") is not None:
        operator = "<" if dividend_filter.get("operator") == "lt" else ">"
        where.append(f"f.dividend_yield {operator} ?")
        params.append(float(dividend_filter["value"]))

    market_cap_filter = filters.get("marketCap")
    if isinstance(market_cap_filter, dict) and market_cap_filter.get("value") is not None:
        operator = "<" if market_cap_filter.get("operator") == "lt" else ">"
        where.append("f.market_cap > 0")
        where.append(f"f.market_cap {operator} ?")
        params.append(float(market_cap_filter["value"]))

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    latest_prices_sql = """
        WITH latest_price_dates AS (
            SELECT symbol, MAX(trade_date) AS trade_date
            FROM stock_daily_prices
            GROUP BY symbol
        ),
        latest_prices AS (
            SELECT p.symbol, p.close, p.pct_change, p.trade_date
            FROM stock_daily_prices p
            JOIN latest_price_dates l
              ON l.symbol = p.symbol AND l.trade_date = p.trade_date
        )
    """
    total = conn.execute(
        f"""
        {latest_prices_sql}
        SELECT COUNT(*)
        FROM stock_fundamentals f
        LEFT JOIN stock_metadata_overrides o ON o.symbol = f.symbol
        JOIN latest_prices p ON p.symbol = f.symbol
        {where_sql}
        """,
        params,
    ).fetchone()[0]
    available_total = conn.execute(
        f"""
        {latest_prices_sql}
        SELECT COUNT(*)
        FROM stock_fundamentals f
        LEFT JOIN stock_metadata_overrides o ON o.symbol = f.symbol
        JOIN latest_prices p ON p.symbol = f.symbol
        """,
    ).fetchone()[0]

    order_by = build_order_by(payload.sort)
    offset = (payload.page - 1) * payload.page_size
    rows = conn.execute(
        f"""
        {latest_prices_sql}
        SELECT
            f.symbol,
            f.name,
            f.exchange,
            f.listing_exchange,
            COALESCE(NULLIF(o.ownership, ''), f.ownership) AS ownership,
            COALESCE(NULLIF(o.sector, ''), f.sector) AS sector,
            f.market_cap,
            f.pe_ttm,
            f.dividend_yield,
            f.ma120,
            f.ma120_lower,
            f.ma120_upper,
            f.revenue_segments_json,
            f.signal,
            p.close AS price,
            p.pct_change AS change,
            p.trade_date
        FROM stock_fundamentals f
        LEFT JOIN stock_metadata_overrides o ON o.symbol = f.symbol
        JOIN latest_prices p ON p.symbol = f.symbol
        {where_sql}
        ORDER BY {order_by}
        LIMIT ? OFFSET ?
        """,
        [*params, payload.page_size, offset],
    ).fetchall()

    return {
        "items": [to_screener_item(row) for row in rows],
        "page": payload.page,
        "pageSize": payload.page_size,
        "total": total,
        "availableTotal": available_total,
    }


def build_order_by(sort: dict | None) -> str:
    if not sort:
        return "f.market_cap DESC, f.symbol ASC"

    field = sort.get("field")
    column = SORT_COLUMNS.get(field)
    if not column:
        return "f.market_cap DESC, f.symbol ASC"

    direction = "ASC" if sort.get("direction") == "asc" else "DESC"
    return f"{column} {direction}, f.symbol ASC"


def to_screener_item(row: sqlite3.Row) -> dict:
    initials = {
        "600519.SH": "M",
        "300750.SZ": "C",
        "002594.SZ": "B",
        "600036.SH": "Z",
    }
    return {
        "symbol": row["symbol"],
        "name": row["name"],
        "price": row["price"],
        "change": row["change"],
        "exchange": row["exchange"] or "",
        "listingExchange": row["exchange"] or row["listing_exchange"] or market_data.listing_exchange_name(row["symbol"]),
        "ownership": row["ownership"] or "未知",
        "tradeDate": row["trade_date"],
        "industry": row["sector"] or "未分类",
        "marketCap": format_market_cap(row["market_cap"]),
        "pe": row["pe_ttm"],
        "dividend": row["dividend_yield"] or 0.0,
        "revenueSegments": parse_revenue_segments(row["revenue_segments_json"]),
        "initial": initials.get(row["symbol"], row["symbol"][0]),
        "ma120": row["ma120"],
        "ma120Lower": row["ma120_lower"],
        "ma120Upper": row["ma120_upper"],
        "signal": row["signal"],
    }


def parse_revenue_segments(value: object) -> list[dict]:
    try:
        segments = json.loads(str(value or "[]"))
    except json.JSONDecodeError:
        return []
    if not isinstance(segments, list):
        return []

    parsed = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        name = str(segment.get("name") or "").strip()
        if not name:
            continue
        try:
            revenue_percent = float(segment.get("revenue_percent") or segment.get("revenuePercent") or 0.0)
        except (TypeError, ValueError):
            revenue_percent = 0.0
        parsed.append(
            {
                "name": name,
                "revenuePercent": revenue_percent,
            }
        )
    return parsed
