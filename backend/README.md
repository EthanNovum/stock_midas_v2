# Midas Backend

Midas 股票研究终端后端，技术栈为 FastAPI + sqlite3 + Pydantic。

## 运行

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

默认 sqlite 数据库路径为 `backend/data/midas.sqlite3`，可通过环境变量覆盖：

```bash
MIDAS_DB_PATH=/tmp/midas.sqlite3 uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

推荐先复制环境变量模板：

```bash
cp backend/.env.example backend/.env
```

## AkShare 数据同步

设置页会调用：

```http
POST /api/v1/data-sync/jobs
```

同步服务会直接调用 AkShare，将筛选器所需数据写入 sqlite3。同步成功前，screener 为空；若 AkShare 或上游源异常，任务会标记为 `failed`，可通过 `GET /api/v1/data-sync/jobs/{jobId}` 查看错误信息。

当 Eastmoney 快照/历史接口连接中断时，会自动回退到 A 股代码列表 + 腾讯/新浪日线接口。每次任务股票上限由 `MIDAS_AKSHARE_LIMIT` 控制，默认 `300`。

`POST /api/v1/data-sync/jobs` 支持参数：

- `limit`：本次任务最大股票数，默认 `300`
- `updateMode`：`full` 全量刷新，`price_only` 仅刷新已入库股票最新价
- `startDate` / `endDate`：可选日线时间区间，格式 `YYYY-MM-DD`
- `fullUniverse`：`true` 时扩展为全市场任务（上限 `10000`）

任务状态响应包含 `startDate`、`endDate`、`fullUniverse`、`totalTasks`、`completedTasks`、`progressPercent`、`isRealtime`、`backend`、`pollIntervalMs`。任务控制接口为：

- `POST /api/v1/data-sync/jobs/{jobId}/pause`
- `POST /api/v1/data-sync/jobs/{jobId}/resume`
- `POST /api/v1/data-sync/jobs/{jobId}/stop`

`GET /api/v1/data-sync/datasets` 返回当前数据行数以及日线覆盖区间（`fromDate` / `toDate`）。前端会在提交前二次确认，并在任务进行时自动轮询状态。

### 同步性能参数（并发 / 队列 / 限流 / 重试）

已支持以下环境变量用于优化抓取性能与稳定性：

- `MIDAS_AKSHARE_FETCH_CONCURRENCY`：单任务抓取并发数，默认 `4`
- `MIDAS_AKSHARE_PIPELINE_QUEUE_SIZE`：抓取/入库流水线队列大小，默认 `8`
- `MIDAS_AKSHARE_RETRY_MAX_ATTEMPTS`：单次调用最大重试次数，默认 `3`
- `MIDAS_AKSHARE_RETRY_BASE_DELAY_MS`：指数退避基础延迟（毫秒），默认 `300`
- `MIDAS_AKSHARE_RETRY_MAX_DELAY_MS`：指数退避最大延迟（毫秒），默认 `5000`
- `MIDAS_AKSHARE_RATE_LIMIT_RPS`：默认全局限流（每秒请求数），默认 `5`
- `MIDAS_AKSHARE_RATE_LIMIT_RPS_OVERRIDES`：按数据源覆盖限流，格式 `bucket=rps,bucket=rps`

可覆盖的 bucket 示例：

- `history_tx`
- `history_sina`
- `history_em`
- `spot`
- `code_name`
- `industry`
- `profile`
- `xueqiu`
- `fundamental`
- `value`
- `dividend`
- `revenue`
- `holder`

示例：

```bash
MIDAS_AKSHARE_RATE_LIMIT_RPS_OVERRIDES=history_tx=2,history_sina=1.5,history_em=3
```

### Redis 模式与默认 sqlite3 模式

同步链路支持两种运行模式：

1. Redis 模式（`REDIS_URL` 已配置且可连通）
- Redis 存储任务实时状态与控制标记（`pause` / `resume` / `stop`）
- `GET /api/v1/data-sync/jobs/{jobId}` 优先返回实时状态：
  - `isRealtime: true`
  - `backend: "redis"`
  - `pollIntervalMs`（建议轮询间隔）
- SQLite 仍为历史持久化真值

2. sqlite3 回退模式（`REDIS_URL` 未配置或不可用）
- 任务仍可正常运行，状态由 sqlite 支撑
- API 返回：
  - `isRealtime: false`
  - `backend: "sqlite-fallback"`
- Redis 不是基础功能必需，仅用于增强实时协调与状态新鲜度

## Dashboard 市场数据

`GET /api/v1/market/indices` 与 `GET /api/v1/news` 会直接调用 AkShare 获取 A 股指数与财经资讯。后端不再预置 dashboard 指数走势、新闻和默认自选股；dashboard 自选列表仅展示与已同步股票数据匹配的用户自选项。

## 测试

```bash
python3 -m pytest backend/tests -q
```
