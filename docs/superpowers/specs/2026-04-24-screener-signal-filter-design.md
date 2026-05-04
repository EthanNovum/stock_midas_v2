# Screener 信号筛选器设计

## 1. 背景与目标

当前 `frontend/src/pages/Screener.tsx` 已支持数值筛选、公司性质筛选、上市地点筛选，但缺少按交易信号（买入/卖出/观望）的筛选能力。

本次改造目标：

1. 新增信号筛选器，支持多选标签交互。
2. 默认全选（买入/卖出/观望），保持现有默认结果不变。
3. 采用前端本地过滤，不改后端接口。
4. 保持现有排序、分页、查询接口调用方式不变。

## 2. 范围与非目标

### 2.1 范围

- 文件：`frontend/src/pages/Screener.tsx`
- 内容：信号筛选状态、筛选 UI、筛选后的结果渲染与状态文案联动。

### 2.2 非目标

- 不修改 `/api/v1/screener/query` 请求参数与后端筛选逻辑。
- 不新增后端 signal 过滤字段。
- 不调整导出接口行为。

## 3. 方案评估

### 3.1 方案 A（采用）：独立信号标签筛选（前端本地）

- 新增 `activeSignals: TradeSignal[]` 状态。
- 在 Attributes 区新增 “信号 (Signal)” 多选标签组。
- 对当前 `results` 做本地过滤后再排序渲染。

优点：
- 与现有 Ownership/Exchange 的交互一致。
- 改动范围小，风险低，交付快。

缺点：
- `total` 仍是后端统计总量，可能与本地信号过滤后可见条数不同。

### 3.2 方案 B：抽通用多选筛选框架

- 对 Ownership/Exchange/Signal 统一抽象为可复用结构。

优点：结构统一。
缺点：本次需求偏小，重构成本高于收益。

### 3.3 方案 C：在 payload 预留 signals 字段但仅前端使用

优点：看似为后续后端联动做准备。
缺点：语义混淆（请求中有字段但后端不生效），不利于可维护性。

## 4. 详细设计

### 4.1 新增状态与常量

1. 新增信号选项常量（默认全选来源）：
   - `SIGNAL_OPTIONS: TradeSignal[] = ['buy', 'sell', 'hold']`
2. 新增状态：
   - `activeSignals`
   - 初始化为 `SIGNAL_OPTIONS`

### 4.2 信号本地过滤数据流

当前数据流：`results -> sortResults -> sortedResults`

改造后：
`results -> signalFilteredResults -> sortResults -> sortedResults`

具体：
1. 新增 `signalFilteredResults`：
   - `results.filter((stock) => activeSignals.includes(stock.signal))`
2. `sortedResults` 的输入改为 `signalFilteredResults`。

这样保证“先过滤后排序”，符合用户心智模型。

### 4.3 UI 结构与交互

在 `Attributes` 卡片中新增第三组筛选：

- 标题：`信号 (Signal)`
- 选项：`买入 / 卖出 / 观望`
- 交互：与 Ownership/Exchange 相同的标签多选逻辑

文案映射复用现有 `getSignalLabel(signal)`，避免重复维护。

### 4.4 清空与活跃筛选判断

1. `handleClearFilters` 中新增重置：
   - `setActiveSignals(SIGNAL_OPTIONS)`
2. 新增活跃信号筛选判断：
   - `hasSignalFilter = activeSignals.length !== SIGNAL_OPTIONS.length`
3. `hasActiveFilters` 加入 `hasSignalFilter`。

## 5. 结果展示与计数口径

1. 列表渲染使用 `sortedResults`（已应用信号筛选）。
2. “已加载 X / Y 条结果”中：
   - `X` 使用当前可见条数（过滤后）
   - `Y` 继续显示后端 `total`
3. 空态逻辑沿用现有判断，并通过 `hasActiveFilters`（含信号）准确提示“当前筛选条件下无结果”。

## 6. 行为一致性与边界

1. 不改后端查询请求，不新增 signal 查询参数。
2. 导出行为保持现状（仍按后端筛选维度，不包含前端本地信号筛选）。
3. 加载更多逻辑不变；本地信号筛选只影响当前已加载结果的可见性。

## 7. 验收标准

1. 默认进入页面时，信号筛选器三项全选。
2. 可独立切换买入/卖出/观望，多选生效。
3. 切换信号选项后，结果列表即时按 `stock.signal` 过滤。
4. “一键清除”后，信号筛选恢复全选。
5. 排序、分页、加载更多、查询请求参数均维持原有行为。

## 8. 实施清单（供后续计划拆分）

1. 增加信号常量与 `activeSignals` 状态。
2. 新增信号标签组 UI 与 toggle 逻辑。
3. 新增 `signalFilteredResults` 并接入 `sortedResults`。
4. 将 `hasActiveFilters` 与 `handleClearFilters` 联动信号状态。
5. 校对空态与计数字段显示口径。