def test_health_check_reports_database_ok(client):
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "ok"


def test_market_indices_use_realtime_service(client, monkeypatch):
    from app.repositories import market

    def fake_indices():
        return [
            {
                "symbol": "SSEC",
                "name": "上证指数",
                "price": 3210.12,
                "change": 8.5,
                "pctChange": 0.27,
                "trend": [3190.0, 3201.0, 3210.12],
            }
        ]

    monkeypatch.setattr(market.market_data, "fetch_index_items", fake_indices)

    response = client.get("/api/v1/market/indices")

    assert response.status_code == 200
    assert response.json()["items"] == fake_indices()


def test_news_uses_realtime_service(client, monkeypatch):
    from app.repositories import news

    def fake_news(limit: int, category: str | None = None):
        assert limit == 3
        assert category is None
        return [
            {
                "id": "real-1",
                "category": "快讯",
                "timestamp": "2026-04-22 12:45:00",
                "title": "真实财经快讯",
                "summary": "来自 AkShare 的实时资讯",
            }
        ]

    monkeypatch.setattr(news.market_data, "fetch_news_items", fake_news)

    response = client.get("/api/v1/news?limit=10")

    assert response.status_code == 200
    assert response.json()["items"][0]["title"] == "真实财经快讯"


def test_screener_options_use_synced_dimension_values(client):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "688001.SH",
                "测试科技",
                "A",
                "科创板",
                "民营企业",
                "半导体",
                1200.0,
                30.0,
                1.2,
                3.1,
                8.4,
                20.0,
                17.6,
                22.4,
                "hold",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "833001.BJ",
                "测试制造",
                "A",
                "北交所",
                "央企",
                "制造",
                800.0,
                18.0,
                2.4,
                1.8,
                9.9,
                12.0,
                10.56,
                13.44,
                "buy",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()

    response = client.get("/api/v1/screener/options")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ownership"] == ["央企", "民营企业"]
    assert payload["exchanges"] == ["北交所", "科创板"]


def test_screener_starts_empty_before_data_sync(client):
    response = client.post(
        "/api/v1/screener/query",
        json={
            "filters": {},
            "ownership": [],
            "exchanges": [],
            "page": 1,
            "pageSize": 20,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 0
    assert payload["items"] == []


def test_screener_query_returns_minimal_data_fields(client):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, listing_exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, revenue_segments_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600519.SH",
                "贵州茅台",
                "A",
                "沪深",
                "沪深",
                "地方国企",
                "食品饮料",
                21200.5,
                28.4,
                1.7,
                9.2,
                0.0,
                1500.0,
                1320.0,
                1680.0,
                "hold",
                '[{"name":"酒类","revenue_percent":96.2}]',
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.execute(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume,
                amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600519.SH",
                "2026-04-22",
                1660.0,
                1688.0,
                1700.0,
                1650.0,
                10000,
                16880000.0,
                1.24,
                1.24,
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()

    response = client.post(
        "/api/v1/screener/query",
        json={"filters": {}, "ownership": [], "exchanges": [], "page": 1, "pageSize": 20},
    )

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["exchange"] == "沪深"
    assert item["listingExchange"] == "沪深"
    assert item["industry"] == "食品饮料"
    assert item["tradeDate"] == "2026-04-22"
    assert item["ownership"] == "地方国企"
    assert item["revenueSegments"] == [{"name": "酒类", "revenuePercent": 96.2}]


def test_dashboard_watchlist_starts_empty_after_data_sync_without_user_items(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    response = client.get("/api/v1/watchlists?group_by=flat")

    assert response.status_code == 200
    assert response.json()["groups"][0]["stocks"] == []


def test_search_stock_result_includes_latest_database_price(client):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "000001.SZ",
                "平安银行",
                "A",
                "沪深",
                "未知",
                "银行",
                1380.5,
                5.6,
                0.0,
                0.8,
                0.0,
                12.0,
                10.56,
                13.44,
                "buy",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.executemany(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume,
                amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("000001.SZ", "2026-04-21", 10.0, 10.5, 10.8, 9.9, 1000, 10500.0, 1.2, 1.2, "2026-04-21T00:00:00+08:00"),
                ("000001.SZ", "2026-04-22", 11.0, 11.35, 11.5, 10.9, 1000, 11350.0, 0.85, 8.1, "2026-04-22T00:00:00+08:00"),
            ],
        )
        conn.commit()

    response = client.get("/api/v1/search", params={"q": "平安", "limit": 5})

    assert response.status_code == 200
    stock = response.json()["items"][0]
    assert stock["type"] == "stock"
    assert stock["id"] == "000001.SZ"
    assert stock["latestPrice"] == 11.35
    assert stock["latestTradeDate"] == "2026-04-22"
    assert stock["industry"] == "银行"


def test_search_stock_result_matches_symbol_without_exchange_suffix(client):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600012.SH",
                "皖通高速",
                "A",
                "沪深",
                "地方国企",
                "交通运输",
                180.0,
                12.0,
                3.0,
                1.2,
                0.0,
                10.0,
                8.8,
                11.2,
                "hold",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()

    response = client.get("/api/v1/search", params={"q": "600012", "limit": 5})

    assert response.status_code == 200
    stock = response.json()["items"][0]
    assert stock["type"] == "stock"
    assert stock["id"] == "600012.SH"
    assert stock["title"] == "皖通高速"


def test_search_stock_code_miss_syncs_single_symbol_then_returns_result(client, monkeypatch):
    from app.repositories import search as search_repo

    def fake_run_sync(conn, request, progress_callback=None):
        assert request.symbols == ["600010"]
        assert request.limit == 1
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600010.SH",
                "包钢股份",
                "A",
                "沪深",
                "地方国企",
                "钢铁",
                760.0,
                20.0,
                0.0,
                1.1,
                0.0,
                1.8,
                1.58,
                2.02,
                "hold",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()
        return 1, 0, "synced"

    monkeypatch.setattr(search_repo.akshare_sync, "run_sync", fake_run_sync)

    response = client.get("/api/v1/search", params={"q": "600010", "limit": 5})

    assert response.status_code == 200
    stock = response.json()["items"][0]
    assert stock["type"] == "stock"
    assert stock["id"] == "600010.SH"
    assert stock["title"] == "包钢股份"


def test_watchlists_include_default_my_watchlist_group(client):
    response = client.get("/api/v1/watchlists")

    assert response.status_code == 200
    groups = response.json()["groups"]
    assert any(
        group["id"] == "sector-my-watchlist"
        and group["name"] == "自选分组"
        and group["isDefault"]
        for group in groups
    )


def test_watchlist_adds_and_deletes_stock_from_default_group(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    add_response = client.post(
        "/api/v1/watchlists/stocks",
        json={"symbol": "300750.SZ", "note": "重点跟踪"},
    )

    assert add_response.status_code == 201
    assert add_response.json()["watchlistId"] == "sector-my-watchlist"
    assert add_response.json()["symbol"] == "300750.SZ"

    flat_response = client.get("/api/v1/watchlists?group_by=flat")
    stocks = flat_response.json()["groups"][0]["stocks"]
    assert [stock["symbol"] for stock in stocks] == ["300750.SZ"]
    assert stocks[0]["industry"] == "未分类"

    delete_response = client.delete("/api/v1/watchlists/sector-my-watchlist/stocks/300750.SZ")

    assert delete_response.status_code == 204
    flat_response = client.get("/api/v1/watchlists?group_by=flat")
    assert flat_response.json()["groups"][0]["stocks"] == []


def test_watchlist_group_can_be_created_renamed_and_deleted(client):
    create_response = client.post(
        "/api/v1/watchlists",
        json={"name": "高股息", "groupType": "sector"},
    )

    assert create_response.status_code == 201
    group_id = create_response.json()["id"]
    assert create_response.json()["name"] == "高股息"

    rename_response = client.patch(
        f"/api/v1/watchlists/{group_id}",
        json={"name": "红利资产"},
    )

    assert rename_response.status_code == 200
    assert rename_response.json()["id"] == group_id
    assert rename_response.json()["name"] == "红利资产"

    delete_response = client.delete(f"/api/v1/watchlists/{group_id}")

    assert delete_response.status_code == 204
    groups = client.get("/api/v1/watchlists").json()["groups"]
    assert all(group["id"] != group_id for group in groups)


def test_watchlist_stock_can_exist_in_multiple_groups_without_flat_duplicates(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    group_response = client.post(
        "/api/v1/watchlists",
        json={"name": "高股息", "groupType": "custom"},
    )
    group_id = group_response.json()["id"]

    assert client.post("/api/v1/watchlists/stocks", json={"symbol": "300750.SZ"}).status_code == 201
    assert client.post(f"/api/v1/watchlists/{group_id}/stocks", json={"symbol": "300750.SZ"}).status_code == 201

    groups = client.get("/api/v1/watchlists").json()["groups"]
    default_group = next(group for group in groups if group["id"] == "sector-my-watchlist")
    custom_group = next(group for group in groups if group["id"] == group_id)
    assert [stock["symbol"] for stock in default_group["stocks"]] == ["300750.SZ"]
    assert [stock["symbol"] for stock in custom_group["stocks"]] == ["300750.SZ"]

    flat_stocks = client.get("/api/v1/watchlists?group_by=flat").json()["groups"][0]["stocks"]
    assert [stock["symbol"] for stock in flat_stocks] == ["300750.SZ"]
    assert set(flat_stocks[0]["groupIds"]) == {"sector-my-watchlist", group_id}


def test_watchlist_stock_chart_returns_price_points(client, monkeypatch):
    from app.database import connect
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume, amount,
                change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("300750.SZ", "2026-04-23", 190.0, 195.0, 198.0, 188.0, 2000000, 390000000.0, 2.0, 1.04, "2026-04-23T00:00:00+08:00"),
        )
        conn.commit()

    response = client.get("/api/v1/watchlists/stocks/300750.SZ/chart?range=5d")

    assert response.status_code == 200
    payload = response.json()
    assert payload["symbol"] == "300750.SZ"
    assert payload["range"] == "5d"
    assert [point["date"] for point in payload["points"]] == ["2026-04-22", "2026-04-23"]

    weekly_response = client.get("/api/v1/watchlists/stocks/300750.SZ/chart?range=weekly")

    assert weekly_response.status_code == 200
    weekly_payload = weekly_response.json()
    assert weekly_payload["range"] == "weekly"
    assert [point["date"] for point in weekly_payload["points"]] == ["2026-04-23"]


def test_stock_detail_weekly_chart_uses_last_trade_date(client):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "000001.SZ",
                "平安银行",
                "A",
                "沪深",
                "未知",
                "银行",
                1380.5,
                5.6,
                4.2,
                0.8,
                0.0,
                12.0,
                10.56,
                13.44,
                "buy",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.executemany(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume,
                amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("000001.SZ", "2026-04-27", 10.0, 10.3, 10.5, 9.9, 1000, 10300.0, 0.3, 3.0, "2026-04-27T00:00:00+08:00"),
                ("000001.SZ", "2026-04-30", 10.3, 10.8, 11.0, 10.2, 2000, 21600.0, 0.5, 4.85, "2026-04-30T00:00:00+08:00"),
            ],
        )
        conn.commit()

    response = client.get("/api/v1/stocks/000001.SZ/detail?range=weekly")

    assert response.status_code == 200
    payload = response.json()
    assert payload["chart"]["range"] == "weekly"
    assert [point["date"] for point in payload["chart"]["points"]] == ["2026-04-30"]
    assert payload["tradeDate"] == "2026-04-30"
    assert payload["latestPrice"] == 10.8


AKSHARE_TEST_ROWS = [
    (
        "000001.SZ",
        "平安银行",
        "A",
        "沪深",
        "未知",
        "未分类",
        1380.5,
        5.6,
        4.2,
        0.0,
        0.0,
        9.8,
        1.23,
        12.0,
        "P",
        "2026-04-22",
        9.6,
        10.0,
        9.5,
        123456,
        123456789.0,
    ),
    (
        "600519.SH",
        "贵州茅台",
        "A",
        "沪深",
        "未知",
        "未分类",
        21200.5,
        28.4,
        1.7,
        9.2,
        0.0,
        1688.0,
        1.24,
        1500.0,
        "M",
        "2026-04-22",
        1660.0,
        1700.0,
        1650.0,
        10000,
        16880000.0,
    ),
    (
        "300750.SZ",
        "宁德时代",
        "A",
        "创业板",
        "未知",
        "未分类",
        8290.1,
        18.2,
        0.9,
        4.8,
        0.0,
        188.5,
        -0.85,
        220.0,
        "C",
        "2026-04-22",
        190.0,
        191.0,
        187.0,
        20000,
        3770000.0,
    ),
    (
        "002594.SZ",
        "比亚迪",
        "A",
        "沪深",
        "未知",
        "未分类",
        5970.8,
        22.5,
        0.3,
        5.1,
        0.0,
        205.1,
        2.1,
        200.0,
        "B",
        "2026-04-22",
        201.0,
        207.0,
        200.0,
        30000,
        6153000.0,
    ),
]


def test_screener_filtered_empty_still_reports_available_data(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    response = client.post(
        "/api/v1/screener/query",
        json={
            "filters": {
                "marketCap": {"operator": "gt", "value": 50000}
            },
            "ownership": [],
            "exchanges": [],
            "page": 1,
            "pageSize": 20,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"] == []
    assert payload["total"] == 0
    assert payload["availableTotal"] > 0


def test_screener_returns_ma120_thresholds_and_signals_after_data_sync(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    response = client.post(
        "/api/v1/screener/query",
        json={
            "filters": {},
            "ownership": [],
            "exchanges": [],
            "page": 1,
            "pageSize": 20,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 3
    rows = {item["symbol"]: item for item in payload["items"]}
    assert rows["600519.SH"]["ma120"] == 1500.0
    assert rows["600519.SH"]["ma120Lower"] == 1320.0
    assert rows["600519.SH"]["ma120Upper"] == 1680.0
    assert rows["600519.SH"]["signal"] == "sell"
    assert rows["600519.SH"]["industry"] == "未分类"
    assert rows["300750.SZ"]["signal"] == "buy"
    assert rows["300750.SZ"]["industry"] == "未分类"
    assert rows["002594.SZ"]["signal"] == "hold"
    assert rows["002594.SZ"]["industry"] == "未分类"


def test_screener_query_applies_requested_sort(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    response = client.post(
        "/api/v1/screener/query",
        json={
            "filters": {},
            "ownership": [],
            "exchanges": [],
            "page": 1,
            "pageSize": 20,
            "sort": {"field": "price", "direction": "asc"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["symbol"] for item in payload["items"]] == [
        "000001.SZ",
        "300750.SZ",
        "002594.SZ",
        "600519.SH",
    ]


def test_screener_query_sorts_by_signal(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    response = client.post(
        "/api/v1/screener/query",
        json={
            "filters": {},
            "ownership": [],
            "exchanges": [],
            "page": 1,
            "pageSize": 20,
            "sort": {"field": "signal", "direction": "desc"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["signal"] for item in payload["items"]] == ["buy", "buy", "hold", "sell"]


def test_screener_query_filters_signals_before_pagination(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    response = client.post(
        "/api/v1/screener/query",
        json={
            "filters": {},
            "ownership": [],
            "exchanges": [],
            "signals": ["buy"],
            "page": 1,
            "pageSize": 1,
            "sort": {"field": "signal", "direction": "desc"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert len(payload["items"]) == 1
    assert payload["items"][0]["signal"] == "buy"


def test_data_sync_job_updates_latest_status_and_dataset_rows(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)

    create_response = client.post(
        "/api/v1/data-sync/jobs",
        json={
            "source": "akshare",
            "scopes": ["stock_basic", "daily_prices", "fundamentals"],
            "markets": ["A"],
            "fullRefresh": False,
        },
    )

    assert create_response.status_code == 202
    job = create_response.json()
    assert job["jobId"].startswith("sync-")
    assert job["status"] in {"queued", "running", "success"}

    status_response = client.get(f"/api/v1/data-sync/jobs/{job['jobId']}")
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["status"] == "success"
    assert status_payload["updatedRows"] > 0

    latest_response = client.get("/api/v1/data-sync/jobs/latest")
    assert latest_response.status_code == 200
    assert latest_response.json()["jobId"] == job["jobId"]

    datasets_response = client.get("/api/v1/data-sync/datasets")
    assert datasets_response.status_code == 200
    datasets = {item["scope"]: item for item in datasets_response.json()["items"]}
    assert datasets["stock_basic"]["rows"] > 0
    assert datasets["daily_prices"]["rows"] > 0
    assert datasets["fundamentals"]["rows"] > 0


def test_data_sync_rejects_new_job_when_previous_job_is_active(client, monkeypatch):
    from app.routers import data_sync as data_sync_router

    monkeypatch.setattr(data_sync_router, "process_job", lambda *_args, **_kwargs: None)

    first = client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})
    assert first.status_code == 202

    second = client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})
    assert second.status_code == 409
    assert second.json()["detail"] == "Data sync job already in progress"


def test_data_sync_ignores_stale_running_job_when_submitting_new_job(client, monkeypatch):
    from app.database import connect
    from app.routers import data_sync as data_sync_router

    monkeypatch.setattr(data_sync_router, "process_job", lambda *_args, **_kwargs: None)

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO data_sync_jobs (
                id, source, status, scopes_json, markets_json, symbols_json,
                trade_date, full_refresh, limit_value, update_mode, total_tasks,
                completed_tasks, message, started_at, finished_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "stale-job-1",
                "akshare",
                "running",
                '["stock_basic"]',
                '["A"]',
                None,
                None,
                0,
                300,
                "full",
                10,
                1,
                "正在更新 AkShare 数据",
                "2020-01-01T00:00:00+08:00",
                None,
                "2020-01-01T00:00:00+08:00",
            ),
        )
        conn.commit()

    response = client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    assert response.status_code == 202

    with connect() as conn:
        stale = conn.execute(
            "SELECT status, finished_at, message FROM data_sync_jobs WHERE id='stale-job-1'"
        ).fetchone()

    assert stale["status"] == "failed"
    assert stale["finished_at"] is not None
    assert "stale" in stale["message"].lower()


def test_data_sync_job_accepts_limit_and_update_mode(client, monkeypatch):
    from app.services import akshare_sync

    captured = {}

    def fake_run_sync(_conn, request, progress_callback=None):
        captured["limit"] = request.limit
        captured["update_mode"] = request.update_mode.value
        if progress_callback:
            progress_callback(4, request.limit, "测试进度 4/7")
        return 0, 0, "ok"

    monkeypatch.setattr(akshare_sync, "run_sync", fake_run_sync)

    create_response = client.post(
        "/api/v1/data-sync/jobs",
        json={"source": "akshare", "limit": 7, "updateMode": "price_only"},
    )

    assert create_response.status_code == 202
    job = create_response.json()
    assert job["limit"] == 7
    assert job["updateMode"] == "price_only"
    assert job["totalTasks"] == 7
    assert job["completedTasks"] == 0
    assert job["progressPercent"] == 0
    assert captured == {"limit": 7, "update_mode": "price_only"}

    latest = client.get("/api/v1/data-sync/jobs/latest").json()
    assert latest["limit"] == 7
    assert latest["updateMode"] == "price_only"
    assert latest["totalTasks"] == 7
    assert latest["completedTasks"] == 7
    assert latest["progressPercent"] == 100


def test_data_sync_job_accepts_date_range_and_full_universe(client, monkeypatch):
    from app.services import akshare_sync

    captured = {}

    def fake_run_sync(_conn, request, progress_callback=None):
        captured["start_date"] = request.start_date.isoformat()
        captured["end_date"] = request.end_date.isoformat()
        captured["full_universe"] = request.full_universe
        captured["sync_limit"] = akshare_sync.get_sync_limit(request)
        if progress_callback:
            progress_callback(5, 5, "测试全量进度")
        return 0, 0, "ok"

    monkeypatch.setattr(akshare_sync, "run_sync", fake_run_sync)

    create_response = client.post(
        "/api/v1/data-sync/jobs",
        json={
            "source": "akshare",
            "startDate": "2026-01-01",
            "endDate": "2026-04-30",
            "fullUniverse": True,
            "updateMode": "full",
        },
    )

    assert create_response.status_code == 202
    job = create_response.json()
    assert job["startDate"] == "2026-01-01"
    assert job["endDate"] == "2026-04-30"
    assert job["fullUniverse"] is True
    assert job["totalTasks"] == 10000
    assert captured == {
        "start_date": "2026-01-01",
        "end_date": "2026-04-30",
        "full_universe": True,
        "sync_limit": 10000,
    }


def test_data_sync_job_can_pause_resume_and_stop(client, monkeypatch):
    from app.routers import data_sync as data_sync_router

    monkeypatch.setattr(data_sync_router, "process_job", lambda *_args, **_kwargs: None)

    create_response = client.post("/api/v1/data-sync/jobs", json={"source": "akshare", "limit": 7})
    assert create_response.status_code == 202
    job_id = create_response.json()["jobId"]

    pause_response = client.post(f"/api/v1/data-sync/jobs/{job_id}/pause")
    assert pause_response.status_code == 200
    assert pause_response.json()["status"] == "paused"

    second_create = client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})
    assert second_create.status_code == 409

    resume_response = client.post(f"/api/v1/data-sync/jobs/{job_id}/resume")
    assert resume_response.status_code == 200
    assert resume_response.json()["status"] == "running"

    stop_response = client.post(f"/api/v1/data-sync/jobs/{job_id}/stop")
    assert stop_response.status_code == 200
    assert stop_response.json()["status"] == "stopped"
    assert stop_response.json()["finishedAt"] is not None


def test_data_sync_job_reports_failure_when_akshare_fetch_fails(client, monkeypatch):
    from app.services import akshare_sync

    def fail_fetch(_request, _progress_callback=None):
        raise RuntimeError("akshare unavailable")

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", fail_fetch)

    create_response = client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    assert create_response.status_code == 202
    job = create_response.json()

    status_response = client.get(f"/api/v1/data-sync/jobs/{job['jobId']}")
    assert status_response.status_code == 200
    payload = status_response.json()
    assert payload["status"] == "failed"
    assert payload["failedRows"] == 1
    assert "akshare unavailable" in payload["message"]


def test_akshare_fetch_uses_real_fallback_when_eastmoney_snapshot_disconnects(monkeypatch):
    import sys

    import pandas as pd

    from app.schemas import DataSyncJobCreate
    from app.services import akshare_sync

    class FakeAkshare:
        def stock_zh_a_spot_em(self):
            raise ConnectionError("RemoteDisconnected")

        def stock_info_a_code_name(self):
            return pd.DataFrame([{"code": "000001", "name": "平安银行"}])

        def stock_zh_a_hist(self, **_kwargs):
            raise ConnectionError("RemoteDisconnected")

        def stock_zh_a_hist_tx(self, **_kwargs):
            return pd.DataFrame(
                [
                    {"date": "2026-04-20", "open": 9.7, "close": 10.0, "high": 10.1, "low": 9.6, "amount": 1000},
                    {"date": "2026-04-21", "open": 10.2, "close": 11.0, "high": 11.1, "low": 10.1, "amount": 1200},
                ]
            )

        def stock_zh_a_daily(self, **_kwargs):
            raise AssertionError("Tencent history should be used before Sina fallback")

        def stock_individual_info_em(self, **_kwargs):
            raise ConnectionError("RemoteDisconnected")

    monkeypatch.setitem(sys.modules, "akshare", FakeAkshare())

    rows = list(akshare_sync.fetch_akshare_rows(DataSyncJobCreate(symbols=["000001"])))

    assert len(rows) == 1
    row = rows[0]
    assert row[0] == "000001.SZ"
    assert row[1] == "平安银行"
    assert row[11] == 11.0
    assert row[12] == 10.0
    assert row[13] == 10.5
    assert row[15:20] == ("2026-04-21", 10.2, 11.1, 10.1, 120000)
    assert row[20] == 0.0


def test_akshare_fetch_honors_request_limit(monkeypatch):
    import sys

    import pandas as pd

    from app.schemas import DataSyncJobCreate
    from app.services import akshare_sync

    class FakeAkshare:
        def stock_zh_a_spot_em(self):
            return pd.DataFrame(
                [
                    {"代码": "000001", "名称": "平安银行", "最新价": 10, "涨跌幅": 1, "总市值": 1000000000, "市盈率-动态": 5, "市净率": 1, "今开": 9.8, "最高": 10.2, "最低": 9.7, "成交量": 100, "成交额": 1000},
                    {"代码": "000002", "名称": "万科A", "最新价": 11, "涨跌幅": 2, "总市值": 2000000000, "市盈率-动态": 6, "市净率": 1.2, "今开": 10.8, "最高": 11.2, "最低": 10.7, "成交量": 200, "成交额": 2000},
                ]
            )

        def stock_zh_a_hist_tx(self, **_kwargs):
            return pd.DataFrame(
                [
                    {"date": "2026-04-20", "open": 9.7, "close": 10.0, "high": 10.1, "low": 9.6, "amount": 1000},
                    {"date": "2026-04-21", "open": 10.2, "close": 11.0, "high": 11.1, "low": 10.1, "amount": 1200},
                ]
            )

    monkeypatch.setitem(sys.modules, "akshare", FakeAkshare())

    rows = list(akshare_sync.fetch_akshare_rows(DataSyncJobCreate(limit=1)))

    assert len(rows) == 1
    assert rows[0][0] == "000001.SZ"


def test_akshare_fetch_includes_requested_history_range(monkeypatch):
    import sys

    import pandas as pd

    from app.schemas import DataSyncJobCreate
    from app.services import akshare_sync

    captured = {}

    class FakeAkshare:
        def stock_zh_a_spot_em(self):
            return pd.DataFrame(
                [
                    {"代码": "000001", "名称": "平安银行", "最新价": 12, "涨跌幅": 3, "总市值": 1000000000, "市盈率-动态": 5, "市净率": 1, "今开": 11.8, "最高": 12.2, "最低": 11.7, "成交量": 100, "成交额": 1000},
                ]
            )

        def stock_zh_a_hist_tx(self, **kwargs):
            captured.update(kwargs)
            return pd.DataFrame(
                [
                    {"date": "2026-01-01", "open": 9.7, "close": 10.0, "high": 10.1, "low": 9.6, "amount": 1000},
                    {"date": "2026-01-02", "open": 10.2, "close": 11.0, "high": 11.1, "low": 10.1, "amount": 1200},
                    {"date": "2026-01-05", "open": 11.2, "close": 12.0, "high": 12.1, "low": 11.1, "amount": 1400},
                ]
            )

    monkeypatch.setitem(sys.modules, "akshare", FakeAkshare())

    rows = list(
        akshare_sync.fetch_akshare_rows(
            DataSyncJobCreate(startDate="2026-01-02", endDate="2026-01-05", limit=1)
        )
    )

    assert captured["end_date"] == "20260105"
    assert rows[0][15] == "2026-01-05"
    assert [item["trade_date"] for item in rows[0][23]] == ["2026-01-02", "2026-01-05"]


def test_akshare_fallback_populates_valuation_metrics(monkeypatch):
    import sys

    import pandas as pd

    from app.schemas import DataSyncJobCreate
    from app.services import akshare_sync

    class FakeAkshare:
        def stock_zh_a_spot_em(self):
            raise ConnectionError("RemoteDisconnected")

        def stock_info_a_code_name(self):
            return pd.DataFrame([{"code": "000001", "name": "平安银行"}])

        def stock_zh_a_hist_tx(self, **_kwargs):
            return pd.DataFrame(
                [
                    {"date": "2026-04-20", "open": 9.7, "close": 10.0, "high": 10.1, "low": 9.6, "amount": 1000},
                    {"date": "2026-04-21", "open": 10.2, "close": 11.0, "high": 11.1, "low": 10.1, "amount": 1200},
                ]
            )

        def stock_individual_info_em(self, **_kwargs):
            raise ConnectionError("RemoteDisconnected")

        def stock_value_em(self, **_kwargs):
            return pd.DataFrame(
                [
                    {
                        "数据日期": "2026-04-21",
                        "总市值": 12340000000,
                        "PE(TTM)": 12.3,
                        "PE(静)": 13.4,
                        "市净率": 1.7,
                    }
                ]
            )

    monkeypatch.setitem(sys.modules, "akshare", FakeAkshare())

    rows = list(akshare_sync.fetch_akshare_rows(DataSyncJobCreate(symbols=["000001"])))

    assert len(rows) == 1
    row = rows[0]
    assert row[6] == 123.4
    assert row[7] == 12.3
    assert row[9] == 1.7


def test_akshare_fallback_parses_percent_dividend_strings(monkeypatch):
    import sys

    import pandas as pd

    from app.schemas import DataSyncJobCreate
    from app.services import akshare_sync

    class FakeAkshare:
        def stock_zh_a_spot_em(self):
            raise ConnectionError("RemoteDisconnected")

        def stock_info_a_code_name(self):
            return pd.DataFrame([{"code": "000001", "name": "平安银行"}])

        def stock_zh_a_hist_tx(self, **_kwargs):
            return pd.DataFrame(
                [
                    {"date": "2026-04-20", "open": 9.7, "close": 10.0, "high": 10.1, "low": 9.6, "amount": 1000},
                    {"date": "2026-04-21", "open": 10.2, "close": 11.0, "high": 11.1, "low": 10.1, "amount": 1200},
                ]
            )

        def stock_individual_info_em(self, **_kwargs):
            return pd.DataFrame(
                [
                    {"item": "股票简称", "value": "平安银行"},
                    {"item": "行业", "value": "银行"},
                    {"item": "总市值", "value": 12340000000},
                    {"item": "市盈率", "value": 12.3},
                    {"item": "市净率", "value": 1.7},
                    {"item": "股息率(%)", "value": "4.2%"},
                ]
            )

    monkeypatch.setitem(sys.modules, "akshare", FakeAkshare())

    rows = list(akshare_sync.fetch_akshare_rows(DataSyncJobCreate(symbols=["000001"])))

    assert len(rows) == 1
    row = rows[0]
    assert row[8] == 4.2


def test_akshare_fetch_enriches_company_nature_and_listing_place(monkeypatch):
    import sys

    import pandas as pd

    from app.schemas import DataSyncJobCreate
    from app.services import akshare_sync

    class FakeAkshare:
        def __init__(self):
            self.profile_calls = []
            self.basic_info_calls = []

        def stock_zh_a_spot_em(self):
            return pd.DataFrame(
                [
                    {
                        "代码": "300750",
                        "名称": "宁德时代",
                        "最新价": 188.5,
                        "涨跌幅": -0.85,
                        "总市值": 829010000000,
                        "市盈率-动态": 18.2,
                        "市净率": 4.8,
                        "今开": 190.0,
                        "最高": 191.0,
                        "最低": 187.0,
                        "成交量": 20000,
                        "成交额": 3770000.0,
                    }
                ]
            )

        def stock_zh_a_hist_tx(self, **_kwargs):
            return pd.DataFrame(
                [
                    {"date": "2026-04-20", "open": 187.0, "close": 188.0, "high": 189.0, "low": 186.0, "amount": 1000},
                    {"date": "2026-04-21", "open": 190.0, "close": 188.5, "high": 191.0, "low": 187.0, "amount": 1200},
                ]
            )

        def stock_profile_cninfo(self, symbol):
            self.profile_calls.append(symbol)
            return pd.DataFrame([{"所属市场": "创业板", "所属行业": "电池"}])

        def stock_individual_basic_info_xq(self, symbol, timeout=None):
            self.basic_info_calls.append(symbol)
            return pd.DataFrame(
                [
                    {"item": "actual_controller", "value": "曾毓群 (22.45%)"},
                    {"item": "classi_name", "value": "民营企业"},
                ]
            )

    fake = FakeAkshare()
    monkeypatch.setitem(sys.modules, "akshare", fake)

    rows = list(akshare_sync.fetch_akshare_rows(DataSyncJobCreate(symbols=["300750"])))

    assert len(rows) == 1
    row = rows[0]
    assert row[3] == "创业板"
    assert row[4] == "民营企业"
    assert row[5] == "电池"
    assert row[21] == "创业板"
    assert fake.profile_calls == ["300750"]
    assert fake.basic_info_calls == ["SZ300750"]


def test_akshare_code_name_fallback_enriches_state_owned_company_nature(monkeypatch):
    import sys

    import pandas as pd

    from app.schemas import DataSyncJobCreate
    from app.services import akshare_sync

    class FakeAkshare:
        def stock_zh_a_spot_em(self):
            raise ConnectionError("RemoteDisconnected")

        def stock_info_a_code_name(self):
            return pd.DataFrame([{"code": "600519", "name": "贵州茅台"}])

        def stock_zh_a_hist_tx(self, **_kwargs):
            return pd.DataFrame(
                [
                    {"date": "2026-04-20", "open": 1660.0, "close": 1680.0, "high": 1690.0, "low": 1650.0, "amount": 1000},
                    {"date": "2026-04-21", "open": 1688.0, "close": 1688.0, "high": 1700.0, "low": 1650.0, "amount": 1200},
                ]
            )

        def stock_individual_info_em(self, **_kwargs):
            return pd.DataFrame(
                [
                    {"item": "股票简称", "value": "贵州茅台"},
                    {"item": "行业", "value": "白酒"},
                    {"item": "总市值", "value": 2120050000000},
                    {"item": "市盈率", "value": 28.4},
                    {"item": "市净率", "value": 9.2},
                ]
            )

        def stock_profile_cninfo(self, symbol):
            assert symbol == "600519"
            return pd.DataFrame([{"所属市场": "上交所主板", "所属行业": "白酒"}])

        def stock_individual_basic_info_xq(self, symbol, timeout=None):
            assert symbol == "SH600519"
            return pd.DataFrame(
                [
                    {"item": "actual_controller", "value": "贵州省人民政府国有资产监督管理委员会 (48.96%)"},
                    {"item": "classi_name", "value": "省属国资控股"},
                ]
            )

    monkeypatch.setitem(sys.modules, "akshare", FakeAkshare())

    rows = list(akshare_sync.fetch_akshare_rows(DataSyncJobCreate(symbols=["600519"])))

    assert len(rows) == 1
    row = rows[0]
    assert row[3] == "沪深"
    assert row[4] == "地方国企"
    assert row[5] == "白酒"


def test_data_sync_job_persists_akshare_rows(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)

    create_response = client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    assert create_response.status_code == 202
    job = create_response.json()
    assert client.get(f"/api/v1/data-sync/jobs/{job['jobId']}").json()["status"] == "success"

    screener_response = client.post(
        "/api/v1/screener/query",
        json={"filters": {}, "ownership": [], "exchanges": [], "page": 1, "pageSize": 100},
    )

    rows_by_symbol = {item["symbol"]: item for item in screener_response.json()["items"]}
    assert rows_by_symbol["000001.SZ"]["price"] == 9.8
    assert rows_by_symbol["000001.SZ"]["dividend"] == 4.2
    assert rows_by_symbol["000001.SZ"]["ma120"] == 12.0
    assert rows_by_symbol["000001.SZ"]["signal"] == "buy"
    assert rows_by_symbol["000001.SZ"]["listingExchange"] == "沪深"

    from app.database import connect

    with connect() as conn:
        listing_exchange = conn.execute(
            "SELECT listing_exchange FROM stock_fundamentals WHERE symbol = ?",
            ("000001.SZ",),
        ).fetchone()["listing_exchange"]
    assert listing_exchange == "沪深"


def test_market_movers_rank_latest_synced_backend_prices(client):
    from app.database import connect

    with connect() as conn:
        conn.executemany(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "000001.SZ",
                    "平安银行",
                    "A",
                    "沪深",
                    "未知",
                    "银行",
                    123.4,
                    8.8,
                    0.0,
                    0.8,
                    0.0,
                    10.0,
                    8.8,
                    11.2,
                    "hold",
                    "2026-04-23T00:00:00+08:00",
                ),
                (
                    "000002.SZ",
                    "万科A",
                    "A",
                    "沪深",
                    "未知",
                    "地产",
                    600.0,
                    12.0,
                    0.0,
                    1.1,
                    0.0,
                    10.0,
                    8.8,
                    11.2,
                    "hold",
                    "2026-04-23T00:00:00+08:00",
                ),
            ],
        )
        conn.executemany(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume,
                amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("000001.SZ", "2026-04-22", 10.0, 10.9, 11.0, 9.9, 1000, 10900.0, 0.9, 9.0, "2026-04-22T00:00:00+08:00"),
                ("000001.SZ", "2026-04-23", 10.9, 10.8, 11.0, 10.6, 1000, 10800.0, -0.1, -0.92, "2026-04-23T00:00:00+08:00"),
                ("000002.SZ", "2026-04-22", 10.0, 9.7, 10.1, 9.6, 1000, 9700.0, -0.3, -3.0, "2026-04-22T00:00:00+08:00"),
                ("000002.SZ", "2026-04-23", 9.7, 10.1, 10.2, 9.6, 1000, 10100.0, 0.4, 4.12, "2026-04-23T00:00:00+08:00"),
            ],
        )
        conn.commit()

    gainers_response = client.get("/api/v1/market/movers?direction=gainers&limit=2")
    losers_response = client.get("/api/v1/market/movers?direction=losers&limit=2")

    assert gainers_response.status_code == 200
    assert losers_response.status_code == 200
    assert gainers_response.json()["items"] == [
        {"symbol": "000002.SZ", "name": "万科A", "pctChange": 4.12},
        {"symbol": "000001.SZ", "name": "平安银行", "pctChange": -0.92},
    ]
    assert losers_response.json()["items"] == [
        {"symbol": "000001.SZ", "name": "平安银行", "pctChange": -0.92},
        {"symbol": "000002.SZ", "name": "万科A", "pctChange": 4.12},
    ]


def test_screener_pe_filter_excludes_unknown_zero_pe(client):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "000001.SZ",
                "平安银行",
                "A",
                "沪深",
                "未知",
                "银行",
                123.4,
                8.8,
                0.0,
                0.8,
                0.0,
                10.0,
                8.8,
                11.2,
                "hold",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "000002.SZ",
                "未知估值",
                "A",
                "沪深",
                "未知",
                "地产",
                600.0,
                0.0,
                0.0,
                0.0,
                0.0,
                10.0,
                8.8,
                11.2,
                "hold",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.executemany(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume,
                amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("000001.SZ", "2026-04-22", 10.0, 10.5, 10.8, 9.9, 1000, 10500.0, 1.2, 1.2, "2026-04-22T00:00:00+08:00"),
                ("000002.SZ", "2026-04-22", 10.0, 10.5, 10.8, 9.9, 1000, 10500.0, 1.2, 1.2, "2026-04-22T00:00:00+08:00"),
            ],
        )
        conn.commit()

    response = client.post(
        "/api/v1/screener/query",
        json={
            "filters": {"pe": {"operator": "lt", "value": 15}},
            "ownership": [],
            "exchanges": [],
            "page": 1,
            "pageSize": 20,
        },
    )

    assert response.status_code == 200
    symbols = [item["symbol"] for item in response.json()["items"]]
    assert symbols == ["000001.SZ"]


def test_price_only_sync_updates_latest_price_and_keeps_ma120(client, monkeypatch):
    import pandas as pd

    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: [AKSHARE_TEST_ROWS[0]])
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare", "limit": 1, "updateMode": "full"})

    monkeypatch.setattr(
        akshare_sync,
        "fetch_history",
        lambda *_args: pd.DataFrame(
            [
                {
                    "日期": "2026-04-23",
                    "开盘": 13.0,
                    "收盘": 13.5,
                    "最高": 13.8,
                    "最低": 12.9,
                    "成交量": 8888,
                    "成交额": 119988.0,
                    "涨跌幅": 2.5,
                }
            ]
        ),
    )

    create_response = client.post(
        "/api/v1/data-sync/jobs",
        json={"source": "akshare", "limit": 1, "updateMode": "price_only"},
    )

    assert create_response.status_code == 202
    job = create_response.json()
    assert client.get(f"/api/v1/data-sync/jobs/{job['jobId']}").json()["status"] == "success"

    screener_response = client.post(
        "/api/v1/screener/query",
        json={"filters": {}, "ownership": [], "exchanges": [], "page": 1, "pageSize": 20},
    )
    row = screener_response.json()["items"][0]
    assert row["symbol"] == "000001.SZ"
    assert row["price"] == 13.5
    assert row["ma120"] == 12.0
    assert row["signal"] == "sell"


def test_screener_export_applies_filters(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    response = client.get(
        "/api/v1/screener/export",
        params={
            "exchanges": "创业板",
            "filters": '{"marketCap":{"operator":"gt","value":8000}}',
        },
    )

    assert response.status_code == 200
    body = response.text
    assert "symbol,name,price,change,ma120,ma120Lower,ma120Upper,signal,marketCap,pe,dividend" in body
    assert "300750.SZ,宁德时代" in body
    assert ",0.9\n" in body
    assert "600519.SH,贵州茅台" not in body


def insert_test_holding(
    symbol="AAPL",
    name="苹果公司",
    quantity=500,
    cost=145.2,
    price=173.5,
    sector="信息技术",
):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO holdings (portfolio_id, symbol, name, quantity, cost, price, sector)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (1, symbol, name, quantity, cost, price, sector),
        )
        conn.commit()


def test_portfolio_initializes_without_holdings(client):
    summary_response = client.get("/api/v1/portfolio/summary")
    holdings_response = client.get("/api/v1/portfolio/holdings")
    allocation_response = client.get("/api/v1/portfolio/allocation")
    trades_response = client.get("/api/v1/portfolio/trades")

    assert summary_response.status_code == 200
    assert summary_response.json()["cash"] == 156000.0
    assert summary_response.json()["totalAssets"] == 156000.0
    assert holdings_response.json()["items"] == []
    assert allocation_response.json()["items"] == [
        {"name": "现金", "value": 100.0, "color": "#d0e6f3"}
    ]
    assert trades_response.json()["items"] == []


def test_portfolio_cash_deposit_updates_summary_cash_and_total_assets(client):
    from app.database import connect

    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (156000.0, 1))
        conn.commit()

    response = client.post(
        "/api/v1/portfolio/cash-adjustments",
        json={"portfolioId": 1, "side": "deposit", "amount": 25000, "tradedAt": "2026-04-22", "note": "追加本金"},
    )

    assert response.status_code == 200
    assert response.json()["cash"] == 181000.0
    assert response.json()["id"]
    assert response.json()["note"] == "追加本金"

    summary = client.get("/api/v1/portfolio/summary").json()
    assert summary["cash"] == 181000.0
    assert summary["totalAssets"] == 181000.0

    trades = client.get("/api/v1/portfolio/trades").json()["items"]
    assert trades == [
        {
            "id": response.json()["id"],
            "portfolioId": 1,
            "symbol": "CASH",
            "side": "deposit",
            "quantity": 25000.0,
            "price": 1.0,
            "totalAmount": 25000.0,
            "tradedAt": "2026-04-22",
            "note": "追加本金",
        }
    ]


def test_portfolio_cash_withdrawal_rejects_amount_larger_than_cash(client):
    from app.database import connect

    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (156000.0, 1))
        conn.commit()

    response = client.post(
        "/api/v1/portfolio/cash-adjustments",
        json={"portfolioId": 1, "side": "withdraw", "amount": 200000},
    )

    assert response.status_code == 400
    assert "现金不足" in response.json()["detail"]

    summary = client.get("/api/v1/portfolio/summary").json()
    assert summary["cash"] == 156000.0


def test_portfolio_deletes_cash_trade_and_reverses_cash_effect(client):
    from app.database import connect

    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (156000.0, 1))
        conn.commit()

    create_response = client.post(
        "/api/v1/portfolio/cash-adjustments",
        json={"portfolioId": 1, "side": "withdraw", "amount": 12000, "tradedAt": "2026-04-22"},
    )
    trade_id = create_response.json()["id"]

    assert client.get("/api/v1/portfolio/summary").json()["cash"] == 144000.0

    delete_response = client.delete(f"/api/v1/portfolio/trades/{trade_id}")

    assert delete_response.status_code == 204
    assert client.get("/api/v1/portfolio/summary").json()["cash"] == 156000.0
    assert client.get("/api/v1/portfolio/trades").json()["items"] == []


def test_portfolio_updates_cash_trade_and_recomputes_cash(client):
    from app.database import connect

    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (156000.0, 1))
        conn.commit()

    create_response = client.post(
        "/api/v1/portfolio/cash-adjustments",
        json={"portfolioId": 1, "side": "deposit", "amount": 10000, "tradedAt": "2026-04-22"},
    )
    trade_id = create_response.json()["id"]

    response = client.patch(
        f"/api/v1/portfolio/trades/{trade_id}",
        json={
            "portfolioId": 1,
            "symbol": "CASH",
            "side": "withdraw",
            "quantity": 5000,
            "price": 1,
            "tradedAt": "2026-04-23",
            "note": "调出备用金",
        },
    )

    assert response.status_code == 200
    assert response.json()["side"] == "withdraw"
    assert response.json()["totalAmount"] == 5000.0
    assert response.json()["tradedAt"] == "2026-04-23"
    assert response.json()["note"] == "调出备用金"
    assert client.get("/api/v1/portfolio/summary").json()["cash"] == 151000.0


def test_portfolio_buy_trade_updates_cash_and_holding_from_synced_stock(client):
    from app.database import connect

    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (156000.0, 1))
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "000001.SZ",
                "平安银行",
                "A",
                "沪深",
                "未知",
                "银行",
                1380.5,
                5.6,
                0.0,
                0.8,
                0.0,
                12.0,
                10.56,
                13.44,
                "buy",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()

    response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "000001.SZ",
            "side": "buy",
            "quantity": 100,
            "price": 10.25,
            "tradedAt": "2026-04-22T15:30:00+08:00",
        },
    )

    assert response.status_code == 201
    assert response.json()["symbol"] == "000001.SZ"

    summary = client.get("/api/v1/portfolio/summary").json()
    assert summary["cash"] == 154975.0

    holdings = client.get("/api/v1/portfolio/holdings").json()["items"]
    row = next(item for item in holdings if item["symbol"] == "000001.SZ")
    assert row["name"] == "平安银行"
    assert row["quantity"] == 100
    assert row["cost"] == 10.25
    assert row["price"] == 10.25


def test_portfolio_buy_trade_keeps_holding_price_from_latest_market_price(client):
    from app.database import connect

    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (5000.0, 1))
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600010.SH",
                "包钢股份",
                "A",
                "沪深",
                "地方国企",
                "钢铁",
                760.0,
                20.0,
                0.0,
                1.1,
                0.0,
                1.8,
                1.58,
                2.02,
                "hold",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.execute(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume,
                amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600010.SH",
                "2026-04-22",
                2.65,
                2.7,
                2.72,
                2.63,
                1000,
                2700.0,
                0.0,
                0.0,
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()

    response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "600010.SH",
            "side": "buy",
            "quantity": 100,
            "price": 2.5,
        },
    )

    assert response.status_code == 201
    holdings = client.get("/api/v1/portfolio/holdings").json()["items"]
    row = next(item for item in holdings if item["symbol"] == "600010.SH")
    assert row["cost"] == 2.5
    assert row["price"] == 2.7


def test_portfolio_buy_trade_uses_stock_metadata_for_symbol_without_exchange_suffix(client):
    from app.database import connect

    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (2000.0, 1))
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600012.SH",
                "皖通高速",
                "A",
                "沪深",
                "地方国企",
                "交通运输",
                180.0,
                12.0,
                3.0,
                1.2,
                0.0,
                10.0,
                8.8,
                11.2,
                "hold",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()

    response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "600012",
            "side": "buy",
            "quantity": 100,
            "price": 10,
        },
    )

    assert response.status_code == 201

    holdings = client.get("/api/v1/portfolio/holdings").json()["items"]
    row = next(item for item in holdings if item["symbol"] == "600012")
    assert row["name"] == "皖通高速"
    assert row["cost"] == 10


def test_portfolio_sell_trade_reduces_holding_and_adds_cash(client):
    from app.database import connect

    insert_test_holding()
    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (156000.0, 1))
        conn.commit()

    response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "AAPL",
            "side": "sell",
            "quantity": 100,
            "price": 180,
            "tradedAt": "2026-04-22T15:30:00+08:00",
        },
    )

    assert response.status_code == 201

    summary = client.get("/api/v1/portfolio/summary").json()
    assert summary["cash"] == 174000.0

    holdings = client.get("/api/v1/portfolio/holdings").json()["items"]
    row = next(item for item in holdings if item["symbol"] == "AAPL")
    assert row["quantity"] == 400
    assert row["cost"] == 145.2
    assert row["price"] == 180


def test_portfolio_sell_trade_keeps_remaining_holding_price_from_latest_market_price(client):
    from app.database import connect

    insert_test_holding(symbol="600010.SH", name="包钢股份", quantity=500, cost=2.2, price=2.6, sector="钢铁")
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume,
                amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600010.SH",
                "2026-04-22",
                2.65,
                2.7,
                2.72,
                2.63,
                1000,
                2700.0,
                0.0,
                0.0,
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()

    response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "600010.SH",
            "side": "sell",
            "quantity": 100,
            "price": 2.5,
        },
    )

    assert response.status_code == 201
    holdings = client.get("/api/v1/portfolio/holdings").json()["items"]
    row = next(item for item in holdings if item["symbol"] == "600010.SH")
    assert row["quantity"] == 400
    assert row["price"] == 2.7


def test_portfolio_dividend_trade_adds_cash_without_changing_holding(client):
    insert_test_holding()

    response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "AAPL",
            "side": "dividend",
            "quantity": 500,
            "price": 1.25,
            "tradedAt": "2026-04-22",
        },
    )

    assert response.status_code == 201
    assert response.json()["side"] == "dividend"
    assert response.json()["tradedAt"] == "2026-04-22"

    summary = client.get("/api/v1/portfolio/summary").json()
    assert summary["cash"] == 156625.0

    holdings = client.get("/api/v1/portfolio/holdings").json()["items"]
    row = next(item for item in holdings if item["symbol"] == "AAPL")
    assert row["quantity"] == 500
    assert row["cost"] == 145.2
    assert row["price"] == 173.5


def test_portfolio_rejects_sell_larger_than_position(client):
    insert_test_holding()

    response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "AAPL",
            "side": "sell",
            "quantity": 9999,
            "price": 180,
        },
    )

    assert response.status_code == 400
    assert "持仓不足" in response.json()["detail"]

    summary = client.get("/api/v1/portfolio/summary").json()
    assert summary["cash"] == 156000.0


def test_portfolio_allocation_is_computed_from_holdings_and_cash(client):
    insert_test_holding(symbol="AAPL", name="苹果公司", quantity=500, cost=145.2, price=173.5, sector="信息技术")
    insert_test_holding(symbol="MSFT", name="微软", quantity=300, cost=310.0, price=335.2, sector="信息技术")
    insert_test_holding(symbol="TSLA", name="特斯拉", quantity=150, cost=240.5, price=212.8, sector="可选消费")
    insert_test_holding(symbol="NVDA", name="英伟达", quantity=100, cost=280.0, price=450.0, sector="信息技术")

    response = client.get("/api/v1/portfolio/allocation")

    assert response.status_code == 200
    items = response.json()["items"]
    by_name = {item["name"]: item for item in items}
    assert by_name["信息技术"]["value"] == 55.28
    assert by_name["可选消费"]["value"] == 7.6
    assert by_name["现金"]["value"] == 37.12


def test_portfolio_report_exports_current_summary_and_holdings(client):
    insert_test_holding(symbol="AAPL", name="苹果公司", quantity=500, cost=145.2, price=173.5, sector="信息技术")
    insert_test_holding(symbol="MSFT", name="微软", quantity=300, cost=310.0, price=335.2, sector="信息技术")
    insert_test_holding(symbol="TSLA", name="特斯拉", quantity=150, cost=240.5, price=212.8, sector="可选消费")
    insert_test_holding(symbol="NVDA", name="英伟达", quantity=100, cost=280.0, price=450.0, sector="信息技术")

    response = client.get("/api/v1/portfolio/report?format=csv")

    assert response.status_code == 200
    body = response.text
    assert "section,name,value" in body
    assert "summary,totalAssets,420230.0" in body
    assert "holding,AAPL,500.0" in body
    assert "allocation,现金,37.12" in body


def test_portfolio_summary_computes_daily_pnl_from_latest_prices(client):
    insert_test_holding()

    from app.database import connect

    with connect() as conn:
        conn.executemany(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume,
                amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("AAPL", "2026-04-21", 169.0, 170.0, 171.0, 168.0, 1000, 170000.0, 0.0, 0.0, "2026-04-21T00:00:00+08:00"),
                ("AAPL", "2026-04-22", 172.0, 173.5, 174.0, 171.5, 1000, 173500.0, 2.06, 2.06, "2026-04-22T00:00:00+08:00"),
            ],
        )
        conn.commit()

    response = client.get("/api/v1/portfolio/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["dailyPnl"] == 1750.0
    assert payload["dailyPnlPct"] == 0.72


def test_portfolio_lists_created_trades(client):
    insert_test_holding()

    create_response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "AAPL",
            "side": "sell",
            "quantity": 10,
            "price": 180,
            "tradedAt": "2026-04-22",
            "note": "估值到达目标区间，减仓控制风险",
        },
    )
    trade_id = create_response.json()["id"]

    response = client.get("/api/v1/portfolio/trades")

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "id": trade_id,
            "portfolioId": 1,
            "symbol": "AAPL",
            "side": "sell",
            "quantity": 10.0,
            "price": 180.0,
            "totalAmount": 1800.0,
            "tradedAt": "2026-04-22",
            "note": "估值到达目标区间，减仓控制风险",
        }
    ]


def test_portfolio_updates_trade_and_recomputes_cash_and_holding(client):
    from app.database import connect

    with connect() as conn:
        conn.execute("UPDATE portfolios SET cash=? WHERE id=?", (5000.0, 1))
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "000001.SZ",
                "平安银行",
                "A",
                "沪深",
                "未知",
                "银行",
                1380.5,
                5.6,
                0.0,
                0.8,
                0.0,
                12.0,
                10.56,
                13.44,
                "buy",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.commit()

    create_response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "000001.SZ",
            "side": "buy",
            "quantity": 100,
            "price": 10,
        },
    )
    trade_id = create_response.json()["id"]

    response = client.patch(
        f"/api/v1/portfolio/trades/{trade_id}",
        json={
            "portfolioId": 1,
            "symbol": "000001.SZ",
            "side": "buy",
            "quantity": 200,
            "price": 11,
            "tradedAt": "2026-04-22T16:00:00+08:00",
            "note": "业绩修复，补仓观察",
        },
    )

    assert response.status_code == 200
    assert response.json()["quantity"] == 200
    assert response.json()["price"] == 11
    assert response.json()["note"] == "业绩修复，补仓观察"

    summary = client.get("/api/v1/portfolio/summary").json()
    assert summary["cash"] == 2800.0

    holdings = client.get("/api/v1/portfolio/holdings").json()["items"]
    row = next(item for item in holdings if item["symbol"] == "000001.SZ")
    assert row["quantity"] == 200
    assert row["cost"] == 11
    assert row["price"] == 11


def test_portfolio_deletes_trade_and_reverses_ledger_effect(client):
    insert_test_holding()

    create_response = client.post(
        "/api/v1/portfolio/trades",
        json={
            "portfolioId": 1,
            "symbol": "AAPL",
            "side": "sell",
            "quantity": 100,
            "price": 180,
        },
    )
    trade_id = create_response.json()["id"]

    delete_response = client.delete(f"/api/v1/portfolio/trades/{trade_id}")

    assert delete_response.status_code == 204

    summary = client.get("/api/v1/portfolio/summary").json()
    assert summary["cash"] == 156000.0

    trades = client.get("/api/v1/portfolio/trades").json()["items"]
    assert trades == []

    holdings = client.get("/api/v1/portfolio/holdings").json()["items"]
    row = next(item for item in holdings if item["symbol"] == "AAPL")
    assert row["quantity"] == 500


def test_settings_include_data_sync_summary(client, monkeypatch):
    from app.services import akshare_sync

    monkeypatch.setattr(akshare_sync, "fetch_akshare_rows", lambda _request, _progress_callback=None: AKSHARE_TEST_ROWS)
    client.post("/api/v1/data-sync/jobs", json={"source": "akshare"})

    response = client.get("/api/v1/settings")

    assert response.status_code == 200
    payload = response.json()
    assert payload["appearance"]["theme"] == "light"
    assert "llm" not in payload
    assert "llmModels" not in payload
    assert payload["dataSync"]["source"] == "akshare"
    assert payload["dataSync"]["lastStatus"] == "success"


def test_llm_settings_endpoints_are_removed(client):
    assert client.patch("/api/v1/settings/llm", json={"provider": "openai", "model": "gpt-4o"}).status_code == 404
    assert client.get("/api/v1/settings/llm/models").status_code == 404
    assert client.post("/api/v1/settings/llm/test").status_code == 404
    assert client.post("/api/v1/settings/llm/restart").status_code == 404


def test_reports_detail_includes_kline_data(client):
    list_response = client.get("/api/v1/reports")

    assert list_response.status_code == 200
    report_id = list_response.json()["items"][0]["id"]

    detail_response = client.get(f"/api/v1/reports/{report_id}")

    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["id"] == report_id
    assert detail["ticker"]
    assert detail["klineData"]


def test_create_report_supports_multiple_stocks_and_generated_klines(client):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "300001.SZ",
                "测试成长",
                "A",
                "创业板",
                "民营企业",
                "软件",
                100.0,
                20.0,
                0.5,
                2.0,
                10.0,
                10.0,
                8.8,
                11.2,
                "buy",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "600001.SH",
                "测试价值",
                "A",
                "主板",
                "央企",
                "制造",
                200.0,
                12.0,
                2.5,
                1.2,
                8.0,
                9.0,
                7.92,
                10.08,
                "hold",
                "2026-04-22T00:00:00+08:00",
            ),
        )
        conn.executemany(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume, amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("300001.SZ", "2026-04-20", 10.0, 10.5, 10.8, 9.9, 1000, None, None, None, "2026-04-22T00:00:00+08:00"),
                ("300001.SZ", "2026-04-22", 10.6, 12.0, 12.3, 10.5, 1200, None, None, None, "2026-04-22T00:00:00+08:00"),
                ("600001.SH", "2026-04-20", 20.0, 19.0, 20.2, 18.8, 2000, None, None, None, "2026-04-22T00:00:00+08:00"),
                ("600001.SH", "2026-04-22", 19.0, 18.0, 19.3, 17.9, 2200, None, None, None, "2026-04-22T00:00:00+08:00"),
            ],
        )
        conn.commit()

    create_response = client.post(
        "/api/v1/reports",
        json={
            "stocks": [
                {"symbol": "300001.SZ", "name": "测试成长"},
                {"symbol": "600001.SH", "name": "测试价值"},
            ],
            "rating": "buy",
            "institution": "测试券商",
            "date": "2026-04-20",
            "content": "多股票观点",
            "sourceUrl": "https://example.com/report",
            "sourceFileName": "report.pdf",
            "sourceFileMime": "application/pdf",
            "sourceFileContent": "JVBERi0xLjQK",
        },
    )

    assert create_response.status_code == 201
    report_id = create_response.json()["id"]

    list_response = client.get("/api/v1/reports?institution=测试券商")
    assert list_response.status_code == 200
    item = list_response.json()["items"][0]
    assert [stock["symbol"] for stock in item["stocks"]] == ["300001.SZ", "600001.SH"]
    assert [stock["verdict"] for stock in item["stocks"]] == ["flat", "flat"]

    detail_response = client.get(f"/api/v1/reports/{report_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["ticker"] == "300001.SZ"
    assert len(detail["klineSeries"]) == 2
    assert detail["klineSeries"][0]["changePct"] == 14.29
    assert detail["klineSeries"][1]["changePct"] == -5.26

    update_response = client.patch(
        f"/api/v1/reports/{report_id}",
        json={
            "title": "更新后的多股票观点",
            "rating": "hold",
            "date": "2026-04-22",
            "content": "更新后的正文",
        },
    )
    assert update_response.status_code == 200
    updated_report = update_response.json()
    assert updated_report["title"] == "更新后的多股票观点"
    assert updated_report["rating"] == "hold"
    assert updated_report["date"] == "2026-04-22"
    assert updated_report["content"] == "更新后的正文"

    content_search_response = client.get("/api/v1/reports?q=更新后的正文")
    assert content_search_response.status_code == 200
    assert any(item["id"] == report_id for item in content_search_response.json()["items"])

    verdict_response = client.patch(
        f"/api/v1/reports/{report_id}/stocks/600001.SH/verdict",
        json={"verdict": "loss"},
    )
    assert verdict_response.status_code == 200
    assert verdict_response.json()["verdict"] == "loss"
    win_response = client.patch(
        f"/api/v1/reports/{report_id}/stocks/300001.SZ/verdict",
        json={"verdict": "win"},
    )
    assert win_response.status_code == 200

    updated_detail = client.get(f"/api/v1/reports/{report_id}").json()
    verdict_by_symbol = {stock["symbol"]: stock["verdict"] for stock in updated_detail["stocks"]}
    assert verdict_by_symbol["300001.SZ"] == "win"
    assert verdict_by_symbol["600001.SH"] == "loss"

    ranking_response = client.get("/api/v1/reports?institution=测试券商")
    assert ranking_response.status_code == 200
    rankings = ranking_response.json()["institutionRankings"]
    ranking = next(item for item in rankings if item["institution"] == "测试券商")
    assert len(rankings) > 1
    assert ranking["institution"] == "测试券商"
    assert ranking["reportCount"] == 1
    assert ranking["stockMentions"] == 2
    assert ranking["wins"] == 1
    assert ranking["winRate"] == 50.0

    file_response = client.get(f"/api/v1/reports/{report_id}/file")
    assert file_response.status_code == 200
    assert file_response.content == b"%PDF-1.4\n"


def test_report_kline_uses_latest_trade_date_when_report_date_is_newer(client):
    from app.database import connect

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO stock_fundamentals (
                symbol, name, market, exchange, ownership, sector,
                market_cap, pe_ttm, dividend_yield, pb, roe,
                ma120, ma120_lower, ma120_upper, signal, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "000001.SZ",
                "平安银行",
                "A",
                "沪深",
                "未知",
                "银行",
                1380.5,
                5.6,
                0.0,
                0.8,
                0.0,
                12.0,
                10.56,
                13.44,
                "buy",
                "2026-04-30T00:00:00+08:00",
            ),
        )
        conn.executemany(
            """
            INSERT INTO stock_daily_prices (
                symbol, trade_date, open, close, high, low, volume, amount, change, pct_change, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("000001.SZ", "2026-04-29", 11.4, 11.52, 11.54, 11.39, 1000, None, None, None, "2026-04-30T00:00:00+08:00"),
                ("000001.SZ", "2026-04-30", 11.5, 11.49, 11.6, 11.46, 1200, None, None, None, "2026-04-30T00:00:00+08:00"),
            ],
        )
        conn.commit()

    create_response = client.post(
        "/api/v1/reports",
        json={
            "stocks": [{"symbol": "000001.SZ", "name": "平安银行"}],
            "rating": "buy",
            "institution": "测试券商",
            "date": "2026-05-04",
            "content": "研报日期晚于最新交易日",
        },
    )

    assert create_response.status_code == 201
    detail = client.get(f"/api/v1/reports/{create_response.json()['id']}").json()
    assert [point["date"] for point in detail["klineSeries"][0]["klineData"]] == ["2026-04-30"]
    assert detail["klineSeries"][0]["latestClose"] is None
    assert detail["klineData"][0]["close"] == 11.49
