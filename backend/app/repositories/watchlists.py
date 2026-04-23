import hashlib
import sqlite3


DEFAULT_WATCHLIST_ID = "sector-my-watchlist"


class WatchlistError(ValueError):
    pass


def list_watchlists(conn: sqlite3.Connection, group_by: str) -> dict:
    ensure_default_watchlist(conn)
    if group_by == "flat":
        rows = stock_rows(conn, None)
        return {"groups": [{"id": "flat", "name": "全部自选", "stocks": rows}]}

    groups = conn.execute(
        "SELECT id, name FROM watchlists WHERE group_type=? ORDER BY created_at",
        (group_by if group_by != "institution" else "sector",),
    ).fetchall()
    return {
        "groups": [
            {"id": group["id"], "name": group["name"], "stocks": stock_rows(conn, group["id"])}
            for group in groups
        ]
    }


def stock_rows(conn: sqlite3.Connection, watchlist_id: str | None) -> list[dict]:
    where = "WHERE wi.watchlist_id=?" if watchlist_id else ""
    params = [watchlist_id] if watchlist_id else []
    rows = conn.execute(
        f"""
        SELECT
            substr(f.symbol, 1, instr(f.symbol, '.') - 1) AS id,
            f.symbol,
            f.name,
            f.sector,
            p.close AS price,
            printf('%.1fM', COALESCE(p.volume, 0) / 1000000.0) AS vol,
            p.pct_change AS pct
        FROM watchlist_items wi
        JOIN stock_fundamentals f ON f.symbol = wi.symbol
        JOIN stock_daily_prices p ON p.symbol = f.symbol
        {where}
        ORDER BY f.market_cap DESC
        """,
        params,
    ).fetchall()
    return [{**dict(row), "industry": row["sector"], "trend": stock_trend(conn, row["symbol"])} for row in rows]


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
        VALUES (?, '我的自选', 'sector', datetime('now'))
        """,
        (DEFAULT_WATCHLIST_ID,),
    )
    conn.commit()


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
