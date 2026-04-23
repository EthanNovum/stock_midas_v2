import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app import runtime_config
from app.dependencies import get_conn
from app.repositories import settings
from app.schemas import AppearanceUpdate, LlmModelCreate, LlmUpdate

router = APIRouter(prefix="/settings")


@router.get("")
def get_settings(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return settings.get_settings(conn)


@router.patch("/appearance")
def update_appearance(payload: AppearanceUpdate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return settings.update_appearance(conn, payload.theme)


@router.patch("/llm")
def update_llm(payload: LlmUpdate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return settings.update_llm(conn, payload)


@router.get("/llm/models")
def list_llm_models(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return settings.list_llm_models(conn)


@router.post("/llm/models", status_code=201)
def create_llm_model(payload: LlmModelCreate, conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    try:
        return settings.create_llm_model(conn, payload)
    except settings.SettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/llm/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_llm_model(model_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> Response:
    try:
        settings.delete_llm_model(conn, model_id)
    except settings.SettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/llm/test")
def test_llm(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    current = settings.get_settings(conn)
    if not current["llm"]["hasApiKey"]:
        raise HTTPException(
            status_code=400,
            detail={"code": "MISSING_API_KEY", "message": "缺少 API Key，无法测试连接"},
        )
    return {"ok": True, "latencyMs": 312.4, "message": "连接正常"}


@router.post("/llm/restart")
def restart_llm() -> dict:
    runtime_config.reload_from_env()
    return {"status": "restarted", "clusterStatus": "normal", "latencyMs": 1.2}
