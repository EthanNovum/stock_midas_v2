import sqlite3
from datetime import date, datetime
from types import SimpleNamespace

from app.timeutils import now_iso


class PortfolioError(ValueError):
    pass


SECTOR_COLORS = {
    "信息技术": "#00343e",
    "可选消费": "#004c59",
    "医疗保健": "#86d2e5",
    "现金": "#d0e6f3",
}

TRADE_SIDES = {"buy", "sell", "dividend"}


def summary(conn: sqlite3.Connection) -> dict:
    cash = conn.execute("SELECT cash FROM portfolios WHERE id=1").fetchone()["cash"]
    holdings = conn.execute("SELECT symbol, quantity, cost, price FROM holdings WHERE portfolio_id=1").fetchall()
    market_value = sum(row["quantity"] * row["price"] for row in holdings)
    total_cost = sum(row["quantity"] * row["cost"] for row in holdings)
    total_assets = market_value + cash
    ytd_pct = round(((market_value - total_cost) / total_cost) * 100, 2) if total_cost else 0
    daily_pnl = calculate_daily_pnl(conn, holdings)
    return {
        "portfolioId": 1,
        "asOf": now_iso(),
        "totalAssets": round(total_assets, 2),
        "ytdPct": ytd_pct,
        "dailyPnl": daily_pnl,
        "dailyPnlPct": round(daily_pnl / total_assets * 100, 2) if total_assets else 0,
        "cash": round(cash, 2),
        "cashPct": round(cash / total_assets * 100, 2) if total_assets else 0,
    }


def calculate_daily_pnl(conn: sqlite3.Connection, holding_rows: list[sqlite3.Row]) -> float:
    total = 0.0
    for holding in holding_rows:
        prices = conn.execute(
            """
            SELECT close
            FROM stock_daily_prices
            WHERE symbol=?
            ORDER BY trade_date DESC
            LIMIT 2
            """,
            (holding["symbol"],),
        ).fetchall()
        if len(prices) < 2:
            continue
        latest = prices[0]["close"]
        previous = prices[1]["close"]
        total += (latest - previous) * holding["quantity"]
    return round(total, 2)


def holdings(conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        "SELECT symbol, name, quantity, cost, price FROM holdings WHERE portfolio_id=1 ORDER BY symbol"
    ).fetchall()
    items = []
    for row in rows:
        profit = (row["price"] - row["cost"]) * row["quantity"]
        pct = ((row["price"] - row["cost"]) / row["cost"]) * 100 if row["cost"] else 0
        items.append(
            {
                "symbol": row["symbol"],
                "name": row["name"],
                "quantity": row["quantity"],
                "cost": row["cost"],
                "price": row["price"],
                "profit": round(profit, 2),
                "pct": round(pct, 2),
            }
        )
    return {"items": items}


def allocation(conn: sqlite3.Connection) -> dict:
    cash = conn.execute("SELECT cash FROM portfolios WHERE id=1").fetchone()["cash"]
    rows = conn.execute(
        """
        SELECT COALESCE(sector, '未分类') AS name, SUM(quantity * price) AS amount
        FROM holdings
        WHERE portfolio_id=1
        GROUP BY COALESCE(sector, '未分类')
        """
    ).fetchall()
    total_assets = cash + sum(row["amount"] for row in rows)
    if total_assets <= 0:
        return {"items": []}

    items = [
        {
            "name": row["name"],
            "value": round(row["amount"] / total_assets * 100, 2),
            "color": color_for(row["name"]),
        }
        for row in rows
        if row["amount"] > 0
    ]
    if cash > 0:
        items.append({"name": "现金", "value": round(cash / total_assets * 100, 2), "color": color_for("现金")})

    items.sort(key=lambda item: (item["name"] == "现金", -item["value"], item["name"]))
    return {"items": items}


def create_trade(conn: sqlite3.Connection, payload) -> dict:
    traded_at = normalize_trade_date(payload.traded_at)
    validate_trade_payload(payload)

    apply_trade(conn, payload)

    cursor = conn.execute(
        """
        INSERT INTO trades (portfolio_id, symbol, side, quantity, price, traded_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (payload.portfolio_id, payload.symbol, payload.side, payload.quantity, payload.price, traded_at),
    )
    conn.commit()
    return {
        "id": cursor.lastrowid,
        "portfolioId": payload.portfolio_id,
        "symbol": payload.symbol,
        "side": payload.side,
        "quantity": payload.quantity,
        "price": payload.price,
        "tradedAt": traded_at,
    }


def list_trades(conn: sqlite3.Connection, portfolio_id: int = 1) -> dict:
    rows = conn.execute(
        """
        SELECT id, portfolio_id, symbol, side, quantity, price, traded_at
        FROM trades
        WHERE portfolio_id=?
        ORDER BY traded_at DESC, id DESC
        """,
        (portfolio_id,),
    ).fetchall()
    return {"items": [trade_row_to_dict(row) for row in rows]}


def update_trade(conn: sqlite3.Connection, trade_id: int, payload) -> dict:
    original = get_trade(conn, trade_id)
    replacement = SimpleNamespace(
        portfolio_id=payload.portfolio_id if payload.portfolio_id is not None else original["portfolio_id"],
        symbol=payload.symbol if payload.symbol is not None else original["symbol"],
        side=payload.side if payload.side is not None else original["side"],
        quantity=payload.quantity if payload.quantity is not None else original["quantity"],
        price=payload.price if payload.price is not None else original["price"],
        traded_at=payload.traded_at if payload.traded_at is not None else None,
    )
    replacement_traded_at = normalize_trade_date(payload.traded_at) if payload.traded_at else original["traded_at"]
    validate_trade_payload(replacement)

    reverse_trade(conn, original)
    apply_trade(conn, replacement)

    conn.execute(
        """
        UPDATE trades
        SET portfolio_id=?, symbol=?, side=?, quantity=?, price=?, traded_at=?
        WHERE id=?
        """,
        (
            replacement.portfolio_id,
            replacement.symbol,
            replacement.side,
            replacement.quantity,
            replacement.price,
            replacement_traded_at,
            trade_id,
        ),
    )
    conn.commit()
    return trade_row_to_dict(get_trade(conn, trade_id))


def delete_trade(conn: sqlite3.Connection, trade_id: int) -> None:
    trade = get_trade(conn, trade_id)
    reverse_trade(conn, trade)
    conn.execute("DELETE FROM trades WHERE id=?", (trade_id,))
    conn.commit()


def get_trade(conn: sqlite3.Connection, trade_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, portfolio_id, symbol, side, quantity, price, traded_at
        FROM trades
        WHERE id=?
        """,
        (trade_id,),
    ).fetchone()
    if not row:
        raise PortfolioError("交易记录不存在")
    return row


def trade_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "portfolioId": row["portfolio_id"],
        "symbol": row["symbol"],
        "side": row["side"],
        "quantity": row["quantity"],
        "price": row["price"],
        "totalAmount": round(row["quantity"] * row["price"], 2),
        "tradedAt": row["traded_at"],
    }


def validate_trade_payload(payload) -> None:
    if payload.side not in TRADE_SIDES:
        raise PortfolioError("交易方向必须为 buy、sell 或 dividend")
    if payload.quantity <= 0 or payload.price <= 0:
        raise PortfolioError("交易数量和价格必须大于 0")


def normalize_trade_date(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return now_iso()[:10]


def apply_trade(conn: sqlite3.Connection, payload) -> None:
    if payload.side == "buy":
        apply_buy(conn, payload)
    elif payload.side == "sell":
        apply_sell(conn, payload)
    elif payload.side == "dividend":
        apply_dividend(conn, payload)
    else:
        raise PortfolioError("交易方向必须为 buy、sell 或 dividend")


def reverse_trade(conn: sqlite3.Connection, trade: sqlite3.Row) -> None:
    if trade["side"] == "buy":
        reverse_buy(conn, trade)
    elif trade["side"] == "sell":
        reverse_sell(conn, trade)
    elif trade["side"] == "dividend":
        reverse_dividend(conn, trade)
    else:
        raise PortfolioError("交易方向必须为 buy、sell 或 dividend")


def apply_buy(conn: sqlite3.Connection, payload) -> None:
    amount = payload.quantity * payload.price
    cash = get_cash(conn, payload.portfolio_id)
    if cash < amount:
        raise PortfolioError("现金不足，无法买入")

    holding = get_holding(conn, payload.portfolio_id, payload.symbol)
    if holding:
        new_quantity = holding["quantity"] + payload.quantity
        new_cost = ((holding["quantity"] * holding["cost"]) + amount) / new_quantity
        conn.execute(
            """
            UPDATE holdings
            SET quantity=?, cost=?, price=?
            WHERE id=?
            """,
            (new_quantity, round(new_cost, 4), payload.price, holding["id"]),
        )
    else:
        stock = get_stock_metadata(conn, payload.symbol)
        conn.execute(
            """
            INSERT INTO holdings (portfolio_id, symbol, name, quantity, cost, price, sector)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.portfolio_id,
                payload.symbol,
                stock["name"],
                payload.quantity,
                payload.price,
                payload.price,
                stock["sector"],
            ),
        )

    update_cash(conn, payload.portfolio_id, cash - amount)


def apply_sell(conn: sqlite3.Connection, payload) -> None:
    holding = get_holding(conn, payload.portfolio_id, payload.symbol)
    if not holding or holding["quantity"] < payload.quantity:
        raise PortfolioError("持仓不足，无法卖出")

    cash = get_cash(conn, payload.portfolio_id)
    new_quantity = holding["quantity"] - payload.quantity
    if new_quantity == 0:
        conn.execute("DELETE FROM holdings WHERE id=?", (holding["id"],))
    else:
        conn.execute(
            "UPDATE holdings SET quantity=?, price=? WHERE id=?",
            (new_quantity, payload.price, holding["id"]),
        )

    update_cash(conn, payload.portfolio_id, cash + payload.quantity * payload.price)


def apply_dividend(conn: sqlite3.Connection, payload) -> None:
    cash = get_cash(conn, payload.portfolio_id)
    update_cash(conn, payload.portfolio_id, cash + payload.quantity * payload.price)


def reverse_buy(conn: sqlite3.Connection, trade: sqlite3.Row) -> None:
    holding = get_holding(conn, trade["portfolio_id"], trade["symbol"])
    if not holding or holding["quantity"] < trade["quantity"]:
        raise PortfolioError("无法撤销买入交易：持仓不足")

    cash = get_cash(conn, trade["portfolio_id"])
    remaining_quantity = holding["quantity"] - trade["quantity"]
    if remaining_quantity == 0:
        conn.execute("DELETE FROM holdings WHERE id=?", (holding["id"],))
    else:
        remaining_basis = holding["quantity"] * holding["cost"] - trade["quantity"] * trade["price"]
        new_cost = remaining_basis / remaining_quantity if remaining_basis > 0 else holding["cost"]
        conn.execute(
            "UPDATE holdings SET quantity=?, cost=? WHERE id=?",
            (remaining_quantity, round(new_cost, 4), holding["id"]),
        )

    update_cash(conn, trade["portfolio_id"], cash + trade["quantity"] * trade["price"])


def reverse_sell(conn: sqlite3.Connection, trade: sqlite3.Row) -> None:
    cash = get_cash(conn, trade["portfolio_id"])
    amount = trade["quantity"] * trade["price"]
    if cash < amount:
        raise PortfolioError("无法撤销卖出交易：现金不足")

    holding = get_holding(conn, trade["portfolio_id"], trade["symbol"])
    if holding:
        conn.execute(
            "UPDATE holdings SET quantity=?, price=? WHERE id=?",
            (holding["quantity"] + trade["quantity"], trade["price"], holding["id"]),
        )
    else:
        stock = get_stock_metadata(conn, trade["symbol"])
        conn.execute(
            """
            INSERT INTO holdings (portfolio_id, symbol, name, quantity, cost, price, sector)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade["portfolio_id"],
                trade["symbol"],
                stock["name"],
                trade["quantity"],
                trade["price"],
                trade["price"],
                stock["sector"],
            ),
        )

    update_cash(conn, trade["portfolio_id"], cash - amount)


def reverse_dividend(conn: sqlite3.Connection, trade: sqlite3.Row) -> None:
    cash = get_cash(conn, trade["portfolio_id"])
    amount = trade["quantity"] * trade["price"]
    if cash < amount:
        raise PortfolioError("无法撤销分红交易：现金不足")
    update_cash(conn, trade["portfolio_id"], cash - amount)


def get_cash(conn: sqlite3.Connection, portfolio_id: int) -> float:
    row = conn.execute("SELECT cash FROM portfolios WHERE id=?", (portfolio_id,)).fetchone()
    if not row:
        raise PortfolioError("组合不存在")
    return float(row["cash"])


def update_cash(conn: sqlite3.Connection, portfolio_id: int, cash: float) -> None:
    conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (round(cash, 2), portfolio_id))


def get_holding(conn: sqlite3.Connection, portfolio_id: int, symbol: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT id, quantity, cost, price
        FROM holdings
        WHERE portfolio_id=? AND symbol=?
        LIMIT 1
        """,
        (portfolio_id, symbol),
    ).fetchone()


def get_stock_metadata(conn: sqlite3.Connection, symbol: str) -> dict:
    row = conn.execute(
        "SELECT name, sector FROM stock_fundamentals WHERE symbol=?",
        (symbol,),
    ).fetchone()
    if row:
        return {"name": row["name"], "sector": row["sector"] or "未分类"}
    return {"name": symbol, "sector": "未分类"}


def color_for(name: str) -> str:
    if name in SECTOR_COLORS:
        return SECTOR_COLORS[name]
    palette = ["#5a7d7c", "#b48b2c", "#7a5c8a", "#607d3b", "#8a5a5a"]
    return palette[sum(ord(char) for char in name) % len(palette)]


def report_csv(conn: sqlite3.Connection) -> str:
    current_summary = summary(conn)
    current_holdings = holdings(conn)["items"]
    current_allocation = allocation(conn)["items"]

    lines = ["section,name,value"]
    for key in ("totalAssets", "dailyPnl", "dailyPnlPct", "cash", "cashPct"):
        lines.append(f"summary,{key},{current_summary[key]}")
    for item in current_holdings:
        lines.append(f"holding,{item['symbol']},{item['quantity']}")
    for item in current_allocation:
        lines.append(f"allocation,{item['name']},{item['value']}")
    return "\n".join(lines) + "\n"
