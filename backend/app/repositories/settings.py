import sqlite3

from app import runtime_config
from app.repositories import data_sync
from app.timeutils import now_iso


class SettingsError(ValueError):
    pass


def get_settings(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT * FROM user_settings WHERE id=1").fetchone()
    latest = data_sync.get_latest_job(conn)
    api_key = resolve_llm_api_key(row["provider"], row["model"], row["base_url"])
    return {
        "appearance": {"theme": row["theme"]},
        "llm": {
            "provider": row["provider"],
            "model": row["model"],
            "baseUrl": row["base_url"],
            "hasApiKey": bool(api_key),
            "clusterStatus": "normal",
            "latencyMs": 1.2,
        },
        "llmModels": list_llm_models(conn),
        "dataSync": {
            "source": latest["source"] if latest else "akshare",
            "lastJobId": latest["jobId"] if latest else None,
            "lastStatus": latest["status"] if latest else "idle",
            "lastSyncAt": latest["finishedAt"] if latest else None,
            "updatedRows": latest["updatedRows"] if latest else 0,
            "failedRows": latest["failedRows"] if latest else 0,
        },
    }


def update_appearance(conn: sqlite3.Connection, theme: str) -> dict:
    conn.execute("UPDATE user_settings SET theme=?, updated_at=? WHERE id=1", (theme, now_iso()))
    conn.commit()
    return {"theme": theme}


def update_llm(conn: sqlite3.Connection, payload) -> dict:
    base_url = normalize_optional_url(payload.base_url)
    model_row = upsert_llm_model(conn, payload.provider, payload.model, base_url)
    conn.execute(
        "UPDATE user_settings SET provider=?, model=?, base_url=?, updated_at=? WHERE id=1",
        (payload.provider, payload.model, base_url, now_iso()),
    )
    set_active_llm_model(conn, model_row["id"])
    conn.commit()

    if payload.apiKey:
        set_llm_api_key(payload.provider, payload.model, base_url, payload.apiKey)

    return {
        "provider": payload.provider,
        "model": payload.model,
        "baseUrl": base_url,
        "hasApiKey": bool(resolve_llm_api_key(payload.provider, payload.model, base_url)),
    }


def list_llm_models(conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        """
        SELECT id, provider, model, base_url, is_active, created_at, updated_at
        FROM llm_models
        ORDER BY id
        """
    ).fetchall()
    return {"items": [llm_model_to_dict(row) for row in rows]}


def create_llm_model(conn: sqlite3.Connection, payload) -> dict:
    now = now_iso()
    base_url = normalize_optional_url(payload.base_url)
    try:
        cursor = conn.execute(
            """
            INSERT INTO llm_models (provider, model, base_url, api_key_ciphertext, is_active, created_at, updated_at)
            VALUES (?, ?, ?, NULL, 0, ?, ?)
            """,
            (payload.provider, payload.model, base_url, now, now),
        )
    except sqlite3.IntegrityError as exc:
        raise SettingsError("模型配置已存在") from exc

    conn.commit()
    if payload.apiKey:
        set_llm_api_key(payload.provider, payload.model, base_url, payload.apiKey)

    row = conn.execute(
        """
        SELECT id, provider, model, base_url, is_active, created_at, updated_at
        FROM llm_models
        WHERE id=?
        """,
        (cursor.lastrowid,),
    ).fetchone()
    return llm_model_to_dict(row)


def delete_llm_model(conn: sqlite3.Connection, model_id: int) -> None:
    count = conn.execute("SELECT COUNT(*) AS count FROM llm_models").fetchone()["count"]
    if count <= 1:
        raise SettingsError("至少保留一个 LLM 模型配置")

    row = conn.execute(
        "SELECT id, provider, model, is_active FROM llm_models WHERE id=?",
        (model_id,),
    ).fetchone()
    if not row:
        raise SettingsError("模型配置不存在")

    conn.execute("DELETE FROM llm_models WHERE id=?", (model_id,))
    if row["is_active"]:
        fallback = conn.execute(
            """
            SELECT id, provider, model, base_url
            FROM llm_models
            ORDER BY id
            LIMIT 1
            """
        ).fetchone()
        set_active_llm_model(conn, fallback["id"])
        conn.execute(
            "UPDATE user_settings SET provider=?, model=?, base_url=?, updated_at=? WHERE id=1",
            (fallback["provider"], fallback["model"], fallback["base_url"], now_iso()),
        )
    conn.commit()


def upsert_llm_model(conn: sqlite3.Connection, provider: str, model: str, base_url: str | None) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, provider, model, base_url, is_active, created_at, updated_at
        FROM llm_models
        WHERE provider=? AND model=?
        """,
        (provider, model),
    ).fetchone()
    if row:
        if row["base_url"] != base_url:
            conn.execute("UPDATE llm_models SET base_url=?, updated_at=? WHERE id=?", (base_url, now_iso(), row["id"]))
            return conn.execute(
                """
                SELECT id, provider, model, base_url, is_active, created_at, updated_at
                FROM llm_models
                WHERE id=?
                """,
                (row["id"],),
            ).fetchone()
        return row

    now = now_iso()
    cursor = conn.execute(
        """
        INSERT INTO llm_models (provider, model, base_url, api_key_ciphertext, is_active, created_at, updated_at)
        VALUES (?, ?, ?, NULL, 0, ?, ?)
        """,
        (provider, model, base_url, now, now),
    )
    return conn.execute(
        """
        SELECT id, provider, model, base_url, is_active, created_at, updated_at
        FROM llm_models
        WHERE id=?
        """,
        (cursor.lastrowid,),
    ).fetchone()


def set_active_llm_model(conn: sqlite3.Connection, model_id: int) -> None:
    now = now_iso()
    conn.execute("UPDATE llm_models SET is_active=0, updated_at=?", (now,))
    conn.execute("UPDATE llm_models SET is_active=1, updated_at=? WHERE id=?", (now, model_id))


def llm_model_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "provider": row["provider"],
        "model": row["model"],
        "baseUrl": row["base_url"],
        "hasApiKey": bool(resolve_llm_api_key(row["provider"], row["model"], row["base_url"])),
        "isActive": bool(row["is_active"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def normalize_optional_url(value: str | None) -> str | None:
    stripped = value.strip() if value else ""
    return stripped or None


def llm_api_key_ref(provider: str, model: str, base_url: str | None) -> str:
    return f"{provider}|{model}|{base_url or ''}"


def set_llm_api_key(provider: str, model: str, base_url: str | None, value: str | None) -> None:
    runtime_config.set_memory_api_key(llm_api_key_ref(provider, model, base_url), value)
    runtime_config.set_memory_api_key(provider, value)


def resolve_llm_api_key(provider: str, model: str, base_url: str | None) -> str | None:
    return runtime_config.resolve_api_key(llm_api_key_ref(provider, model, base_url)) or runtime_config.resolve_api_key(provider)
