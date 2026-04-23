import sqlite3

from app.repositories.utils import format_market_cap


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
        SELECT DISTINCT ownership
        FROM stock_fundamentals
        WHERE ownership IS NOT NULL AND ownership != ''
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
        where.append(f"f.ownership IN ({placeholders})")
        params.extend(payload.ownership)

    if payload.exchanges:
        placeholders = ",".join("?" for _ in payload.exchanges)
        where.append(f"f.exchange IN ({placeholders})")
        params.extend(payload.exchanges)

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
    total = conn.execute(
        f"SELECT COUNT(*) FROM stock_fundamentals f {where_sql}",
        params,
    ).fetchone()[0]
    available_total = conn.execute(
        """
        SELECT COUNT(*)
        FROM stock_fundamentals f
        JOIN (
            SELECT symbol, close, pct_change, MAX(trade_date) AS trade_date
            FROM stock_daily_prices
            GROUP BY symbol
        ) p ON p.symbol = f.symbol
        """
    ).fetchone()[0]

    order_by = build_order_by(payload.sort)
    offset = (payload.page - 1) * payload.page_size
    rows = conn.execute(
        f"""
        SELECT
            f.symbol,
            f.name,
            f.sector,
            f.market_cap,
            f.pe_ttm,
            f.dividend_yield,
            f.ma120,
            f.ma120_lower,
            f.ma120_upper,
            f.signal,
            p.close AS price,
            p.pct_change AS change
        FROM stock_fundamentals f
        JOIN (
            SELECT symbol, close, pct_change, MAX(trade_date) AS trade_date
            FROM stock_daily_prices
            GROUP BY symbol
        ) p ON p.symbol = f.symbol
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
        "industry": row["sector"] or "未分类",
        "marketCap": format_market_cap(row["market_cap"]),
        "pe": row["pe_ttm"],
        "dividend": row["dividend_yield"] or 0.0,
        "initial": initials.get(row["symbol"], row["symbol"][0]),
        "ma120": row["ma120"],
        "ma120Lower": row["ma120_lower"],
        "ma120Upper": row["ma120_upper"],
        "signal": row["signal"],
    }
