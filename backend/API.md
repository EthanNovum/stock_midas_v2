# Midas 后端 API 接口文档

技术栈约束：FastAPI + sqlite3 + Pydantic。

本文档根据当前 React 前端页面整理接口，目标是让前端接入后端真实数据源。

## 1. 通用约定

### 1.1 基础信息

- Base URL：`/api/v1`
- Content-Type：`application/json; charset=utf-8`
- 时间格式：ISO 8601，例如 `2026-04-22T15:30:00+08:00`
- 日期格式：`YYYY-MM-DD`
- 金额和价格字段：接口使用 number；sqlite3 可用 `REAL` 或以最小货币单位存储为 `INTEGER`
- 涨跌颜色由前端决定：中国市场中上涨为红色、下跌为绿色

### 1.2 分页响应

```json
{
  "items": [],
  "page": 1,
  "page_size": 20,
  "total": 42
}
```

### 1.3 错误响应

```json
{
  "detail": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不合法",
    "fields": {
      "page_size": "不能大于 100"
    }
  }
}
```

常用状态码：

- `200 OK`：查询成功
- `201 Created`：创建成功
- `202 Accepted`：异步任务已提交
- `204 No Content`：删除成功
- `400 Bad Request`：参数错误
- `404 Not Found`：资源不存在
- `409 Conflict`：重复添加或状态冲突
- `422 Unprocessable Entity`：Pydantic 校验失败
- `500 Internal Server Error`：服务端错误

## 2. 核心 Pydantic 模型

```python
from datetime import date, datetime
from enum import Enum
from pydantic import BaseModel, Field


class Rating(str, Enum):
    buy = "buy"
    hold = "hold"
    sell = "sell"


class TradeSignal(str, Enum):
    buy = "buy"
    sell = "sell"
    hold = "hold"


class DataSyncStatus(str, Enum):
    queued = "queued"
    running = "running"
    success = "success"
    failed = "failed"


class DataSyncScope(str, Enum):
    stock_basic = "stock_basic"
    daily_prices = "daily_prices"
    fundamentals = "fundamentals"


class DataSyncUpdateMode(str, Enum):
    full = "full"
    price_only = "price_only"


class PricePoint(BaseModel):
    date: str
    open: float | None = None
    close: float
    high: float | None = None
    low: float | None = None
    volume: int | None = None


class StockQuote(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    pct_change: float = Field(alias="pctChange")
    volume: str | None = None
    market_cap: str | None = Field(default=None, alias="marketCap")
    pe: float | None = None
    dividend: float | None = None
    sector: str | None = None
    trend: list[float] = []


class ScreenerResult(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    market_cap: str = Field(alias="marketCap")
    pe: float | None = None
    initial: str
    ma120: float
    ma120_lower: float = Field(alias="ma120Lower")
    ma120_upper: float = Field(alias="ma120Upper")
    signal: TradeSignal


class NewsItem(BaseModel):
    id: str
    category: str
    timestamp: str
    title: str
    summary: str


class ResearchReport(BaseModel):
    id: str
    title: str
    ticker: str
    ticker_name: str = Field(alias="tickerName")
    rating: Rating
    institution: str
    date: date
    content: str
    kline_data: list[PricePoint] = Field(default_factory=list, alias="klineData")


class DataSyncJobCreate(BaseModel):
    source: str = "akshare"
    scopes: list[DataSyncScope] = Field(
        default_factory=lambda: [DataSyncScope.stock_basic, DataSyncScope.daily_prices, DataSyncScope.fundamentals]
    )
    markets: list[str] = Field(default_factory=lambda: ["A"])
    symbols: list[str] | None = None
    trade_date: date | None = Field(default=None, alias="tradeDate")
    full_refresh: bool = Field(default=False, alias="fullRefresh")
    limit: int = Field(default=300, ge=1, le=10000)
    update_mode: DataSyncUpdateMode = Field(default=DataSyncUpdateMode.full, alias="updateMode")


class DataSyncJob(BaseModel):
    job_id: str = Field(alias="jobId")
    source: str
    status: DataSyncStatus
    scopes: list[DataSyncScope]
    markets: list[str]
    limit: int
    update_mode: DataSyncUpdateMode = Field(alias="updateMode")
    total_tasks: int = Field(alias="totalTasks")
    completed_tasks: int = Field(alias="completedTasks")
    progress_percent: int = Field(alias="progressPercent")
    started_at: datetime | None = Field(default=None, alias="startedAt")
    finished_at: datetime | None = Field(default=None, alias="finishedAt")
    updated_rows: int = Field(default=0, alias="updatedRows")
    failed_rows: int = Field(default=0, alias="failedRows")
    message: str | None = None
```

FastAPI 返回前端字段时建议使用：

```python
model.model_dump(by_alias=True)
```

## 3. SQLite 表设计建议

### 3.1 market_quotes

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| symbol | TEXT UNIQUE NOT NULL | 证券代码 |
| name | TEXT NOT NULL | 名称 |
| market | TEXT | 市场，例如 `A`, `HK`, `US`, `INDEX` |
| price | REAL NOT NULL | 最新价 |
| change | REAL NOT NULL | 涨跌额或涨跌值 |
| pct_change | REAL NOT NULL | 涨跌幅百分比 |
| volume | TEXT | 展示用成交量 |
| market_cap | TEXT | 展示用市值 |
| pe | REAL | 市盈率 |
| dividend | REAL | 股息率 |
| sector | TEXT | 行业 |
| updated_at | TEXT NOT NULL | 更新时间 |

### 3.2 quote_trends

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| symbol | TEXT NOT NULL | 证券代码 |
| point_index | INTEGER NOT NULL | 趋势序号 |
| value | REAL NOT NULL | 趋势点 |

### 3.3 news

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PRIMARY KEY | 新闻 ID |
| category | TEXT NOT NULL | 分类 |
| title | TEXT NOT NULL | 标题 |
| summary | TEXT NOT NULL | 摘要 |
| published_at | TEXT NOT NULL | 发布时间 |

### 3.4 watchlists 与 watchlist_items

`watchlists`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| name | TEXT NOT NULL | 分组名称 |
| group_type | TEXT NOT NULL | `sector`、`institution`、`custom` |
| created_at | TEXT NOT NULL | 创建时间 |

`watchlist_items`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| watchlist_id | INTEGER NOT NULL | 分组 ID |
| symbol | TEXT NOT NULL | 证券代码 |
| note | TEXT | 备注 |
| created_at | TEXT NOT NULL | 添加时间 |

### 3.5 portfolios、holdings、trades

`portfolios`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| name | TEXT NOT NULL | 组合名称 |
| cash | REAL NOT NULL | 可用现金 |
| created_at | TEXT NOT NULL | 创建时间 |

`holdings`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| portfolio_id | INTEGER NOT NULL | 组合 ID |
| symbol | TEXT NOT NULL | 证券代码 |
| name | TEXT NOT NULL | 名称 |
| quantity | REAL NOT NULL | 持仓数量 |
| cost | REAL NOT NULL | 平均成本 |
| price | REAL NOT NULL | 当前价 |
| sector | TEXT | 行业 |

`trades`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| portfolio_id | INTEGER NOT NULL | 组合 ID |
| symbol | TEXT NOT NULL | 证券代码 |
| side | TEXT NOT NULL | `buy` 或 `sell` |
| quantity | REAL NOT NULL | 数量 |
| price | REAL NOT NULL | 成交价 |
| traded_at | TEXT NOT NULL | 成交时间 |

### 3.6 research_reports 与 report_klines

`research_reports`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PRIMARY KEY | 研报 ID |
| title | TEXT NOT NULL | 标题 |
| ticker | TEXT NOT NULL | 股票代码 |
| ticker_name | TEXT NOT NULL | 股票名称 |
| rating | TEXT NOT NULL | `buy`、`hold`、`sell` |
| institution | TEXT NOT NULL | 机构 |
| report_date | TEXT NOT NULL | 发布日期 |
| content | TEXT NOT NULL | 核心观点 |
| created_at | TEXT NOT NULL | 创建时间 |

`report_klines`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| report_id | TEXT NOT NULL | 研报 ID |
| date | TEXT NOT NULL | 行情日期 |
| open | REAL NOT NULL | 开盘价 |
| close | REAL NOT NULL | 收盘价 |
| high | REAL NOT NULL | 最高价 |
| low | REAL NOT NULL | 最低价 |
| volume | INTEGER NOT NULL | 成交量 |

### 3.7 user_settings

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| theme | TEXT NOT NULL | `light`、`dark`、`system` |
| provider | TEXT NOT NULL | `openai`、`gemini`、`anthropic`、`deepseek` |
| model | TEXT NOT NULL | 模型 ID |
| api_key_ciphertext | TEXT | 加密后的 API Key |
| updated_at | TEXT NOT NULL | 更新时间 |

### 3.8 data_sync_jobs

记录设置页触发的 AkShare 同步任务。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PRIMARY KEY | 任务 ID |
| source | TEXT NOT NULL | 数据源，固定为 `akshare` |
| status | TEXT NOT NULL | `queued`、`running`、`success`、`failed` |
| scopes_json | TEXT NOT NULL | 同步范围 JSON |
| markets_json | TEXT NOT NULL | 市场范围 JSON |
| symbols_json | TEXT | 指定股票代码 JSON；为空表示全量范围 |
| trade_date | TEXT | 指定交易日 |
| full_refresh | INTEGER NOT NULL | 是否全量刷新 |
| limit_value | INTEGER NOT NULL DEFAULT 300 | 本次最多处理的股票任务数 |
| update_mode | TEXT NOT NULL DEFAULT 'full' | `full` 或 `price_only` |
| total_tasks | INTEGER NOT NULL DEFAULT 0 | 本次任务总数 |
| completed_tasks | INTEGER NOT NULL DEFAULT 0 | 已处理任务数 |
| updated_rows | INTEGER NOT NULL DEFAULT 0 | 已写入或更新记录数 |
| failed_rows | INTEGER NOT NULL DEFAULT 0 | 失败记录数 |
| message | TEXT | 状态说明或错误摘要 |
| started_at | TEXT | 开始时间 |
| finished_at | TEXT | 完成时间 |
| created_at | TEXT NOT NULL | 创建时间 |

### 3.9 stock_fundamentals

供高级选股器使用的股票基础信息和基本面指标。由 AkShare 同步任务写入；系统启动时不再写入选股器 mock 股票。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| symbol | TEXT PRIMARY KEY | 证券代码，例如 `600519.SH` |
| name | TEXT NOT NULL | 股票简称 |
| market | TEXT NOT NULL | 市场，例如 `A` |
| exchange | TEXT | 交易所或板块，例如 `沪深`、`创业板`、`北交所` |
| ownership | TEXT | 公司性质，例如 `央企`、`地方国企`、`民企` |
| sector | TEXT | 行业 |
| market_cap | REAL | 市值，单位亿元 |
| pe_ttm | REAL | 市盈率 TTM |
| dividend_yield | REAL | 股息率 |
| pb | REAL | 市净率 |
| roe | REAL | 净资产收益率 |
| ma120 | REAL | 120 日均线 |
| ma120_lower | REAL | `ma120 * 0.88` |
| ma120_upper | REAL | `ma120 * 1.12` |
| signal | TEXT | `buy`、`sell`、`hold` |
| updated_at | TEXT NOT NULL | 数据更新时间 |

### 3.10 stock_daily_prices

供选股器、图表和行情卡片使用的日线行情。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY | 自增 ID |
| symbol | TEXT NOT NULL | 证券代码 |
| trade_date | TEXT NOT NULL | 交易日 |
| open | REAL NOT NULL | 开盘价 |
| close | REAL NOT NULL | 收盘价 |
| high | REAL | 最高价 |
| low | REAL | 最低价 |
| volume | INTEGER | 成交量 |
| amount | REAL | 成交额 |
| change | REAL | 涨跌额 |
| pct_change | REAL | 涨跌幅百分比 |
| updated_at | TEXT NOT NULL | 数据更新时间 |

建议唯一索引：`UNIQUE(symbol, trade_date)`。

## 4. 接口清单

### 4.1 健康检查

#### GET `/api/v1/health`

用于前端或部署平台检查服务状态。

响应：

```json
{
  "status": "ok",
  "database": "ok",
  "time": "2026-04-22T15:30:00+08:00"
}
```

### 4.2 全局搜索

#### GET `/api/v1/search`

顶部搜索框使用，搜索代码、股票名称、研报。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| q | string | 是 | 搜索关键词 |
| limit | int | 否 | 默认 10，最大 50 |

响应：

```json
{
  "items": [
    {
      "type": "stock",
      "id": "300750.SZ",
      "title": "宁德时代",
      "subtitle": "300750.SZ · 锂电池",
      "latestPrice": 182.45,
      "latestTradeDate": "2026-04-22"
    },
    {
      "type": "report",
      "id": "1",
      "title": "宁德时代：全球锂电龙头地位稳固，Q3业绩超预期",
      "subtitle": "中信证券 · 2024-03-15"
    }
  ]
}
```

### 4.3 市场概览

#### GET `/api/v1/market/status`

响应：

```json
{
  "status": "open",
  "label": "开盘",
  "lastUpdated": "2026-04-22T15:30:00+08:00"
}
```

#### GET `/api/v1/market/indices`

获取仪表盘顶部 A 股主要指数卡片。后端实时调用 AkShare 获取指数现价和近 7 个交易日收盘趋势，不再读取本地 `quote_trends` 或固定模拟值。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| market | string | 否 | 默认 `cn`，当前返回上证指数、深证成指、创业板指 |

响应：

```json
{
  "items": [
    {
      "symbol": "SSEC",
      "name": "上证指数",
      "price": 4085.08,
      "change": 2.95,
      "pctChange": 0.07,
      "trend": [3988.56, 3984.45, 3972.03, 4050.06, 4070.53, 4082.12, 4085.08]
    }
  ]
}
```

#### GET `/api/v1/market/movers`

获取涨幅榜、跌幅榜。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| direction | string | 是 | `gainers` 或 `losers` |
| limit | int | 否 | 默认 10 |

响应：

```json
{
  "items": [
    {
      "symbol": "300750.SZ",
      "name": "宁德时代",
      "pctChange": 4.52
    }
  ]
}
```

### 4.4 市场资讯

#### GET `/api/v1/news`

获取仪表盘市场资讯。后端实时调用 AkShare 财经资讯接口，不再读取本地 `news` 表中的初始化模拟新闻。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| category | string | 否 | 新闻分类 |
| limit | int | 否 | 默认 10 |

响应：

```json
{
  "items": [
    {
      "id": "akshare-0",
      "category": "快讯",
      "timestamp": "2026-04-22 12:45:00",
      "title": "真实财经快讯标题",
      "summary": "来自 AkShare 的财经资讯摘要。"
    }
  ]
}
```

### 4.5 自选股

#### GET `/api/v1/watchlists`

获取自选股分组，支持前端的“按行业 / 按机构 / 平铺”视图。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| group_by | string | 否 | `sector`、`institution`、`flat`，默认 `sector` |

响应：

```json
{
  "groups": [
    {
      "id": "sector-my-list",
      "name": "我的自选",
      "stocks": [
        {
          "id": "300750",
          "symbol": "300750.SZ",
          "name": "宁德时代",
          "sector": "锂电池",
          "price": 182.45,
          "vol": "12.4M",
          "pct": 2.34
        }
      ]
    }
  ]
}
```

#### POST `/api/v1/watchlists`

创建自选分组。

请求：

```json
{
  "name": "我的自选",
  "groupType": "sector"
}
```

响应：`201 Created`

```json
{
  "id": "sector-my-list",
  "name": "我的自选",
  "groupType": "sector"
}
```

#### POST `/api/v1/watchlists/{watchlist_id}/stocks`

向自选分组添加标的。

请求：

```json
{
  "symbol": "300750.SZ",
  "note": "用户手动添加"
}
```

响应：`201 Created`

```json
{
  "id": 1,
  "watchlistId": "sector-my-list",
  "symbol": "300750.SZ"
}
```

#### DELETE `/api/v1/watchlists/{watchlist_id}/stocks/{symbol}`

从自选分组移除标的。

响应：`204 No Content`

### 4.6 高级选股器

#### GET `/api/v1/screener/options`

获取筛选器可选项和默认约束。

响应：

```json
{
  "numericFilters": [
    {"key": "pe", "label": "市盈率 (PE) <", "operator": "lt", "defaultValue": 15},
    {"key": "dividend", "label": "股息率 (%) >", "operator": "gt", "defaultValue": 3.5},
    {"key": "marketCap", "label": "市值 (亿 ¥) >", "operator": "gt", "defaultValue": 500}
  ],
  "ownership": ["央企", "地方国企", "民企"],
  "exchanges": ["沪深", "创业板", "北交所"]
}
```

#### POST `/api/v1/screener/query`

运行筛选。

选股器数据来自 `stock_fundamentals` 和 `stock_daily_prices`。新数据库在执行 AkShare 同步前会返回空列表，前端应提示用户先到设置页更新选股器数据。

选股器响应必须包含 MA120 相关字段和买入/卖出信号：

- `ma120`：最近 120 个交易日收盘价均值
- `ma120Lower`：`ma120 * 0.88`
- `ma120Upper`：`ma120 * 1.12`
- `signal`：当 `price < ma120Lower` 时为 `buy`；当 `price > ma120Upper` 时为 `sell`；否则为 `hold`

请求：

```json
{
  "filters": {},
  "ownership": [],
  "exchanges": [],
  "page": 1,
  "pageSize": 20,
  "sort": {"field": "marketCap", "direction": "desc"}
}
```

响应：

```json
{
  "items": [
    {
      "symbol": "600519.SH",
      "name": "贵州茅台",
      "price": 1688.0,
      "change": 1.24,
      "marketCap": "21,200.5",
      "pe": 28.4,
      "initial": "M",
      "ma120": 1500.0,
      "ma120Lower": 1320.0,
      "ma120Upper": 1680.0,
      "signal": "sell"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 42
}
```

#### GET `/api/v1/screener/export`

导出当前筛选结果。

查询参数同筛选条件，响应为文件流：

- Content-Type：`text/csv` 或 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition：`attachment; filename="screener-results.csv"`

### 4.7 投资组合

#### GET `/api/v1/portfolio/summary`

获取投资组合顶部统计卡片。

响应：

```json
{
  "portfolioId": 1,
  "asOf": "2026-04-22T15:30:00+08:00",
  "totalAssets": 1245670.5,
  "ytdPct": 12.4,
  "dailyPnl": 8432.0,
  "dailyPnlPct": 0.68,
  "cash": 156000.0,
  "cashPct": 12.5
}
```

#### GET `/api/v1/portfolio/holdings`

响应：

```json
{
  "items": [
    {
      "symbol": "AAPL",
      "name": "苹果公司",
      "quantity": 500,
      "cost": 145.2,
      "price": 173.5,
      "profit": 14150.0,
      "pct": 19.49
    }
  ]
}
```

#### GET `/api/v1/portfolio/allocation`

响应：

```json
{
  "items": [
    {"name": "信息技术", "value": 45, "color": "#00343e"},
    {"name": "可选消费", "value": 25, "color": "#004c59"}
  ]
}
```

#### POST `/api/v1/portfolio/trades`

新建交易。

请求：

```json
{
  "portfolioId": 1,
  "symbol": "300750.SZ",
  "side": "buy",
  "quantity": 100,
  "price": 182.45,
  "tradedAt": "2026-04-22"
}
```

`side` 支持 `buy`、`sell`、`dividend`。`dividend` 按 `quantity * price` 增加组合现金，不改变持仓数量或成本。`tradedAt` 只记录交易日期，格式为 `YYYY-MM-DD`。

响应：`201 Created`

```json
{
  "id": 1001,
  "portfolioId": 1,
  "symbol": "300750.SZ",
  "side": "buy",
  "quantity": 100,
  "price": 182.45,
  "tradedAt": "2026-04-22"
}
```

#### GET `/api/v1/portfolio/report`

下载投资组合报告。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| format | string | 否 | `pdf`、`csv`，默认 `pdf` |

响应为文件流。

### 4.8 研究报告

#### GET `/api/v1/reports`

获取研报列表，支持搜索和筛选。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| q | string | 否 | 搜索研报、机构或代码 |
| rating | string | 否 | `buy`、`hold`、`sell` |
| institution | string | 否 | 机构名称 |
| ticker | string | 否 | 股票代码 |
| page | int | 否 | 默认 1 |
| page_size | int | 否 | 默认 20，最大 100 |

响应：

```json
{
  "items": [
    {
      "id": "1",
      "title": "宁德时代：全球锂电龙头地位稳固，Q3业绩超预期",
      "ticker": "300750.SZ",
      "tickerName": "宁德时代",
      "rating": "buy",
      "institution": "中信证券",
      "date": "2024-03-15"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 3
}
```

#### GET `/api/v1/reports/{report_id}`

获取研报详情和自发布日起行情走势。

响应：

```json
{
  "id": "1",
  "title": "宁德时代：全球锂电龙头地位稳固，Q3业绩超预期",
  "ticker": "300750.SZ",
  "tickerName": "宁德时代",
  "rating": "buy",
  "institution": "中信证券",
  "date": "2024-03-15",
  "content": "宁德时代在2024年第一季度的全球市场份额进一步扩大...",
  "klineData": [
    {"date": "03-15", "open": 175.2, "close": 180.5, "high": 182.1, "low": 174.8, "volume": 12000}
  ]
}
```

#### POST `/api/v1/reports`

创建或导入研报。

请求：

```json
{
  "title": "宁德时代：全球锂电龙头地位稳固",
  "ticker": "300750.SZ",
  "tickerName": "宁德时代",
  "rating": "buy",
  "institution": "中信证券",
  "date": "2024-03-15",
  "content": "核心观点..."
}
```

响应：`201 Created`

```json
{
  "id": "1"
}
```

### 4.9 设置

#### GET `/api/v1/settings`

获取用户外观和 LLM 配置。API Key 永远不明文返回。

响应：

```json
{
  "appearance": {
    "theme": "light"
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o",
    "hasApiKey": true,
    "clusterStatus": "normal",
    "latencyMs": 1.2
  },
  "dataSync": {
    "source": "akshare",
    "lastJobId": "sync-20260422-153000",
    "lastStatus": "success",
    "lastSyncAt": "2026-04-22T15:30:00+08:00",
    "updatedRows": 3820,
    "failedRows": 0
  }
}
```

#### PATCH `/api/v1/settings/appearance`

请求：

```json
{
  "theme": "system"
}
```

响应：

```json
{
  "theme": "system"
}
```

#### PATCH `/api/v1/settings/llm`

保存 LLM 供应商、模型和 API Key。`apiKey` 为可选字段；未传时保留旧密钥。

请求：

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "apiKey": "sk-..."
}
```

响应：

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "hasApiKey": true
}
```

#### POST `/api/v1/settings/llm/test`

测试当前 LLM 配置是否可用。

响应：

```json
{
  "ok": true,
  "latencyMs": 312.4,
  "message": "连接正常"
}
```

#### POST `/api/v1/settings/llm/restart`

对应前端“保存并重启集群”按钮。

响应：

```json
{
  "status": "restarted",
  "clusterStatus": "normal",
  "latencyMs": 1.2
}
```

### 4.10 数据同步

设置页“更新选股器数据”按钮使用。后端通过 AkShare 获取 A 股股票基础信息、基本面指标和日线行情，并写入 sqlite3，供 `POST /api/v1/screener/query` 查询。

推荐后端行为：

- `POST /api/v1/data-sync/jobs` 只提交任务并立即返回，不在 HTTP 请求中同步等待爬取完成
- 同一时间只允许一个 `queued` 或 `running` 任务；重复提交返回 `409 Conflict` 或返回当前任务
- 后端直接调用 AkShare，不使用本地静态兜底数据；AkShare 采集失败时任务状态为 `failed`，并在 `failedRows` 和 `message` 中记录错误
- 当东方财富快照或日线接口断开连接时，后端会改用 AkShare 的 A 股代码列表与腾讯/新浪日线行情接口继续采集真实数据
- 前端确认参数后提交任务，并提示用户等待约 10 秒；随后通过任务状态接口返回 `totalTasks`、`completedTasks` 和 `progressPercent`
- `updateMode=full` 执行全量更新；`updateMode=price_only` 仅刷新已有股票的最新价格和信号，保留原有 MA120
- 前端使用“刷新进度”按钮手动读取任务进展，不做持续轮询
- `stock_fundamentals` 和 `stock_daily_prices` 使用 upsert，避免重复写入
- 每只股票完成日线更新后计算 `ma120`、`ma120Lower`、`ma120Upper` 和 `signal`，写回 `stock_fundamentals`

#### POST `/api/v1/data-sync/jobs`

提交 AkShare 数据同步任务。

请求：

```json
{
  "source": "akshare",
  "scopes": ["stock_basic", "daily_prices", "fundamentals"],
  "markets": ["A"],
  "symbols": null,
  "tradeDate": null,
  "fullRefresh": true,
  "limit": 300,
  "updateMode": "full"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| source | string | 否 | 固定 `akshare` |
| scopes | string[] | 否 | `stock_basic`、`daily_prices`、`fundamentals` |
| markets | string[] | 否 | 当前建议只支持 `A` |
| symbols | string[] \| null | 否 | 指定股票代码；为空表示按市场同步 |
| tradeDate | string \| null | 否 | 指定交易日；为空表示最近交易日 |
| fullRefresh | bool | 否 | 是否全量刷新历史数据 |
| limit | number | 否 | 本次最多处理的股票数量，默认 `300` |
| updateMode | string | 否 | `full` 为全量更新；`price_only` 为仅更新现价 |

响应：`202 Accepted`

```json
{
  "jobId": "sync-20260422-153000",
  "source": "akshare",
  "status": "queued",
  "scopes": ["stock_basic", "daily_prices", "fundamentals"],
  "markets": ["A"],
  "limit": 300,
  "updateMode": "full",
  "totalTasks": 300,
  "completedTasks": 0,
  "progressPercent": 0,
  "startedAt": null,
  "finishedAt": null,
  "updatedRows": 0,
  "failedRows": 0,
  "message": "AkShare 数据同步任务已提交"
}
```

#### GET `/api/v1/data-sync/jobs/latest`

获取最近一次同步任务。设置页初始化时可用。

响应：

```json
{
  "jobId": "sync-20260422-153000",
  "source": "akshare",
  "status": "success",
  "scopes": ["stock_basic", "daily_prices", "fundamentals"],
  "markets": ["A"],
  "limit": 300,
  "updateMode": "full",
  "totalTasks": 300,
  "completedTasks": 300,
  "progressPercent": 100,
  "startedAt": "2026-04-22T15:30:00+08:00",
  "finishedAt": "2026-04-22T15:34:12+08:00",
  "updatedRows": 3820,
  "failedRows": 0,
  "message": "真实行情数据更新完成，共写入 3820 条记录"
}
```

失败响应示例：

```json
{
  "jobId": "sync-20260422-153000",
  "source": "akshare",
  "status": "failed",
  "scopes": ["stock_basic", "daily_prices", "fundamentals"],
  "markets": ["A"],
  "limit": 300,
  "updateMode": "full",
  "totalTasks": 300,
  "completedTasks": 0,
  "progressPercent": 0,
  "startedAt": "2026-04-22T15:30:00+08:00",
  "finishedAt": "2026-04-22T15:30:08+08:00",
  "updatedRows": 0,
  "failedRows": 1,
  "message": "数据更新失败: AkShare 实时行情接口返回空数据"
}
```

#### GET `/api/v1/data-sync/jobs/{job_id}`

轮询任务状态。

响应：

```json
{
  "jobId": "sync-20260422-153000",
  "source": "akshare",
  "status": "running",
  "scopes": ["stock_basic", "daily_prices", "fundamentals"],
  "markets": ["A"],
  "limit": 300,
  "updateMode": "full",
  "totalTasks": 300,
  "completedTasks": 168,
  "progressPercent": 56,
  "startedAt": "2026-04-22T15:30:00+08:00",
  "finishedAt": null,
  "updatedRows": 1240,
  "failedRows": 0,
  "message": "正在更新日线行情"
}
```

#### GET `/api/v1/data-sync/datasets`

查看当前选股器数据集状态。

响应：

```json
{
  "items": [
    {
      "scope": "stock_basic",
      "rows": 5300,
      "updatedAt": "2026-04-22T15:31:00+08:00"
    },
    {
      "scope": "daily_prices",
      "rows": 1250000,
      "updatedAt": "2026-04-22T15:34:12+08:00"
    },
    {
      "scope": "fundamentals",
      "rows": 5300,
      "updatedAt": "2026-04-22T15:33:20+08:00"
    }
  ]
}
```

### 4.11 通知

#### GET `/api/v1/notifications`

用于顶部铃铛。

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| unread_only | bool | 否 | 是否只返回未读通知 |

响应：

```json
{
  "unreadCount": 1,
  "items": [
    {
      "id": "n-1",
      "title": "市场数据已更新",
      "body": "A 股行情数据已同步至 15:30",
      "read": false,
      "createdAt": "2026-04-22T15:30:00+08:00"
    }
  ]
}
```

#### PATCH `/api/v1/notifications/{notification_id}/read`

标记通知已读。

响应：

```json
{
  "id": "n-1",
  "read": true
}
```

## 5. 后端实现建议

推荐目录结构：

```text
backend/
  API.md
  app/
    main.py
    database.py
    schemas.py
    repositories/
      market.py
      portfolio.py
      reports.py
      settings.py
      watchlists.py
      data_sync.py
    routers/
      health.py
      market.py
      news.py
      portfolio.py
      reports.py
      screener.py
      settings.py
      watchlists.py
      data_sync.py
    services/
      akshare_sync.py
  data/
    midas.sqlite3
```

FastAPI 路由建议：

- `app/main.py` 负责创建 `FastAPI()`、注册 CORS、注册 `/api/v1` 路由
- `app/database.py` 封装 sqlite3 连接，启用 `row_factory = sqlite3.Row`
- `app/schemas.py` 存放 Pydantic 入参和响应模型
- `repositories/*` 只做 SQL 读写，不放 HTTP 逻辑
- `routers/*` 只处理请求参数、调用 repository、返回 Pydantic 模型
- `services/akshare_sync.py` 负责调用 AkShare、清洗字段、批量 upsert 到 sqlite3
- `services/market_data.py` 负责调用 AkShare 获取仪表盘指数和财经资讯

## 6. 前端替换 mock data 的对应关系

| 前端页面 | 当前 mock 数据 | 后端接口 |
| --- | --- | --- |
| `Dashboard.tsx` 指数卡片 | 已移除本地静态数组；后端使用 AkShare 实时指数 | `GET /market/indices` |
| `Dashboard.tsx` 自选摘要 | 已移除本地静态数组；仅展示用户自选中能匹配到同步行情的股票 | `GET /watchlists?group_by=flat` |
| `Dashboard.tsx` 新闻 | 已移除本地静态数组；后端使用 AkShare 实时财经资讯 | `GET /news` |
| `Screener.tsx` 筛选选项 | 页面内数组 | `GET /screener/options` |
| `Screener.tsx` 筛选结果 | 已移除本地静态数组 | `POST /screener/query`，数据来自 AkShare 同步后的 `stock_fundamentals` 和 `stock_daily_prices` |
| `Portfolio.tsx` 顶部资产卡片 | 静态 JSX | `GET /portfolio/summary` |
| `Portfolio.tsx` 持仓表 | `holdings` | `GET /portfolio/holdings` |
| `Portfolio.tsx` 资产配置 | `allocationData` | `GET /portfolio/allocation` |
| `Watchlist.tsx` 自选分组 | `watchListData` | `GET /watchlists` |
| `Reports.tsx` 研报列表和详情 | `mockReports` | `GET /reports`、`GET /reports/{id}` |
| `Settings.tsx` 外观和 LLM 配置 | React state | `GET /settings`、`PATCH /settings/*` |
| `Settings.tsx` 数据更新按钮 | React state | `POST /api/v1/data-sync/jobs`、`GET /api/v1/data-sync/jobs/{id}` |
