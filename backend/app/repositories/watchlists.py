import hashlib
import sqlite3


DEFAULT_WATCHLIST_ID = "sector-my-watchlist"
DEFAULT_WATCHLIST_NAME = "自选分组"
VALID_CHART_RANGES = {"intraday", "5d", "daily", "weekly"}


class WatchlistError(ValueError):
    pass


def list_watchlists(conn: sqlite3.Connection, group_by: str) -> dict:
    ensure_default_watchlist(conn)
    if group_by == "flat":
        rows = stock_rows(conn, None)
        return {"groups": [{"id": "flat", "name": "全部自选", "stocks": rows}]}

    groups = conn.execute(
        """
        SELECT id, name, group_type
        FROM watchlists
        ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, created_at
        """,
        (DEFAULT_WATCHLIST_ID,),
    ).fetchall()
    return {
        "groups": [
            {
                "id": group["id"],
                "name": group["name"],
                "groupType": group["group_type"],
                "isDefault": group["id"] == DEFAULT_WATCHLIST_ID,
                "stocks": stock_rows(conn, group["id"]),
            }
            for group in groups
        ]
    }


def stock_rows(conn: sqlite3.Connection, watchlist_id: str | None) -> list[dict]:
    rows = conn.execute(
        """
        WITH latest AS (
            SELECT symbol, MAX(trade_date) AS latest_trade_date
            FROM stock_daily_prices
            GROUP BY symbol
        ),
        memberships AS (
            SELECT symbol, GROUP_CONCAT(DISTINCT watchlist_id) AS group_ids
            FROM watchlist_items
            GROUP BY symbol
        )
        SELECT
            substr(f.symbol, 1, instr(f.symbol, '.') - 1) AS id,
            f.symbol,
            f.name,
            f.sector,
            p.close AS price,
            printf('%.1fM', COALESCE(p.volume, 0) / 1000000.0) AS vol,
            COALESCE(p.pct_change, 0) AS pct,
            memberships.group_ids
        FROM watchlist_items wi
        JOIN stock_fundamentals f ON f.symbol = wi.symbol
        LEFT JOIN memberships ON memberships.symbol = f.symbol
        LEFT JOIN latest ON latest.symbol = f.symbol
        LEFT JOIN stock_daily_prices p
            ON p.symbol = latest.symbol
            AND p.trade_date = latest.latest_trade_date
        WHERE (? IS NULL OR wi.watchlist_id=?)
        GROUP BY f.symbol
        ORDER BY f.market_cap DESC
        """,
        (watchlist_id, watchlist_id),
    ).fetchall()
    return [
        {
            **{key: row[key] for key in row.keys() if key != "group_ids"},
            "industry": row["sector"],
            "groupIds": row["group_ids"].split(",") if row["group_ids"] else [],
            "trend": stock_trend(conn, row["symbol"]),
        }
        for row in rows
    ]


def stock_trend(conn: sqlite3.Connection, symbol: str) -> list[float]:
    rows = conn.execute(
        """
        SELECT close
        FROM stock_daily_prices
        WHERE symbol=?
        ORDER BY trade_date DESC
        LIMIT 7
        """,
        (symbol,),
    ).fetchall()
    return [row["close"] for row in reversed(rows)]


def create_watchlist(conn: sqlite3.Connection, payload) -> dict:
    name = normalize_name(payload.name)
    watchlist_id = unique_watchlist_id(conn, payload.group_type, name)
    try:
        conn.execute(
            "INSERT INTO watchlists (id, name, group_type, created_at) VALUES (?, ?, ?, datetime('now'))",
            (watchlist_id, name, payload.group_type),
        )
    except sqlite3.IntegrityError as exc:
        raise WatchlistError("自选分组已存在") from exc
    conn.commit()
    return {"id": watchlist_id, "name": name, "groupType": payload.group_type}


def update_watchlist(conn: sqlite3.Connection, watchlist_id: str, payload) -> dict:
    row = get_watchlist(conn, watchlist_id)
    name = normalize_name(payload.name)
    conn.execute(
        "UPDATE watchlists SET name=? WHERE id=?",
        (name, watchlist_id),
    )
    conn.commit()
    return {"id": watchlist_id, "name": name, "groupType": row["group_type"]}


def delete_watchlist(conn: sqlite3.Connection, watchlist_id: str) -> None:
    get_watchlist(conn, watchlist_id)
    if watchlist_id == DEFAULT_WATCHLIST_ID:
        raise WatchlistError("默认自选分组不能删除")
    conn.execute("DELETE FROM watchlist_items WHERE watchlist_id=?", (watchlist_id,))
    conn.execute("DELETE FROM watchlists WHERE id=?", (watchlist_id,))
    conn.commit()


def add_stock(conn: sqlite3.Connection, watchlist_id: str, payload) -> dict:
    get_watchlist(conn, watchlist_id)
    symbol = normalize_symbol(payload.symbol)
    conn.execute(
        "INSERT OR IGNORE INTO watchlist_items (watchlist_id, symbol, note, created_at) VALUES (?, ?, ?, datetime('now'))",
        (watchlist_id, symbol, payload.note),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM watchlist_items WHERE watchlist_id=? AND symbol=?",
        (watchlist_id, symbol),
    ).fetchone()
    return {"id": row["id"], "watchlistId": watchlist_id, "symbol": symbol}


def add_stock_to_default(conn: sqlite3.Connection, payload) -> dict:
    ensure_default_watchlist(conn)
    return add_stock(conn, DEFAULT_WATCHLIST_ID, payload)


def delete_stock(conn: sqlite3.Connection, watchlist_id: str, symbol: str) -> None:
    get_watchlist(conn, watchlist_id)
    conn.execute(
        "DELETE FROM watchlist_items WHERE watchlist_id=? AND symbol=?",
        (watchlist_id, normalize_symbol(symbol)),
    )
    conn.commit()


def ensure_default_watchlist(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO watchlists (id, name, group_type, created_at)
        VALUES (?, ?, 'sector', datetime('now'))
        """,
        (DEFAULT_WATCHLIST_ID, DEFAULT_WATCHLIST_NAME),
    )
    conn.execute(
        """
        UPDATE watchlists
        SET name=?
        WHERE id=? AND name='我的自选'
        """,
        (DEFAULT_WATCHLIST_NAME, DEFAULT_WATCHLIST_ID),
    )
    conn.commit()


def stock_chart(conn: sqlite3.Connection, symbol: str, range_name: str) -> dict:
    normalized_symbol = normalize_symbol(symbol)
    normalized_range = range_name if range_name in VALID_CHART_RANGES else "daily"
    source_rows = price_rows_for_range(conn, normalized_symbol, normalized_range)
    points = weekly_points(source_rows) if normalized_range == "weekly" else [dict(row) for row in source_rows]

    stock = conn.execute(
        "SELECT symbol, name FROM stock_fundamentals WHERE symbol=?",
        (normalized_symbol,),
    ).fetchone()
    return {
        "symbol": normalized_symbol,
        "name": stock["name"] if stock else normalized_symbol,
        "range": normalized_range,
        "points": points,
    }


def price_rows_for_range(conn: sqlite3.Connection, symbol: str, range_name: str) -> list[sqlite3.Row]:
    limits = {
        "intraday": 30,
        "5d": 5,
        "daily": 120,
        "weekly": 260,
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


def weekly_points(rows: list[sqlite3.Row]) -> list[dict]:
    weeks: dict[str, dict] = {}
    for row in rows:
        year_week = row["date"][:10]
        week_key = year_week[:4] + "-W" + sqlite_week_number(year_week)
        point = weeks.setdefault(
            week_key,
            {
                "date": row["date"],
                "open": row["open"],
                "close": row["close"],
                "high": row["high"],
                "low": row["low"],
                "volume": 0,
                "pct": row["pct"],
            },
        )
        point["date"] = row["date"]
        point["close"] = row["close"]
        point["high"] = max(point["high"], row["high"])
        point["low"] = min(point["low"], row["low"])
        point["volume"] += row["volume"]
        point["pct"] = row["pct"]
    return list(weeks.values())


def sqlite_week_number(date_text: str) -> str:
    from datetime import date

    year, month, day = (int(part) for part in date_text.split("-"))
    return str(date(year, month, day).isocalendar().week).zfill(2)


def get_watchlist(conn: sqlite3.Connection, watchlist_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT id, name, group_type FROM watchlists WHERE id=?",
        (watchlist_id,),
    ).fetchone()
    if not row:
        raise WatchlistError("自选分组不存在")
    return row


def normalize_name(name: str) -> str:
    stripped = name.strip()
    if not stripped:
        raise WatchlistError("分组名称不能为空")
    return stripped


def normalize_symbol(symbol: str) -> str:
    stripped = symbol.strip().upper()
    if not stripped:
        raise WatchlistError("标的代码不能为空")
    if len(stripped) == 6 and stripped.isdigit():
        if stripped.startswith(("8", "4", "920", "430")):
            return f"{stripped}.BJ"
        if stripped.startswith("6"):
            return f"{stripped}.SH"
        return f"{stripped}.SZ"
    return stripped


def unique_watchlist_id(conn: sqlite3.Connection, group_type: str, name: str) -> str:
    base = f"{group_type}-{slugify(name)}"
    candidate = base
    suffix = 2
    while conn.execute("SELECT 1 FROM watchlists WHERE id=?", (candidate,)).fetchone():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def slugify(value: str) -> str:
    chars = []
    for char in value.lower().strip():
        if char.isascii() and char.isalnum():
            chars.append(char)
        elif char in {" ", "-", "_"}:
            chars.append("-")
    slug = "-".join(part for part in "".join(chars).split("-") if part)
    return slug or hashlib.sha1(value.encode("utf-8")).hexdigest()[:10]
