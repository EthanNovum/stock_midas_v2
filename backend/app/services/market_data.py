from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


INDEX_TARGETS = [
    {"symbol": "SSEC", "name": "上证指数", "code": "000001", "ak_symbol": "sh000001"},
    {"symbol": "SZI", "name": "深证成指", "code": "399001", "ak_symbol": "sz399001"},
    {"symbol": "CHINEXT", "name": "创业板指", "code": "399006", "ak_symbol": "sz399006"},
]


def market_status(now: datetime | None = None) -> dict:
    current = now or datetime.now(ZoneInfo("Asia/Shanghai"))
    if current.weekday() >= 5:
        return {"status": "closed", "label": "休市"}

    current_time = current.time()
    if current_time < datetime.strptime("09:30", "%H:%M").time():
        return {"status": "preopen", "label": "未开盘"}
    if current_time <= datetime.strptime("11:30", "%H:%M").time():
        return {"status": "open", "label": "开盘"}
    if current_time < datetime.strptime("13:00", "%H:%M").time():
        return {"status": "break", "label": "午间休市"}
    if current_time <= datetime.strptime("15:00", "%H:%M").time():
        return {"status": "open", "label": "开盘"}
    return {"status": "closed", "label": "已收盘"}


def fetch_index_items() -> list[dict]:
    import akshare as ak

    spot = fetch_index_spot(ak)
    items = []
    for target in INDEX_TARGETS:
        spot_row = find_spot_row(spot, target["code"], target["name"])
        trend = fetch_index_trend(ak, target["ak_symbol"])

        if spot_row is not None:
            price = to_float(spot_row.get("最新价"))
            change = to_float(spot_row.get("涨跌额"))
            pct_change = to_float(spot_row.get("涨跌幅"))
        else:
            price, change, pct_change = price_from_trend(trend)

        if price <= 0:
            continue

        items.append(
            {
                "symbol": target["symbol"],
                "name": target["name"],
                "price": price,
                "change": change,
                "pctChange": pct_change,
                "trend": trend,
            }
        )

    if not items:
        raise RuntimeError("AkShare 未返回可用指数数据")

    return items


def fetch_index_spot(ak):
    try:
        spot = ak.stock_zh_index_spot_em(symbol="沪深重要指数")
        if spot is not None and not spot.empty:
            return spot
    except Exception:
        pass
    return None


def find_spot_row(spot, code: str, name: str):
    if spot is None:
        return None

    matched = spot[(spot["代码"].astype(str) == code) | (spot["名称"].astype(str) == name)]
    if matched.empty:
        return None
    return matched.iloc[0]


def fetch_index_trend(ak, symbol: str) -> list[float]:
    end = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    start = end - timedelta(days=20)

    fetchers = (
        lambda: ak.stock_zh_index_daily_em(
            symbol=symbol,
            start_date=start.strftime("%Y%m%d"),
            end_date=end.strftime("%Y%m%d"),
        ),
        lambda: ak.stock_zh_index_daily(symbol=symbol),
        lambda: ak.stock_zh_index_daily_tx(symbol=symbol),
    )
    for fetcher in fetchers:
        try:
            frame = fetcher()
        except Exception:
            continue
        if frame is None or frame.empty or "close" not in frame.columns:
            continue
        values = frame["close"].dropna().astype(float).tail(7).tolist()
        if values:
            return values
    return []


def price_from_trend(trend: list[float]) -> tuple[float, float, float]:
    if not trend:
        return 0.0, 0.0, 0.0
    price = round(float(trend[-1]), 2)
    previous = float(trend[-2]) if len(trend) >= 2 else price
    change = round(price - previous, 2)
    pct_change = round(change / previous * 100, 2) if previous else 0.0
    return price, change, pct_change


def fetch_news_items(limit: int, category: str | None = None) -> list[dict]:
    import akshare as ak

    frame = None
    for fetcher in (
        lambda: ak.stock_info_global_cls(symbol="全部"),
        ak.stock_info_global_em,
        ak.stock_info_cjzc_em,
    ):
        try:
            candidate = fetcher()
        except Exception:
            continue
        if candidate is not None and not candidate.empty:
            frame = candidate
            break

    if frame is None or frame.empty:
        return []

    items = []
    for index, row in frame.head(limit).iterrows():
        title = str(row.get("标题", "")).strip()
        if not title:
            continue
        published = format_news_time(row)
        summary = str(row.get("内容", row.get("摘要", title))).strip() or title
        item_category = category or "快讯"
        items.append(
            {
                "id": f"akshare-{index}",
                "category": item_category,
                "timestamp": published,
                "title": title,
                "summary": summary,
            }
        )
    return items


def format_news_time(row) -> str:
    if row.get("发布时间") is not None and row.get("发布日期") is not None:
        return f"{row.get('发布日期')} {row.get('发布时间')}"
    return str(row.get("发布时间", ""))


def to_float(value, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        text = str(value).replace(",", "").strip()
        if text in {"", "-", "nan", "None"}:
            return default
        return round(float(text), 2)
    except (TypeError, ValueError):
        return default
