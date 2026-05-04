# Screener 响应式改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Screener 页面在全宽大屏、平板、手机三类视口下都能自动适配，并在手机端使用卡片视图替代表格横向滚动。

**Architecture:** 保持现有数据请求、筛选、排序、分页逻辑不变，仅重构 `Screener.tsx` 的布局层。结果区拆分为共享数据源的桌面表格视图和移动端卡片视图，通过 Tailwind 断点类控制显示。新增最小测试基础设施验证关键渲染结构不回归。

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Vitest, React Testing Library

---

## File Structure

- Modify: `frontend/src/pages/Screener.tsx`
  - 责任：页面容器全宽化、筛选区紧凑化、结果区双模式渲染（desktop table + mobile cards）
- Modify: `frontend/package.json`
  - 责任：增加测试脚本与测试依赖
- Create: `frontend/vitest.config.ts`
  - 责任：Vitest + jsdom + setup 文件配置
- Create: `frontend/src/test/setup.ts`
  - 责任：测试环境初始化（`@testing-library/jest-dom`、`IntersectionObserver` mock）
- Create: `frontend/src/pages/Screener.responsive.test.tsx`
  - 责任：覆盖响应式渲染关键结构（全宽容器、双模式容器、移动端卡片字段）

---

### Task 1: 建立测试基线并写出首个失败用例

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Test: `frontend/src/pages/Screener.responsive.test.tsx`

- [ ] **Step 1: 在 `package.json` 增加测试依赖与脚本（先不改业务代码）**

```json
{
  "scripts": {
    "dev": "vite --port=3000 --host=0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "autoprefixer": "^10.4.21",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2",
    "vite": "^6.2.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 新增 Vitest 配置文件**

```ts
// frontend/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

- [ ] **Step 3: 新增测试环境初始化（含 IntersectionObserver mock）**

```ts
// frontend/src/test/setup.ts
import '@testing-library/jest-dom';

class MockIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});
```

- [ ] **Step 4: 写首个失败测试（要求存在移动端卡片容器）**

```tsx
// frontend/src/pages/Screener.responsive.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { Screener } from './Screener';

const mockOptions = {
  numericFilters: [
    { key: 'pe', label: '市盈率', operator: 'lt', defaultValue: 20 },
  ],
  ownership: ['央企'],
  exchanges: ['沪深'],
};

const mockQuery = {
  items: [
    {
      symbol: '600519',
      name: '贵州茅台',
      industry: '白酒',
      price: 1800,
      change: 1.2,
      marketCap: '22,000',
      pe: 30,
      dividend: 2.5,
      initial: '茅',
      ma120: 1700,
      ma120Lower: 1496,
      ma120Upper: 1904,
      signal: 'buy',
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  availableTotal: 1,
};

describe('Screener responsive layout', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/screener/options')) {
        return Promise.resolve(new Response(JSON.stringify(mockOptions), { status: 200 }));
      }
      if (url.includes('/api/v1/screener/query')) {
        return Promise.resolve(new Response(JSON.stringify(mockQuery), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders mobile cards container for small screens', async () => {
    render(<Screener />);

    await waitFor(() => {
      expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    });

    expect(screen.getByTestId('screener-mobile-cards')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: 运行测试并确认失败**

Run: `cd frontend && npm run test -- Screener.responsive.test.tsx`

Expected: FAIL，报错 `Unable to find an element by: [data-testid="screener-mobile-cards"]`

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/vitest.config.ts frontend/src/test/setup.ts frontend/src/pages/Screener.responsive.test.tsx
git commit -m "test: add screener responsive test baseline"
```

---

### Task 2: 改造全宽容器与紧凑筛选区（最小实现让测试继续失败但页面结构就位）

**Files:**
- Modify: `frontend/src/pages/Screener.tsx` (root container + filter sections)
- Test: `frontend/src/pages/Screener.responsive.test.tsx`

- [ ] **Step 1: 先补一个失败测试，锁定全宽容器 class**

```tsx
it('uses full-width responsive page container', async () => {
  const { container } = render(<Screener />);

  await waitFor(() => {
    expect(screen.getByText('高级选股器')).toBeInTheDocument();
  });

  const root = container.firstElementChild;
  expect(root).toHaveClass('w-full');
  expect(root).toHaveClass('px-3');
  expect(root).toHaveClass('xl:px-8');
});
```

- [ ] **Step 2: 调整根容器与筛选区 spacing/padding**

```tsx
// 替换根容器 class
<div className="w-full px-3 sm:px-4 lg:px-6 xl:px-8 space-y-4 md:space-y-6 lg:space-y-8">

// 替换筛选区网格 class
<div className="grid grid-cols-1 lg:grid-cols-12 gap-3 md:gap-4 lg:gap-5">

// Numerical Constraints 卡片
<div className="lg:col-span-8 bg-surface-container-lowest rounded-3xl p-4 md:p-5 lg:p-6 shadow-sm border border-outline-variant/10 relative overflow-hidden">

// 内部 grid
<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">

// 每项垂直节奏
<div key={filter.key} className="space-y-2">

// Categorical Attributes 卡片
<div className="lg:col-span-4 bg-surface-container-lowest rounded-3xl p-4 md:p-5 lg:p-6 shadow-sm border border-outline-variant/10">
```

- [ ] **Step 3: 压缩 chip 与输入控件间距**

```tsx
// ownership/exchange button class
"px-3 md:px-3.5 py-1 text-xs font-bold transition-all"

// input class（保持可读且略紧凑）
"w-full bg-surface-container-low border-b-2 border-outline/20 focus:border-primary px-3 md:px-4 py-2.5 text-sm font-bold text-on-surface outline-none transition-all rounded-t-xl text-right"
```

- [ ] **Step 4: 跑测试，验证全宽容器断言通过，移动卡片断言仍失败**

Run: `cd frontend && npm run test -- Screener.responsive.test.tsx`

Expected: 一个测试 PASS（全宽容器），一个测试 FAIL（移动卡片容器还未实现）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Screener.tsx frontend/src/pages/Screener.responsive.test.tsx
git commit -m "feat: make screener container full-width and compact filters"
```

---

### Task 3: 实现双模式结果区（mobile cards + desktop table）

**Files:**
- Modify: `frontend/src/pages/Screener.tsx` (results rendering)
- Test: `frontend/src/pages/Screener.responsive.test.tsx`

- [ ] **Step 1: 先写失败测试，要求移动卡片字段展示完整**

```tsx
it('renders key stock fields in mobile cards', async () => {
  render(<Screener />);

  await waitFor(() => {
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
  });

  const cards = screen.getByTestId('screener-mobile-cards');
  expect(cards).toHaveTextContent('600519');
  expect(cards).toHaveTextContent('最新价');
  expect(cards).toHaveTextContent('市值');
  expect(cards).toHaveTextContent('市盈率');
  expect(cards).toHaveTextContent('股息率');
  expect(cards).toHaveTextContent('MA120');
});
```

- [ ] **Step 2: 在 `Screener.tsx` 提取移动端卡片渲染函数**

```tsx
const renderMobileCards = () => (
  <div data-testid="screener-mobile-cards" className="md:hidden divide-y divide-surface-container-low/60">
    {sortedResults.map((stock) => (
      <article key={stock.symbol} className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-primary">{stock.name}</p>
            <p className="text-[11px] font-mono text-on-surface-variant/70 tracking-wider">{stock.symbol}</p>
            <p className="text-xs text-on-surface-variant mt-1">{stock.industry || '-'}</p>
          </div>
          <span className={cn(
            "inline-flex items-center justify-center gap-1 min-w-14 px-2.5 py-1 rounded-md text-[11px] font-black",
            stock.signal === 'buy' && "bg-error-container/40 text-error",
            stock.signal === 'sell' && "bg-tertiary-container/10 text-tertiary-container",
            stock.signal === 'hold' && "bg-surface-container-highest text-on-surface-variant"
          )}>
            {getSignalLabel(stock.signal)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <p><span className="text-on-surface-variant">最新价</span> <span className="font-bold">{stock.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
          <p><span className="text-on-surface-variant">涨跌幅</span> <span className="font-bold">{stock.change >= 0 ? '+' : ''}{stock.change}%</span></p>
          <p><span className="text-on-surface-variant">市值</span> <span className="font-bold">{stock.marketCap}</span></p>
          <p><span className="text-on-surface-variant">市盈率</span> <span className="font-bold">{stock.pe}</span></p>
          <p><span className="text-on-surface-variant">股息率</span> <span className="font-bold">{Number(stock.dividend ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span></p>
          <p><span className="text-on-surface-variant">MA120</span> <span className="font-bold">{stock.ma120.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
          <p><span className="text-on-surface-variant">MA120×0.88</span> <span className="font-bold">{stock.ma120Lower.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
          <p><span className="text-on-surface-variant">MA120×1.12</span> <span className="font-bold">{stock.ma120Upper.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
        </div>
      </article>
    ))}
  </div>
);
```

- [ ] **Step 3: 将结果区改为双容器**

```tsx
{/* mobile */}
{!isLoading && !errorMessage && results.length > 0 && renderMobileCards()}

{/* desktop table */}
<div data-testid="screener-desktop-table" className="hidden md:block overflow-x-auto">
  <table className="w-full min-w-[1080px] lg:min-w-[1160px] text-left border-collapse">
    {/* 保留现有 thead/tbody 逻辑 */}
  </table>
</div>
```

并把桌面单元格 padding 改成断点化，例如：

```tsx
<th className="px-3 md:px-4 lg:px-6 py-3 md:py-4 ...">
<td className="px-3 md:px-4 lg:px-6 py-4 md:py-5 ...">
```

- [ ] **Step 4: 跑测试并确保全部通过**

Run: `cd frontend && npm run test -- Screener.responsive.test.tsx`

Expected: PASS，显示 `3 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Screener.tsx frontend/src/pages/Screener.responsive.test.tsx
git commit -m "feat: add mobile card mode for screener results"
```

---

### Task 4: 回归验证与发布前检查

**Files:**
- Modify (if needed): `frontend/src/pages/Screener.tsx`
- Test: `frontend/src/pages/Screener.responsive.test.tsx`

- [ ] **Step 1: 增加断点可见性回归测试（防止类名回退）**

```tsx
it('keeps both responsive containers mounted with breakpoint classes', async () => {
  render(<Screener />);

  await waitFor(() => {
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
  });

  expect(screen.getByTestId('screener-mobile-cards')).toHaveClass('md:hidden');
  expect(screen.getByTestId('screener-desktop-table')).toHaveClass('hidden');
  expect(screen.getByTestId('screener-desktop-table')).toHaveClass('md:block');
});
```

- [ ] **Step 2: 运行全量静态检查与构建**

Run: `cd frontend && npm run lint && npm run test && npm run build`

Expected: 全部成功；`vite build` 产物生成到 `frontend/dist`

- [ ] **Step 3: 手工断点验收（必须执行）**

Run: `cd frontend && npm run dev`

检查项：

- 375x812：显示卡片列表，无横向滚动依赖。
- 768x1024：进入表格模式，筛选区紧凑、按钮不重叠。
- 1920x1080：全宽展示，明显宽于原 `max-w-7xl`。
- 加载态/错误态/空态/加载更多：行为一致。

- [ ] **Step 4: 只在需要时做最后样式微调并复跑检查**

```tsx
// 仅允许微调 spacing、padding、min-w，不调整业务逻辑
```

Run: `cd frontend && npm run test && npm run build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Screener.tsx frontend/src/pages/Screener.responsive.test.tsx frontend/package.json frontend/vitest.config.ts frontend/src/test/setup.ts
git commit -m "chore: finalize screener responsive layout and verification"
```

---

## Spec Coverage Check

- 全宽容器（Spec 4.1）→ Task 2
- 筛选区紧凑化（Spec 4.2）→ Task 2
- 双模式结果区（Spec 4.3）→ Task 3
- 状态一致性（Spec 5）→ Task 3 + Task 4
- 验收标准（Spec 7）→ Task 4 手工断点验收

## Placeholder / Consistency Check

- 无 TBD/TODO/“后续补充”语句。
- 所有新增测试文件、配置文件、命令、提交粒度已给出。
- 命名一致：`screener-mobile-cards`、`screener-desktop-table` 在实现与测试中保持一致。
