# Midas Frontend

Midas 的前端应用（React + Vite），用于展示行情看板、选股器、投资组合、研报与设置页。

## 一、环境要求

- Node.js 18+
- npm 9+

## 二、本地启动

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

在 `frontend` 目录创建 `.env.local`（或复制现有示例文件），至少配置：

```bash
GEMINI_API_KEY=你的_Gemini_API_Key
```

如需对接本地后端，请按项目实际约定补充 API 相关变量。

3. 启动开发环境

```bash
npm run dev
```

启动后默认可在本机开发端口访问（以终端输出为准）。

## 三、常用命令

```bash
# 启动开发服务
npm run dev

# 构建生产包
npm run build

# 本地预览构建结果
npm run preview

# TypeScript 检查（项目里挂在 lint 脚本）
npm run lint
```

## 四、目录说明（简版）

```text
frontend/
  src/
    pages/        # 页面（Dashboard、Screener、Portfolio、Reports、Settings 等）
    components/   # 通用组件
    lib/          # 工具函数
    types.ts      # 前端共享类型
```

## 五、与后端联调说明

- 前端主要通过 `/api/v1/*` 调用后端接口。
- 设置页数据同步使用：
  - `POST /api/v1/data-sync/jobs`
  - `GET /api/v1/data-sync/jobs/{jobId}`
  - `POST /api/v1/data-sync/jobs/{jobId}/pause|resume|stop`
- 当任务处于 `queued/running/paused` 时，设置页会自动轮询任务状态并更新进度展示。

## 六、Redis 配置（后端数据同步实时状态）

> 说明：Redis 用于后端数据同步任务的实时状态与控制（暂停/继续/停止）。
> 前端不直接连接 Redis，而是通过后端接口读取状态。

### 1) 本地启动 Redis（Docker）

在任意目录执行：

```bash
docker run -d --name midas-redis -p 6379:6379 redis:7-alpine
```

### 2) 后端配置 `REDIS_URL`

在启动后端前设置环境变量（示例）：

```bash
export REDIS_URL=redis://127.0.0.1:6379/0
```

然后启动后端：

```bash
cd ../backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3) 运行模式说明

- **Redis 模式**（`REDIS_URL` 可用）
  - 后端返回实时状态：`isRealtime: true`、`backend: "redis"`
  - 设置页自动轮询时会优先展示 Redis 实时进度

- **SQLite 回退模式**（未配置或 Redis 不可用）
  - 后端仍可正常执行同步任务
  - 返回：`isRealtime: false`、`backend: "sqlite-fallback"`

### 4) 验证是否生效

在设置页提交一次数据同步任务后，查看任务状态响应（`GET /api/v1/data-sync/jobs/{jobId}`）：

- 若为 Redis 模式，应看到：
  - `"isRealtime": true`
  - `"backend": "redis"`

## 七、故障排查

- 依赖安装失败：先确认 Node/npm 版本，再删除 `node_modules` 和锁文件后重装。
- 页面空白或接口报错：优先检查后端是否启动、接口路径是否正确、环境变量是否生效。
- 构建失败：先运行 `npm run lint` 查看 TypeScript 报错，再逐项修复。
- Redis 未生效：检查后端进程是否拿到了 `REDIS_URL`，以及 Redis 端口是否可访问。
