import os
import sqlite3
from datetime import date, timedelta
from typing import Any, Iterable

from app.database import upsert_stocks
from app.signals import calculate_ma120_fields
from app.timeutils import now_iso


def run_sync(conn: sqlite3.Connection, request, progress_callback=None) -> tuple[int, int, str]:
    if request.update_mode.value == "price_only":
        updated = update_latest_prices(conn, request, now_iso(), progress_callback)
        conn.commit()
        return updated, 0, f"现价更新完成，共写入 {updated} 条记录"

    rows = list(fetch_akshare_rows(request, progress_callback))
    if not rows:
        raise RuntimeError("AkShare 未返回可写入的股票数据")

    updated = upsert_stocks(conn, rows, now_iso())
    conn.commit()
    return updated, 0, f"全量真实行情数据更新完成，共写入 {updated} 条记录"


def fetch_akshare_rows(request, progress_callback=None) -> Iterable[tuple]:
    import akshare as ak

    try:
        spot = ak.stock_zh_a_spot_em()
    except Exception as exc:
        return fetch_rows_from_code_names(ak, request, exc, progress_callback)

    if spot is None or spot.empty:
        return fetch_rows_from_code_names(
            ak,
            request,
            RuntimeError("AkShare 实时行情接口返回空数据"),
            progress_callback,
        )

    selected = select_spot_rows(spot, request)
    rows = []
    history_errors = 0
    total = len(selected.index)

    for index, (_, item) in enumerate(selected.iterrows(), start=1):
        code = str(item.get("代码", "")).strip()
        if not code:
            continue

        try:
            row = convert_spot_row(item, request, ak)
        except Exception:
            history_errors += 1
            notify_progress(progress_callback, index, total, f"正在全量更新 {index}/{total}")
            continue

        rows.append(row)
        notify_progress(progress_callback, index, total, f"正在全量更新 {index}/{total}")

    if not rows:
        return fetch_rows_from_code_names(
            ak,
            request,
            RuntimeError(f"AkShare 快照行情可用，但日线行情不可用；失败 {history_errors} 条"),
            progress_callback,
        )

    return rows


def fetch_rows_from_code_names(ak: Any, request, cause: Exception, progress_callback=None) -> list[tuple]:
    selected = select_code_name_rows(fetch_code_name_rows(ak, request), request)
    rows = []
    row_errors = 0
    total = len(selected)

    for index, item in enumerate(selected, start=1):
        code = str(item["code"]).strip().zfill(6)
        if not code:
            continue
        try:
            rows.append(convert_code_name_row(item, request, ak))
        except Exception:
            row_errors += 1
        notify_progress(progress_callback, index, total, f"正在全量更新 {index}/{total}")

    if not rows:
        raise RuntimeError(f"AkShare 备用真实数据接口不可用: {cause}; 失败 {row_errors} 条")

    return rows


def fetch_code_name_rows(ak: Any, request) -> list[dict[str, str]]:
    if request.symbols:
        requested_codes = {strip_symbol(symbol).zfill(6) for symbol in request.symbols}
    else:
        requested_codes = set()

    try:
        code_names = ak.stock_info_a_code_name()
    except Exception:
        if not requested_codes:
            raise
        return [{"code": code, "name": code} for code in sorted(requested_codes)]

    if code_names is None or code_names.empty:
        if not requested_codes:
            raise RuntimeError("AkShare A 股代码列表接口返回空数据")
        return [{"code": code, "name": code} for code in sorted(requested_codes)]

    rows = []
    for _, row in code_names.iterrows():
        code = str(row.get("code", row.get("证券代码", row.get("代码", "")))).strip().zfill(6)
        name = str(row.get("name", row.get("证券简称", row.get("名称", code)))).strip() or code
        if code:
            rows.append({"code": code, "name": name})
    return rows


def select_code_name_rows(rows: list[dict[str, str]], request) -> list[dict[str, str]]:
    if request.symbols:
        codes = {strip_symbol(symbol).zfill(6) for symbol in request.symbols}
        rows = [row for row in rows if row["code"] in codes]

    return rows[: get_sync_limit(request)]


def select_spot_rows(spot, request):
    if request.symbols:
        codes = {strip_symbol(symbol).zfill(6) for symbol in request.symbols}
        spot = spot[spot["代码"].astype(str).isin(codes)]

    return spot.head(get_sync_limit(request))


def get_sync_limit(request=None) -> int:
    if request is not None and getattr(request, "limit", None):
        return request.limit
    try:
        return max(1, int(os.getenv("MIDAS_AKSHARE_LIMIT", "300")))
    except ValueError:
        return 300


def convert_spot_row(item, request, ak) -> tuple:
    code = str(item.get("代码", "")).strip()
    symbol = normalize_symbol(code)
    name = str(item.get("名称", code))
    company_metadata = fetch_company_metadata(ak, code)
    price = to_float(item.get("最新价"))
    pct_change = to_float(item.get("涨跌幅"))
    market_cap = to_float(item.get("总市值")) / 100000000
    pe = to_float(item.get("市盈率-动态"))
    pb = to_float(item.get("市净率"))
    dividend = to_float(item.get("股息率"))
    if market_cap <= 0 or pe <= 0 or pb <= 0 or dividend <= 0:
        metrics = fetch_fundamental_metrics(ak, code)
        market_cap = market_cap if market_cap > 0 else metrics.get("market_cap", 0.0)
        pe = pe if pe > 0 else metrics.get("pe", 0.0)
        pb = pb if pb > 0 else metrics.get("pb", 0.0)
        dividend = dividend if dividend > 0 else metrics.get("dividend", 0.0)
    open_price = to_float(item.get("今开"), default=price)
    high = to_float(item.get("最高"), default=max(price, open_price))
    low = to_float(item.get("最低"), default=min(price, open_price))
    volume = int(to_float(item.get("成交量"), default=0))
    amount = to_float(item.get("成交额"))

    hist = fetch_history(ak, code, request)
    if hist is None or hist.empty or "收盘" not in hist.columns:
        raise RuntimeError(f"{symbol} 日线为空")

    closes = hist["收盘"].dropna().astype(float).tail(120)
    if closes.empty:
        raise RuntimeError(f"{symbol} 收盘价为空")

    latest = hist.tail(1).iloc[0]
    trade_date = str(request.trade_date or latest.get("日期") or date.today())
    ma120 = round(float(closes.mean()), 2)

    return (
        symbol,
        name,
        "A",
        company_metadata["exchange"],
        company_metadata["ownership"],
        company_metadata["sector"],
        market_cap,
        pe,
        dividend,
        pb,
        0.0,
        price,
        pct_change,
        ma120,
        name[:1].upper(),
        trade_date,
        open_price,
        high,
        low,
        volume,
        amount,
    )


def convert_code_name_row(item: dict[str, str], request, ak) -> tuple:
    code = item["code"]
    symbol = normalize_symbol(code)
    name = item["name"]
    company_metadata = fetch_company_metadata(ak, code)
    hist = fetch_history(ak, code, request)
    if hist is None or hist.empty or "收盘" not in hist.columns:
        raise RuntimeError(f"{symbol} 日线为空")

    latest = hist.tail(1).iloc[0]
    close = to_float(latest.get("收盘"))
    if close <= 0:
        raise RuntimeError(f"{symbol} 收盘价为空")

    previous_close = close
    if len(hist.index) >= 2:
        previous_close = to_float(hist.tail(2).iloc[0].get("收盘"), default=close)

    pct_change = compute_pct_change(close, previous_close, latest.get("涨跌幅"))
    closes = hist["收盘"].dropna().astype(float).tail(120)
    if closes.empty:
        raise RuntimeError(f"{symbol} 收盘价为空")

    metrics = fetch_fundamental_metrics(ak, code)
    open_price = to_float(latest.get("开盘"), default=close)
    high = to_float(latest.get("最高"), default=max(close, open_price))
    low = to_float(latest.get("最低"), default=min(close, open_price))
    volume = int(to_float(latest.get("成交量"), default=0))
    amount = to_float(latest.get("成交额"))
    ma120 = round(float(closes.mean()), 2)

    return (
        symbol,
        metrics.get("name") or name,
        "A",
        company_metadata["exchange"],
        company_metadata["ownership"],
        metrics.get("sector") or company_metadata["sector"],
        metrics.get("market_cap", 0.0),
        metrics.get("pe", 0.0),
        metrics.get("dividend", 0.0),
        metrics.get("pb", 0.0),
        0.0,
        close,
        pct_change,
        ma120,
        (metrics.get("name") or name)[:1].upper(),
        latest_date_str(latest.get("日期"), request),
        open_price,
        high,
        low,
        volume,
        amount,
    )


def update_latest_prices(conn: sqlite3.Connection, request, timestamp: str, progress_callback=None) -> int:
    import akshare as ak

    targets = get_price_update_targets(conn, request)
    if not targets:
        raise RuntimeError("仅更新现价需要先完成一次全量更新")

    updated = 0
    total = len(targets)
    for index, stock in enumerate(targets, start=1):
        code = strip_symbol(stock["symbol"])
        hist = fetch_history(ak, code, request)
        if hist is None or hist.empty or "收盘" not in hist.columns:
            notify_progress(progress_callback, index, total, f"正在更新现价 {index}/{total}")
            continue

        latest = hist.tail(1).iloc[0]
        close = to_float(latest.get("收盘"))
        if close <= 0:
            notify_progress(progress_callback, index, total, f"正在更新现价 {index}/{total}")
            continue

        previous_close = close
        if len(hist.index) >= 2:
            previous_close = to_float(hist.tail(2).iloc[0].get("收盘"), default=close)

        pct_change = compute_pct_change(close, previous_close, latest.get("涨跌幅"))
        ma_fields = calculate_ma120_fields(close, to_float(stock["ma120"]))
        conn.execute(
            """
            UPDATE stock_fundamentals
            SET signal=?, ma120_lower=?, ma120_upper=?, updated_at=?
            WHERE symbol=?
            """,
            (
                ma_fields["signal"],
                ma_fields["ma120_lower"],
                ma_fields["ma120_upper"],
                timestamp,
                stock["symbol"],
            ),
        )
        conn.execute(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume, amount,
                change, pct_change, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET
                open=excluded.open,
                close=excluded.close,
                high=excluded.high,
                low=excluded.low,
                volume=excluded.volume,
                amount=excluded.amount,
                change=excluded.change,
                pct_change=excluded.pct_change,
                updated_at=excluded.updated_at
            """,
            (
                stock["symbol"],
                latest_date_str(latest.get("日期"), request),
                to_float(latest.get("开盘"), default=close),
                close,
                to_float(latest.get("最高"), default=close),
                to_float(latest.get("最低"), default=close),
                int(to_float(latest.get("成交量"), default=0)),
                to_float(latest.get("成交额")),
                pct_change,
                pct_change,
                timestamp,
            ),
        )
        updated += 2
        notify_progress(progress_callback, index, total, f"正在更新现价 {index}/{total}")

    if updated == 0:
        raise RuntimeError("AkShare 未返回可写入的现价数据")

    return updated


def get_price_update_targets(conn: sqlite3.Connection, request) -> list[sqlite3.Row]:
    params: list[object] = []
    where = ["ma120 IS NOT NULL"]

    if request.symbols:
        symbols = [normalize_symbol(strip_symbol(symbol).zfill(6)) for symbol in request.symbols]
        placeholders = ",".join("?" for _ in symbols)
        where.append(f"symbol IN ({placeholders})")
        params.extend(symbols)

    rows = conn.execute(
        f"""
        SELECT symbol, ma120
        FROM stock_fundamentals
        WHERE {' AND '.join(where)}
        ORDER BY market_cap DESC, symbol ASC
        LIMIT ?
        """,
        [*params, request.limit],
    ).fetchall()
    return list(rows)


def fetch_company_metadata(ak: Any, code: str) -> dict[str, str]:
    profile_values = fetch_cninfo_profile_values(ak, code)
    xueqiu_values = fetch_xueqiu_basic_values(ak, code)

    symbol = normalize_symbol(code)
    return {
        "exchange": normalize_listing_place(profile_values.get("所属市场") or profile_values.get("上市地点"), symbol),
        "ownership": normalize_company_ownership(
            xueqiu_values.get("classi_name") or xueqiu_values.get("公司性质") or xueqiu_values.get("企业性质"),
            xueqiu_values.get("actual_controller") or xueqiu_values.get("实际控制人"),
        ),
        "sector": str(profile_values.get("所属行业") or xueqiu_values.get("industry") or "未分类").strip() or "未分类",
    }


def fetch_cninfo_profile_values(ak: Any, code: str) -> dict[str, Any]:
    try:
        frame = ak.stock_profile_cninfo(symbol=code)
    except Exception:
        return {}

    if frame is None or frame.empty:
        return {}

    row = frame.iloc[0]
    return {str(key): row.get(key) for key in frame.columns}


def fetch_xueqiu_basic_values(ak: Any, code: str) -> dict[str, Any]:
    try:
        frame = ak.stock_individual_basic_info_xq(symbol=xueqiu_symbol(code), timeout=8)
    except Exception:
        return {}

    if frame is None or frame.empty or "item" not in frame.columns or "value" not in frame.columns:
        return {}

    return {str(row["item"]): row["value"] for _, row in frame.iterrows()}


def normalize_listing_place(value: object, symbol: str) -> str:
    text = str(value or "").strip()
    if "创业板" in text:
        return "创业板"
    if "北交所" in text or "北京证券交易所" in text:
        return "北交所"
    if text:
        return "沪深"
    return infer_exchange(symbol)


def normalize_company_ownership(classification: object, controller: object) -> str:
    text = f"{classification or ''} {controller or ''}".strip()
    if not text:
        return "未知"

    if any(keyword in text for keyword in ("央企", "国务院国有资产监督管理委员会", "中央汇金", "中央国资")):
        return "央企"
    if any(keyword in text for keyword in ("省属", "市属", "地方国资", "人民政府国有资产监督管理委员会", "国资控股")):
        return "地方国企"
    if any(keyword in text for keyword in ("民营", "私营")):
        return "民企"
    if "国有资产监督管理委员会" in text or "财政厅" in text or "财政局" in text:
        return "地方国企"
    if looks_like_private_controller(text):
        return "民企"
    return "未知"


def looks_like_private_controller(text: str) -> bool:
    government_markers = ("国资", "财政", "人民政府", "国务院", "委员会", "集团", "公司", "合伙", "基金")
    if any(marker in text for marker in government_markers):
        return False
    chinese_chars = [char for char in text if "\u4e00" <= char <= "\u9fff"]
    return 2 <= len(chinese_chars) <= 8


def fetch_fundamental_metrics(ak: Any, code: str) -> dict[str, Any]:
    metrics: dict[str, Any] = {}
    try:
        info = ak.stock_individual_info_em(symbol=code, timeout=8)
    except Exception:
        info = None

    if info is not None and not info.empty:
        values = {str(row["item"]): row["value"] for _, row in info.iterrows() if "item" in row and "value" in row}
        metrics = {
            "name": str(values.get("股票简称", "")).strip(),
            "sector": str(values.get("行业", "")).strip(),
            "market_cap": normalize_market_cap_yi(values.get("总市值")),
            "pe": first_float(values, ("市盈率", "市盈率(动态)", "市盈率TTM", "PE(TTM)")),
            "dividend": first_float(values, ("股息率", "股息率(%)", "股息率TTM", "股利支付率")),
            "pb": first_float(values, ("市净率", "PB")),
        }

    if any(to_float(metrics.get(key)) <= 0 for key in ("market_cap", "pe", "pb", "dividend")):
        value_metrics = fetch_value_metrics(ak, code)
        for key, value in value_metrics.items():
            if to_float(metrics.get(key)) <= 0 and to_float(value) > 0:
                metrics[key] = value

    return metrics


def fetch_value_metrics(ak: Any, code: str) -> dict[str, float]:
    try:
        frame = ak.stock_value_em(symbol=code)
    except Exception:
        return {}

    if frame is None or frame.empty:
        return {}

    latest = frame.tail(1).iloc[0]
    return {
        "market_cap": normalize_market_cap_yi(latest.get("总市值")),
        "pe": first_float(latest, ("PE(TTM)", "PE(静)", "市盈率", "市盈率-动态")),
        "dividend": first_float(latest, ("股息率", "股息率(%)", "股利支付率")),
        "pb": first_float(latest, ("市净率", "PB")),
    }


def first_float(values: Any, keys: tuple[str, ...]) -> float:
    for key in keys:
        value = to_float(values.get(key), default=0.0)
        if value:
            return value
    return 0.0


def normalize_market_cap_yi(value: object) -> float:
    amount = to_float(value)
    if amount <= 0:
        return 0.0
    if amount > 1_000_000:
        return round(amount / 100000000, 2)
    return round(amount, 2)


def fetch_history(ak, code: str, request):
    errors = []
    for fetcher in (fetch_history_tx, fetch_history_sina, fetch_history_eastmoney):
        try:
            hist = fetcher(ak, code, request)
        except Exception as exc:
            errors.append(f"{fetcher.__name__}: {exc}")
            continue

        normalized = normalize_history_frame(hist)
        if normalized is not None and not normalized.empty:
            return normalized

    raise RuntimeError(f"{normalize_symbol(code)} 日线行情不可用: {'; '.join(errors)}")


def fetch_history_eastmoney(ak, code: str, request):
    end = request.trade_date or date.today()
    start = end - timedelta(days=260)
    return ak.stock_zh_a_hist(
        symbol=code,
        period="daily",
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="",
        timeout=8,
    )


def fetch_history_tx(ak, code: str, request):
    end = request.trade_date or date.today()
    start = end - timedelta(days=260)
    return ak.stock_zh_a_hist_tx(
        symbol=market_prefixed_code(code),
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="",
        timeout=8,
    )


def fetch_history_sina(ak, code: str, request):
    end = request.trade_date or date.today()
    start = end - timedelta(days=260)
    return ak.stock_zh_a_daily(
        symbol=market_prefixed_code(code),
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust="",
    )


def normalize_history_frame(hist):
    if hist is None or hist.empty:
        return hist

    if "收盘" in hist.columns:
        return hist

    rename_map = {
        "date": "日期",
        "open": "开盘",
        "close": "收盘",
        "high": "最高",
        "low": "最低",
        "volume": "成交量",
    }
    if "amount" in hist.columns:
        rename_map["amount"] = "成交额" if "volume" in hist.columns else "成交量"

    normalized = hist.rename(columns=rename_map).copy()

    if "成交额" not in normalized.columns:
        normalized["成交额"] = 0.0
    if "涨跌幅" not in normalized.columns:
        normalized["涨跌幅"] = None
    if "成交量" in normalized.columns and "amount" in hist.columns and "volume" not in hist.columns:
        normalized["成交量"] = normalized["成交量"].apply(lambda value: int(to_float(value) * 100))

    return normalized


def compute_pct_change(close: float, previous_close: float, provided: object = None) -> float:
    value = to_float(provided, default=0.0)
    if value:
        return round(value, 2)
    if previous_close <= 0:
        return 0.0
    return round((close - previous_close) / previous_close * 100, 2)


def notify_progress(progress_callback, completed: int, total: int, message: str) -> None:
    if progress_callback:
        progress_callback(completed, total, message)


def latest_date_str(value: object, request) -> str:
    if request.trade_date:
        return request.trade_date.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value or date.today())


def to_float(value, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        text = str(value).replace(",", "").strip()
        if text in {"", "-", "nan", "None"}:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def strip_symbol(symbol: str) -> str:
    return symbol.split(".")[0]


def market_prefixed_code(code: str) -> str:
    if code.startswith(("8", "4", "920")):
        return f"bj{code}"
    if code.startswith("6"):
        return f"sh{code}"
    return f"sz{code}"


def normalize_symbol(code: str) -> str:
    if code.startswith(("8", "4", "920")):
        return f"{code}.BJ"
    if code.startswith("6"):
        return f"{code}.SH"
    return f"{code}.SZ"


def xueqiu_symbol(code: str) -> str:
    symbol = normalize_symbol(code)
    code_part, suffix = symbol.split(".")
    return f"{suffix}{code_part}"


def infer_exchange(symbol: str) -> str:
    if symbol.startswith(("300", "301")):
        return "创业板"
    if symbol.startswith(("8", "4", "920")) or symbol.endswith(".BJ"):
        return "北交所"
    return "沪深"
