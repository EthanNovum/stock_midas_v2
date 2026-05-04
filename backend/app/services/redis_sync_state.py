import os
from typing import Any

from app.timeutils import now_iso

JOB_TTL_SECONDS = 24 * 60 * 60
ACTIVE_TTL_SECONDS = 2 * 60 * 60
JOB_KEY_PREFIX = "midas:data_sync:job"
CTRL_KEY_PREFIX = "midas:data_sync:ctrl"
ACTIVE_JOB_KEY = "midas:data_sync:active_job"


def _job_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}:{job_id}"


def _ctrl_key(job_id: str) -> str:
    return f"{CTRL_KEY_PREFIX}:{job_id}"


def _normalize_bool(value: Any) -> bool:
    if value in (True, False):
        return bool(value)
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "on"}


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_bool_text(value: bool) -> str:
    return "1" if value else "0"


def get_client():
    url = os.getenv("REDIS_URL", "").strip()
    if not url:
        return None
    try:
        from redis import Redis

        return Redis.from_url(url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1)
    except Exception:
        return None


def _safe_call(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def set_active_job(job_id: str) -> bool:
    client = get_client()
    if not client:
        return False

    return bool(_safe_call(lambda: client.set(ACTIVE_JOB_KEY, job_id, ex=ACTIVE_TTL_SECONDS), False))


def clear_active_job(job_id: str | None = None) -> bool:
    client = get_client()
    if not client:
        return False

    if not job_id:
        return bool(_safe_call(lambda: client.delete(ACTIVE_JOB_KEY), False))

    current = _safe_call(lambda: client.get(ACTIVE_JOB_KEY))
    if current == job_id:
        return bool(_safe_call(lambda: client.delete(ACTIVE_JOB_KEY), False))
    return False


def get_active_job() -> str | None:
    client = get_client()
    if not client:
        return None
    return _safe_call(lambda: client.get(ACTIVE_JOB_KEY))


def init_job_state(payload: dict[str, Any]) -> bool:
    client = get_client()
    if not client:
        return False

    job_id = str(payload.get("jobId") or "").strip()
    if not job_id:
        return False

    key = _job_key(job_id)
    values = {k: "" if v is None else str(v) for k, v in payload.items()}
    values["updatedAt"] = now_iso()
    values["isRealtime"] = "1"
    values["backend"] = "redis"
    values["pollIntervalMs"] = str(payload.get("pollIntervalMs") or 3000)
    values.setdefault("progressPercent", "0")

    ok = _safe_call(lambda: client.hset(key, mapping=values), 0)
    _safe_call(lambda: client.expire(key, ACTIVE_TTL_SECONDS), False)

    ctrl_key = _ctrl_key(job_id)
    _safe_call(
        lambda: client.hset(
            ctrl_key,
            mapping={"paused": "0", "stopped": "0", "updatedAt": now_iso()},
        ),
        0,
    )
    _safe_call(lambda: client.expire(ctrl_key, ACTIVE_TTL_SECONDS), False)
    set_active_job(job_id)
    return bool(ok)


def update_job_state(job_id: str, fields: dict[str, Any], finished: bool = False) -> bool:
    client = get_client()
    if not client:
        return False

    key = _job_key(job_id)
    mapping = {k: "" if v is None else str(v) for k, v in fields.items()}
    mapping["updatedAt"] = now_iso()
    mapping["isRealtime"] = "1"
    mapping["backend"] = "redis"

    ok = _safe_call(lambda: client.hset(key, mapping=mapping), 0)
    _safe_call(lambda: client.expire(key, JOB_TTL_SECONDS if finished else ACTIVE_TTL_SECONDS), False)
    if finished:
        clear_active_job(job_id)
    return bool(ok)


def get_job_state(job_id: str) -> dict[str, Any] | None:
    client = get_client()
    if not client:
        return None

    payload = _safe_call(lambda: client.hgetall(_job_key(job_id)), None)
    if not payload:
        return None

    return {
        "jobId": payload.get("jobId") or job_id,
        "status": payload.get("status"),
        "source": payload.get("source"),
        "limit": _to_int(payload.get("limit"), 0),
        "updateMode": payload.get("updateMode"),
        "startDate": payload.get("startDate") or None,
        "endDate": payload.get("endDate") or None,
        "tradeDate": payload.get("tradeDate") or None,
        "fullUniverse": _normalize_bool(payload.get("fullUniverse")),
        "totalTasks": _to_int(payload.get("totalTasks"), 0),
        "completedTasks": _to_int(payload.get("completedTasks"), 0),
        "progressPercent": _to_int(payload.get("progressPercent"), 0),
        "updatedRows": _to_int(payload.get("updatedRows"), 0),
        "failedRows": _to_int(payload.get("failedRows"), 0),
        "message": payload.get("message") or "",
        "startedAt": payload.get("startedAt") or None,
        "finishedAt": payload.get("finishedAt") or None,
        "isRealtime": True,
        "backend": "redis",
        "pollIntervalMs": _to_int(payload.get("pollIntervalMs"), 3000),
    }


def set_control_state(job_id: str, paused: bool | None = None, stopped: bool | None = None) -> bool:
    client = get_client()
    if not client:
        return False

    mapping: dict[str, str] = {"updatedAt": now_iso()}
    if paused is not None:
        mapping["paused"] = _to_bool_text(paused)
    if stopped is not None:
        mapping["stopped"] = _to_bool_text(stopped)

    ok = _safe_call(lambda: client.hset(_ctrl_key(job_id), mapping=mapping), 0)
    _safe_call(lambda: client.expire(_ctrl_key(job_id), ACTIVE_TTL_SECONDS), False)
    return bool(ok)


def get_control_state(job_id: str) -> dict[str, bool] | None:
    client = get_client()
    if not client:
        return None

    payload = _safe_call(lambda: client.hgetall(_ctrl_key(job_id)), None)
    if not payload:
        return None

    return {
        "paused": _normalize_bool(payload.get("paused")),
        "stopped": _normalize_bool(payload.get("stopped")),
    }
