# Settings Backend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整打通 Settings 页面按钮到后端真实接口，并满足“apiKey 仅 `.env`/内存，不写 sqlite”的约束。

**Architecture:** 以后端 `settings` 路由 + `repositories/settings.py` 作为配置入口，新增运行时密钥存储模块管理 “内存覆盖值 > .env” 的 key 解析。前端 `Settings.tsx` 将 theme/llm/data-sync 三组动作拆分为独立请求流与 loading 状态。

**Tech Stack:** FastAPI, sqlite3, Pydantic v2, pytest, React 19, TypeScript, Vite

---

## File Structure

- Modify: `backend/tests/test_api.py` — 新增 settings 行为的失败测试与回归测试。
- Create: `backend/app/runtime_config.py` — 管理 provider 对应 key 的内存覆盖与 `.env` 读取、reload。
- Modify: `backend/app/schemas.py` — 增加 settings 接口请求模型约束（provider/model/theme）。
- Modify: `backend/app/repositories/settings.py` — 去除 sqlite 密钥写入，接入 runtime key 解析。
- Modify: `backend/app/routers/settings.py` — 实现 llm test/restart 的真实行为与错误码。
- Modify: `frontend/src/pages/Settings.tsx` — 接入 `/api/v1/settings*`，打通主题、保存并重启、测试连接按钮。

---

### Task 1: 用失败测试锁定后端设置行为

**Files:**
- Modify: `backend/tests/test_api.py`
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: 写第一个失败测试（apiKey 不落库）**

```python
def test_patch_llm_keeps_api_key_out_of_sqlite(client):
    response = client.patch(
        "/api/v1/settings/llm",
        json={"provider": "openai", "model": "gpt-4o", "apiKey": "sk-test-1234"},
    )

    assert response.status_code == 200
    assert response.json()["hasApiKey"] is True

    from app.database import connect

    with connect() as conn:
        row = conn.execute("SELECT api_key_ciphertext FROM user_settings WHERE id=1").fetchone()

    assert row["api_key_ciphertext"] is None
```

- [ ] **Step 2: 运行单测确认失败**

Run: `pytest backend/tests/test_api.py::test_patch_llm_keeps_api_key_out_of_sqlite -v`
Expected: FAIL，当前实现会写入 `api_key_ciphertext`。

- [ ] **Step 3: 写第二个失败测试（无 key 测试连接返回 400）**

```python
def test_llm_test_returns_400_without_any_api_key(client):
    client.patch(
        "/api/v1/settings/llm",
        json={"provider": "openai", "model": "gpt-4o"},
    )

    response = client.post("/api/v1/settings/llm/test")

    assert response.status_code == 400
    assert "缺少" in response.json()["detail"]["message"]
```

- [ ] **Step 4: 运行单测确认失败**

Run: `pytest backend/tests/test_api.py::test_llm_test_returns_400_without_any_api_key -v`
Expected: FAIL，当前接口固定返回 `ok=True`。

- [ ] **Step 5: 写第三个失败测试（restart 可重载 .env key）**

```python
def test_llm_restart_reloads_env_api_key(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-abc")

    client.patch(
        "/api/v1/settings/llm",
        json={"provider": "openai", "model": "gpt-4o"},
    )

    restart = client.post("/api/v1/settings/llm/restart")
    assert restart.status_code == 200
    assert restart.json()["status"] == "restarted"

    settings_response = client.get("/api/v1/settings")
    assert settings_response.status_code == 200
    assert settings_response.json()["llm"]["hasApiKey"] is True
```

- [ ] **Step 6: 运行单测确认失败**

Run: `pytest backend/tests/test_api.py::test_llm_restart_reloads_env_api_key -v`
Expected: FAIL，当前 restart 未做 reload。

- [ ] **Step 7: 运行当前 settings 相关测试集（基线）**

Run: `pytest backend/tests/test_api.py -k settings -v`
Expected: 新增用例 FAIL，现有 settings 用例保持可运行。

- [ ] **Step 8: Commit**

```bash
git add backend/tests/test_api.py
git commit -m "test: add failing coverage for settings runtime api key behavior"
```

---

### Task 2: 实现后端 runtime key 与 settings 接口通过测试

**Files:**
- Create: `backend/app/runtime_config.py`
- Modify: `backend/app/repositories/settings.py`
- Modify: `backend/app/routers/settings.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: 创建 runtime key 管理模块（最小实现）**

```python
# backend/app/runtime_config.py
import os
from dataclasses import dataclass


ENV_KEY_BY_PROVIDER = {
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


@dataclass
class RuntimeLlmState:
    memory_api_key: str | None = None


_state = RuntimeLlmState()


def set_memory_api_key(value: str | None) -> None:
    _state.memory_api_key = value.strip() if value else None


def clear_memory_api_key() -> None:
    _state.memory_api_key = None


def resolve_api_key(provider: str) -> str | None:
    if _state.memory_api_key:
        return _state.memory_api_key
    env_name = ENV_KEY_BY_PROVIDER.get(provider)
    return os.getenv(env_name) if env_name else None


def reload_from_env() -> None:
    # 轻量重载策略：清掉内存覆盖后回退 env
    clear_memory_api_key()
```

- [ ] **Step 2: 运行类型检查/导入检查（可快速验证语法）**

Run: `python -m compileall backend/app/runtime_config.py`
Expected: `Compiling 'backend/app/runtime_config.py'...`

- [ ] **Step 3: 修改 repository，移除 sqlite 密钥写入逻辑**

```python
# backend/app/repositories/settings.py (核心片段)
from app import runtime_config


def get_settings(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT * FROM user_settings WHERE id=1").fetchone()
    latest = data_sync.get_latest_job(conn)
    resolved_key = runtime_config.resolve_api_key(row["provider"])
    return {
        "appearance": {"theme": row["theme"]},
        "llm": {
            "provider": row["provider"],
            "model": row["model"],
            "hasApiKey": bool(resolved_key),
            "clusterStatus": "normal",
            "latencyMs": 1.2,
        },
        "dataSync": {
            "source": latest["source"] if latest else "akshare",
            "lastJobId": latest["jobId"] if latest else None,
            "lastStatus": latest["status"] if latest else "idle",
            "lastSyncAt": latest["finishedAt"] if latest else None,
            "updatedRows": latest["updatedRows"] if latest else 0,
            "failedRows": latest["failedRows"] if latest else 0,
        },
    }


def update_llm(conn: sqlite3.Connection, payload) -> dict:
    conn.execute(
        "UPDATE user_settings SET provider=?, model=?, updated_at=? WHERE id=1",
        (payload.provider, payload.model, now_iso()),
    )
    conn.commit()

    if payload.apiKey is not None and payload.apiKey.strip():
        runtime_config.set_memory_api_key(payload.apiKey)

    return {
        "provider": payload.provider,
        "model": payload.model,
        "hasApiKey": bool(runtime_config.resolve_api_key(payload.provider)),
    }
```

- [ ] **Step 4: 修改 router，落地 llm test/restart 行为与错误码**

```python
# backend/app/routers/settings.py (核心片段)
from fastapi import APIRouter, Depends, HTTPException
from app import runtime_config
from app.repositories import settings


@router.post("/llm/test")
def test_llm(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    current = settings.get_settings(conn)
    provider = current["llm"]["provider"]
    api_key = runtime_config.resolve_api_key(provider)
    if not api_key:
        raise HTTPException(status_code=400, detail={"code": "MISSING_API_KEY", "message": "缺少 API Key"})
    return {"ok": True, "latencyMs": 312.4, "message": "连接正常"}


@router.post("/llm/restart")
def restart_llm() -> dict:
    runtime_config.reload_from_env()
    return {"status": "restarted", "clusterStatus": "normal", "latencyMs": 1.2}
```

- [ ] **Step 5: 给请求模型补充约束（最小必要）**

```python
# backend/app/schemas.py (核心片段)
from typing import Literal
from pydantic import BaseModel, Field


class AppearanceUpdate(BaseModel):
    theme: Literal["light", "dark", "system"]


class LlmUpdate(BaseModel):
    provider: Literal["openai", "gemini", "anthropic", "deepseek"]
    model: str = Field(min_length=1)
    apiKey: str | None = None
```

- [ ] **Step 6: 运行之前失败用例，确认转绿**

Run: `pytest backend/tests/test_api.py::test_patch_llm_keeps_api_key_out_of_sqlite backend/tests/test_api.py::test_llm_test_returns_400_without_any_api_key backend/tests/test_api.py::test_llm_restart_reloads_env_api_key -v`
Expected: PASS。

- [ ] **Step 7: 运行 settings 相关测试回归**

Run: `pytest backend/tests/test_api.py -k settings -v`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add backend/app/runtime_config.py backend/app/repositories/settings.py backend/app/routers/settings.py backend/app/schemas.py backend/tests/test_api.py
git commit -m "feat: wire settings llm endpoints to runtime env and memory api key"
```

---

### Task 3: 前端打通 Settings 按钮动作

**Files:**
- Modify: `frontend/src/pages/Settings.tsx`
- Test: `frontend/package.json` (lint script)

- [ ] **Step 1: 写前端行为失败检查（手工基线）**

Run: `npm --prefix frontend run lint`
Expected: PASS（作为改动前基线）。

- [ ] **Step 2: 增加 settings 初始化读取状态与字段**

```tsx
// Settings.tsx (新增状态片段)
const [apiKey, setApiKey] = useState('');
const [hasApiKey, setHasApiKey] = useState(false);
const [clusterStatus, setClusterStatus] = useState('normal');
const [latencyMs, setLatencyMs] = useState<number | null>(null);
const [isSavingLlm, setIsSavingLlm] = useState(false);
const [isTestingLlm, setIsTestingLlm] = useState(false);
const [settingsMessage, setSettingsMessage] = useState('');

useEffect(() => {
  const loadSettings = async () => {
    const response = await fetch('/api/v1/settings');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    setTheme(payload.appearance.theme);
    setProvider(payload.llm.provider);
    setModel(payload.llm.model);
    setHasApiKey(Boolean(payload.llm.hasApiKey));
    setClusterStatus(payload.llm.clusterStatus ?? 'normal');
    setLatencyMs(typeof payload.llm.latencyMs === 'number' ? payload.llm.latencyMs : null);
  };
  void loadSettings();
}, []);
```

- [ ] **Step 3: 实现主题保存动作（点击即 PATCH）**

```tsx
const handleThemeChange = async (nextTheme: 'light' | 'dark' | 'system') => {
  setTheme(nextTheme);
  try {
    const response = await fetch('/api/v1/settings/appearance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: nextTheme }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    setSettingsMessage(error instanceof Error ? `主题保存失败: ${error.message}` : '主题保存失败');
  }
};
```

- [ ] **Step 4: 实现“保存并重启集群”动作**

```tsx
const handleSaveAndRestart = async () => {
  setIsSavingLlm(true);
  setSettingsMessage('正在保存并重启...');
  try {
    const saveResp = await fetch('/api/v1/settings/llm', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, apiKey: apiKey.trim() || undefined }),
    });
    if (!saveResp.ok) throw new Error(`HTTP ${saveResp.status}`);
    const savePayload = await saveResp.json();
    setHasApiKey(Boolean(savePayload.hasApiKey));

    const restartResp = await fetch('/api/v1/settings/llm/restart', { method: 'POST' });
    if (!restartResp.ok) throw new Error(`HTTP ${restartResp.status}`);
    const restartPayload = await restartResp.json();
    setClusterStatus(restartPayload.clusterStatus ?? 'normal');
    setLatencyMs(typeof restartPayload.latencyMs === 'number' ? restartPayload.latencyMs : null);
    setApiKey('');
    setSettingsMessage('保存并重启完成');
  } catch (error) {
    setSettingsMessage(error instanceof Error ? `保存失败: ${error.message}` : '保存失败');
  } finally {
    setIsSavingLlm(false);
  }
};
```

- [ ] **Step 5: 实现“测试连接”动作并绑定按钮**

```tsx
const handleTestConnection = async () => {
  setIsTestingLlm(true);
  setSettingsMessage('正在测试连接...');
  try {
    const response = await fetch('/api/v1/settings/llm/test', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.detail?.message ?? `HTTP ${response.status}`);
    }
    setLatencyMs(payload.latencyMs ?? null);
    setSettingsMessage(payload.message ?? '连接正常');
  } catch (error) {
    setSettingsMessage(error instanceof Error ? `连接测试失败: ${error.message}` : '连接测试失败');
  } finally {
    setIsTestingLlm(false);
  }
};
```

- [ ] **Step 6: 更新 UI 绑定（主题按钮、apiKey 输入、保存按钮、测试按钮）**

```tsx
<button type="button" onClick={() => void handleThemeChange(t.id)}>

<input
  type={showKey ? 'text' : 'password'}
  value={apiKey}
  onChange={(e) => setApiKey(e.target.value)}
  placeholder={hasApiKey ? '已配置 API Key（输入可覆盖内存值）' : 'sk-...'}
/>

<button type="button" onClick={handleTestConnection} disabled={isTestingLlm || isSavingLlm}>
  {isTestingLlm ? '测试中...' : '测试连接'}
</button>

<button type="button" onClick={handleSaveAndRestart} disabled={isSavingLlm || isTestingLlm}>
  {isSavingLlm ? '保存中...' : '保存并重启集群'}
</button>
```

- [ ] **Step 7: 运行前端静态检查**

Run: `npm --prefix frontend run lint`
Expected: PASS。

- [ ] **Step 8: 启动前端并做手工验证（黄金路径）**

Run: `npm --prefix frontend run dev`
Expected: Vite 启动成功，页面可访问。

验证清单：
- 点击主题按钮触发 `PATCH /api/v1/settings/appearance`
- 点击“保存并重启集群”触发 `PATCH /settings/llm` + `POST /settings/llm/restart`
- 点击“测试连接”触发 `POST /settings/llm/test`
- “更新选股器数据/刷新进度”仍可用

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/Settings.tsx
git commit -m "feat: connect settings page buttons to backend settings APIs"
```

---

### Task 4: 全链路回归与完成校验

**Files:**
- Modify: `backend/tests/test_api.py`（若回归中发现缺失断言）
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: 运行后端完整测试**

Run: `pytest backend/tests/test_api.py -v`
Expected: PASS。

- [ ] **Step 2: 运行前端 lint 回归**

Run: `npm --prefix frontend run lint`
Expected: PASS。

- [ ] **Step 3: 验证 sqlite 无明文 key 副作用**

Run: `python - <<'PY'
import os, sqlite3
from pathlib import Path
path = os.getenv('MIDAS_DB_PATH') or str(Path('backend/data/midas.sqlite3'))
conn = sqlite3.connect(path)
row = conn.execute('SELECT api_key_ciphertext FROM user_settings WHERE id=1').fetchone()
print(row[0])
PY`
Expected: `None` 或空值。

- [ ] **Step 4: 最终验证并记录**

Run: `git status --short`
Expected: 仅包含本计划涉及文件，无无关改动。

- [ ] **Step 5: Commit（如有最后修正）**

```bash
git add backend/tests/test_api.py
git commit -m "test: finalize settings integration regression coverage"
```
