import json
import sqlite3
from datetime import datetime

from app.repositories.watchlists import normalize_symbol
from app.timeutils import now_iso

VALID_DETAIL_RANGES = {"intraday", "5d", "daily", "weekly", "monthly"}
VALID_OWNERSHIP_VALUES = {"央企", "地方国企", "民营企业", "未知"}


class StockDetailError(ValueError):
    pass


def get_stock_detail(conn: sqlite3.Connection, symbol: str, range_name: str) -> dict:
    normalized_symbol = normalize_symbol(symbol)
    normalized_range = range_name if range_name in VALID_DETAIL_RANGES else None
    if not normalized_range:
        raise StockDetailError("无效的走势图区间")

    stock = conn.execute(
        """
        SELECT
            f.symbol,
            f.name,
            COALESCE(NULLIF(o.sector, ''), f.sector) AS sector,
            COALESCE(NULLIF(o.ownership, ''), f.ownership) AS ownership,
            f.revenue_segments_json,
            f.pe_ttm,
            f.pb,
            f.market_cap,
            f.dividend_yield
        FROM stock_fundamentals f
        LEFT JOIN stock_metadata_overrides o ON o.symbol = f.symbol
        WHERE f.symbol=?
        """,
        (normalized_symbol,),
    ).fetchone()
    if not stock:
        raise StockDetailError("股票不存在")

    rows = price_rows_for_range(conn, normalized_symbol, normalized_range)
    if normalized_range == "weekly":
        points = aggregate_rows(rows, "week")
    elif normalized_range == "monthly":
        points = aggregate_rows(rows, "month")
    else:
        points = [dict(row) for row in rows]

    latest = points[-1] if points else None
    return {
        "symbol": stock["symbol"],
        "name": stock["name"],
        "industry": stock["sector"],
        "ownership": stock["ownership"],
        "mainBusiness": format_main_business(stock["revenue_segments_json"]),
        "latestPrice": latest["close"] if latest else None,
        "change": latest["close"] - latest["open"] if latest else None,
        "pctChange": latest["pct"] if latest else None,
        "tradeDate": latest["date"] if latest else None,
        "metrics": {
            "pe": stock["pe_ttm"],
            "pb": stock["pb"],
            "marketCap": stock["market_cap"],
            "dividendYield": stock["dividend_yield"],
        },
        "chart": {
            "range": normalized_range,
            "points": points,
        },
    }


def update_stock_metadata(
    conn: sqlite3.Connection,
    symbol: str,
    range_name: str = "daily",
    industry: str | None = None,
    ownership: str | None = None,
) -> dict:
    normalized_symbol = normalize_symbol(symbol)
    stock = conn.execute(
        "SELECT symbol FROM stock_fundamentals WHERE symbol=?",
        (normalized_symbol,),
    ).fetchone()
    if not stock:
        raise StockDetailError("股票不存在")

    normalized_industry = normalize_metadata_text(industry)
    normalized_ownership = normalize_metadata_text(ownership)
    if normalized_ownership and normalized_ownership not in VALID_OWNERSHIP_VALUES:
        raise StockDetailError("无效的公司性质")
    if normalized_industry is None and normalized_ownership is None:
        raise StockDetailError("请至少填写行业或公司性质")

    current = conn.execute(
        """
        SELECT sector, ownership
        FROM stock_metadata_overrides
        WHERE symbol=?
        """,
        (normalized_symbol,),
    ).fetchone()
    next_industry = normalized_industry if normalized_industry is not None else (current["sector"] if current else None)
    next_ownership = normalized_ownership if normalized_ownership is not None else (current["ownership"] if current else None)

    conn.execute(
        """
        INSERT INTO stock_metadata_overrides (symbol, sector, ownership, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            sector=excluded.sector,
            ownership=excluded.ownership,
            updated_at=excluded.updated_at
        """,
        (normalized_symbol, next_industry, next_ownership, now_iso()),
    )
    conn.commit()
    return get_stock_detail(conn, normalized_symbol, range_name)


def normalize_metadata_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def format_main_business(value: str | None) -> str | None:
    if not value:
        return None
    try:
        segments = json.loads(value)
    except json.JSONDecodeError:
        return None
    if not isinstance(segments, list):
        return None

    business_parts: list[str] = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        name = str(segment.get("name") or "").strip()
        if not name:
            continue
        percent_value = segment.get("revenue_percent")
        if isinstance(percent_value, (int, float)):
            percent_text = f"{percent_value:.2f}".rstrip("0").rstrip(".")
            business_parts.append(f"{name} {percent_text}%")
        else:
            business_parts.append(name)

    if not business_parts:
        return None
    return " / ".join(business_parts)


def price_rows_for_range(conn: sqlite3.Connection, symbol: str, range_name: str) -> list[sqlite3.Row]:
    limits = {
        "intraday": 30,
        "5d": 5,
        "daily": 160,
        "weekly": 520,
        "monthly": 1200,
    }
    rows = conn.execute(
        """
        SELECT
            trade_date AS date,
            open,
            close,
            COALESCE(high, close) AS high,
            COALESCE(low, close) AS low,
            COALESCE(volume, 0) AS volume,
            COALESCE(pct_change, 0) AS pct
        FROM stock_daily_prices
        WHERE symbol=?
        ORDER BY trade_date DESC
        LIMIT ?
        """,
        (symbol, limits[range_name]),
    ).fetchall()
    return list(reversed(rows))


def aggregate_rows(rows: list[sqlite3.Row], mode: str) -> list[dict]:
    buckets: dict[str, dict] = {}
    order: list[str] = []

    for row in rows:
        key = bucket_key(row["date"], mode)
        if key not in buckets:
            buckets[key] = {
                "date": row["date"] if mode == "week" else key,
                "open": row["open"],
                "close": row["close"],
                "high": row["high"],
                "low": row["low"],
                "volume": 0,
                "pct": row["pct"],
            }
            order.append(key)

        point = buckets[key]
        if mode == "week":
            point["date"] = row["date"]
        point["close"] = row["close"]
        point["high"] = max(point["high"], row["high"])
        point["low"] = min(point["low"], row["low"])
        point["volume"] += row["volume"]
        point["pct"] = row["pct"]

    return [buckets[key] for key in order]


def bucket_key(date_text: str, mode: str) -> str:
    year, month, day = (int(part) for part in date_text.split("-"))
    current = datetime(year, month, day)
    if mode == "month":
        return f"{current.year}-{str(current.month).zfill(2)}"
    iso_year, iso_week, _ = current.isocalendar()
    return f"{iso_year}-W{str(iso_week).zfill(2)}"
