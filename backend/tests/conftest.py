import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MIDAS_DB_PATH", str(tmp_path / "midas-test.sqlite3"))

    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client
