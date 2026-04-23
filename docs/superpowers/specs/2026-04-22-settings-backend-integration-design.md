# Settings 后端接入与按钮动作打通设计（A 方案）

## 1. 背景与目标

基于 `backend/API.md`，当前任务聚焦于“设置页全部按钮可触发真实后端动作”，并满足以下约束：

- `apiKey` 从 `.env` 读取；
- 本地运行时允许明文存储在内存；
- 不写入 sqlite；
- “保存并重启集群”执行轻量重载（reload），不做进程级重启。

目标页面为 `frontend/src/pages/Settings.tsx`，目标接口为：

- `GET /api/v1/settings`
- `PATCH /api/v1/settings/appearance`
- `PATCH /api/v1/settings/llm`
- `POST /api/v1/settings/llm/test`
- `POST /api/v1/settings/llm/restart`
- 以及已在用的数据同步接口

## 2. 约束与非目标

### 2.1 约束

1. `apiKey` 不落库，不写 sqlite。
2. 前端不展示 `apiKey` 明文，后端不回显。
3. 兼容现有数据同步按钮流程（`/data-sync/jobs*`）。
4. 字段命名遵循 API 文档，前端优先使用 camelCase 响应键。

### 2.2 非目标

1. 不实现真实外部 LLM SDK 调用（`/llm/test` 可先最小可用）。
2. 不实现进程级/容器级重启。
3. 不扩展多用户隔离配置模型。

## 3. 方案选择

### 3.1 候选方案

- **方案 A（采用）**：设置页全链路打通；`provider/model` 可持久化，`apiKey` 仅内存 + `.env` 回退；重启为轻量重载。
- 方案 B：`apiKey` 仅 `.env`，前端不接收输入。
- 方案 C：提交后回写 `.env` 文件。

### 3.2 采用原因

方案 A 同时满足用户指定约束与交互完整性：

- 不落 sqlite；
- 前端按钮可用；
- 保留“保存并重启集群”的操作语义；
- 改动集中于 settings 路由/仓储和 settings 页面。

## 4. 后端设计

### 4.1 配置来源与优先级

定义运行时配置读取优先级：

1. 进程内存覆盖值（来自 `PATCH /settings/llm` 的 `apiKey`）
2. `.env` 对应 provider 的 key
3. 空值

对外统一暴露 `hasApiKey: bool`，不返回 key 本身。

### 4.2 数据持久化边界

- sqlite 持久化：`theme`、`provider`、`model`、状态字段（如 `clusterStatus`/`latencyMs` 可按现有实现处理）
- 不持久化：`apiKey`

### 4.3 接口行为

#### GET `/api/v1/settings`

返回：

- `appearance.theme`
- `llm.provider`
- `llm.model`
- `llm.hasApiKey`
- `llm.clusterStatus`
- `llm.latencyMs`
- `dataSync` 最新任务摘要（若现有逻辑已支持则复用）

#### PATCH `/api/v1/settings/appearance`

- 输入：`{ theme }`
- 行为：更新 sqlite 中主题配置
- 输出：`{ theme }`

#### PATCH `/api/v1/settings/llm`

- 输入：`{ provider, model, apiKey? }`
- 行为：
  - `provider/model` 持久化到 sqlite
  - 若 `apiKey` 提供且非空：写入内存覆盖值
- 输出：`{ provider, model, hasApiKey }`

#### POST `/api/v1/settings/llm/test`

- 行为：
  - 解析当前有效 key（内存覆盖 > `.env`）
  - 无 key 返回 400
  - 有 key 返回 `ok=true`，并给出 `latencyMs`（最小实现可为轻量测试或模拟延迟）

#### POST `/api/v1/settings/llm/restart`

- 行为：执行轻量重载：重新读取 `.env` 并刷新内存态
- 输出：`{ status: "restarted", clusterStatus, latencyMs }`

### 4.4 错误处理

- 参数错误：422
- 测试连接缺少 key：400 + `detail.message`
- 重载异常：500 + `detail.message`
- 不记录/回显敏感值

## 5. 前端设计（Settings 页面）

### 5.1 初始化

页面加载时并行/顺序读取：

1. `GET /api/v1/settings`（配置）
2. `GET /api/v1/data-sync/jobs/latest`（已有）

回填 `theme/provider/model/hasApiKey` 与同步状态面板。

### 5.2 按钮动作映射

- 主题按钮：`PATCH /settings/appearance`
- 保存并重启：
  1. `PATCH /settings/llm`
  2. `POST /settings/llm/restart`
- 测试连接（新增或启用）：`POST /settings/llm/test`
- 更新选股器数据：保持现有 `POST /data-sync/jobs`
- 刷新进度：保持现有 `GET /data-sync/jobs/{jobId}`

### 5.3 状态与反馈

- 保存/测试/同步分别持有 loading 状态
- 成功提示更新 `clusterStatus/latencyMs`
- `apiKey` 提交后清空输入框，仅保留 `hasApiKey=true`
- 错误提示显示可读 message，不输出敏感信息

## 6. 数据流

1. 用户在设置页修改 provider/model/apiKey
2. 点击“保存并重启集群”
3. 前端提交 llm patch
4. 后端更新持久化字段 + 可选内存 key
5. 前端调用 restart
6. 后端 reload `.env` 与运行态
7. 前端刷新显示“重启完成”与最新状态

## 7. 测试与验收

### 7.1 后端测试（pytest）

- `GET /settings` 返回结构正确，且仅有 `hasApiKey`
- `PATCH /settings/appearance` 生效
- `PATCH /settings/llm` 后 `provider/model` 持久化，`apiKey` 不落库
- `POST /settings/llm/test`：无 key 为 400，有 key 为 200
- `POST /settings/llm/restart`：返回 `restarted`

### 7.2 前端验收（手工）

- 主题切换后刷新仍生效
- 保存并重启后状态更新
- 测试连接按钮成功/失败路径可见
- 数据同步按钮与刷新进度按钮可触发真实后端

## 8. 风险与缓解

1. `.env` key 与前端运行时 key 冲突
   - 缓解：明确优先级（内存覆盖优先）并在 restart 后按规则重算。
2. 测试连接真实 SDK 未接入
   - 缓解：先交付稳定接口契约，后续替换调用实现。
3. 页面多按钮并发触发导致状态闪烁
   - 缓解：按钮级 loading 与互斥控制。

## 9. 实施范围

本次只覆盖 Settings 页及相关后端 settings 路由/仓储与测试，不扩展其它页面数据模型。