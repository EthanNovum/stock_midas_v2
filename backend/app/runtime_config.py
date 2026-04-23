import os
from dataclasses import dataclass
from pathlib import Path


ENV_KEY_BY_PROVIDER = {
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


@dataclass
class RuntimeLlmState:
    memory_api_keys: dict[str, str] | None = None
    dotenv_values: dict[str, str] | None = None


_state = RuntimeLlmState(memory_api_keys={})


def set_memory_api_key(provider: str, value: str | None) -> None:
    stripped = value.strip() if value else ""
    if stripped:
        if _state.memory_api_keys is None:
            _state.memory_api_keys = {}
        _state.memory_api_keys[provider] = stripped


def clear_memory_api_key(provider: str | None = None) -> None:
    if _state.memory_api_keys is None:
        _state.memory_api_keys = {}
    if provider:
        _state.memory_api_keys.pop(provider, None)
    else:
        _state.memory_api_keys.clear()


def reset_runtime_state() -> None:
    clear_memory_api_key()
    _state.dotenv_values = None


def reload_from_env() -> None:
    _state.dotenv_values = load_dotenv_values()


def resolve_api_key(provider: str) -> str | None:
    if _state.memory_api_keys and _state.memory_api_keys.get(provider):
        return _state.memory_api_keys[provider]

    env_name = ENV_KEY_BY_PROVIDER.get(provider)
    if not env_name:
        return None

    env_value = os.getenv(env_name)
    if env_value:
        return env_value

    if _state.dotenv_values is None:
        _state.dotenv_values = load_dotenv_values()
    return _state.dotenv_values.get(env_name)


def load_dotenv_values() -> dict[str, str]:
    values: dict[str, str] = {}
    for path in dotenv_paths():
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            key, value = parse_dotenv_line(line)
            if key:
                values[key] = value
    return values


def dotenv_paths() -> list[Path]:
    backend_root = Path(__file__).resolve().parents[1]
    project_root = backend_root.parent
    return [project_root / ".env", backend_root / ".env"]


def parse_dotenv_line(line: str) -> tuple[str | None, str]:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None, ""

    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip().strip('"').strip("'")
    return key, value
