from __future__ import annotations

import json
import hashlib
import hmac
import os
import re
import time
import base64
import binascii
import importlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import httpx

try:
    psycopg = cast(Any, importlib.import_module("psycopg"))
except ModuleNotFoundError:  # pragma: no cover - optional runtime dependency
    psycopg = None

from app.models import ActivityEntry, ClientOut, PresenceOut, SessionOut, TaskLockOut, TaskOut, UserProfile


class ConflictError(Exception):
    pass


class NotFoundError(Exception):
    pass


class UnauthorizedError(Exception):
    pass


def _normalize_env_value(value: str) -> str:
    cleaned = (value or "").strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {'"', "'"}:
        cleaned = cleaned[1:-1].strip()
    return cleaned


def _get_env(*names: str, default: str = "") -> str:
    for name in names:
        value = _normalize_env_value(os.getenv(name) or "")
        if value:
            return value
    return default


def _get_env_by_suffix(*suffixes: str, default: str = "") -> str:
    if not suffixes:
        return default

    env_items = sorted(os.environ.items(), key=lambda item: item[0])
    for suffix in suffixes:
        expected = suffix.upper()
        for key, raw_value in env_items:
            if not key.upper().endswith(expected):
                continue
            value = _normalize_env_value(raw_value or "")
            if value:
                return value
    return default


def _get_env_compat(names: tuple[str, ...], suffixes: tuple[str, ...], default: str = "") -> str:
    direct = _get_env(*names)
    if direct:
        return direct
    return _get_env_by_suffix(*suffixes, default=default)


def _get_env_compat_with_source(names: tuple[str, ...], suffixes: tuple[str, ...], default: str = "") -> tuple[str, str]:
    for name in names:
        value = _normalize_env_value(os.getenv(name) or "")
        if value:
            return value, name

    env_items = sorted(os.environ.items(), key=lambda item: item[0])
    for suffix in suffixes:
        expected = suffix.upper()
        for key, raw_value in env_items:
            if not key.upper().endswith(expected):
                continue
            value = _normalize_env_value(raw_value or "")
            if value:
                return value, key

    return default, ""


def _parse_int_env(value: str, fallback: int) -> int:
    try:
        return int(_normalize_env_value(value))
    except (TypeError, ValueError):
        return fallback


def _safe_identifier(value: str, fallback: str) -> str:
    candidate = (value or "").strip()
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", candidate):
        return candidate
    return fallback


class InMemoryStore:
    MAX_PERSISTED_TOMBSTONES = 4096
    SUPABASE_ADVISORY_LOCK_KEY = 71854051
    ROLE_ALIASES = {
        "admin": "Admin",
        "administrator": "Admin",
        "super admin": "Admin",
        "super_admin": "Admin",
        "system administrator": "Admin",
        "system_administrator": "Admin",
        "level 3": "Admin",
        "level3": "Admin",
        "manager": "Manager",
        "operations manager": "Manager",
        "operations_manager": "Manager",
        "level 2": "Manager",
        "level2": "Manager",
        "operator": "User",
        "operations specialist": "User",
        "operations_specialist": "User",
        "user": "User",
        "level 1": "User",
        "level1": "User",
    }

    @staticmethod
    def _coerce_id(value: Any) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @classmethod
    def _coerce_id_set(cls, value: Any) -> set[int]:
        parsed: set[int] = set()
        for item in cls._as_sequence(value):
            task_id = cls._coerce_id(item)
            if task_id is not None:
                parsed.add(task_id)
        if len(parsed) <= cls.MAX_PERSISTED_TOMBSTONES:
            return parsed
        return set(sorted(parsed)[-cls.MAX_PERSISTED_TOMBSTONES :])

    @staticmethod
    def _coerce_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "t", "yes", "y", "on"}
        return False

    @classmethod
    def _normalize_role(cls, value: Any) -> str:
        raw_role = str(value or "").strip().lower()
        return cls.ROLE_ALIASES.get(raw_role, "User")

    @classmethod
    def _normalize_user_record(cls, fallback_username: str, item: Any) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None

        payload = dict(cast(dict[str, Any], item))
        username = str(payload.get("username") or fallback_username or "").strip()
        if not username:
            return None

        name = str(payload.get("name") or username)
        initials_source = str(payload.get("initials") or name or username).strip()
        is_active_raw = payload.get("isActive") if "isActive" in payload else payload.get("is_active", True)
        return {
            "username": username,
            "passwordHash": str(payload.get("passwordHash") or payload.get("password_hash") or ""),
            "name": name,
            "role": cls._normalize_role(payload.get("role")),
            "initials": (initials_source[:1] or username[:1]).upper(),
            "department": str(payload.get("department") or ""),
            "timezone": str(payload.get("timezone") or "UTC"),
            "isActive": cls._coerce_bool(is_active_raw),
        }

    @classmethod
    def _user_profile_from_record(cls, user: dict[str, Any]) -> UserProfile:
        return UserProfile(
            username=str(user.get("username") or ""),
            name=str(user.get("name") or user.get("username") or ""),
            role=cls._normalize_role(user.get("role")),
            initials=str(user.get("initials") or user.get("username") or "?")[:1].upper(),
            department=str(user.get("department") or ""),
            timezone=str(user.get("timezone") or "UTC"),
            isActive=cls._coerce_bool(user.get("isActive", True)),
        )

    @staticmethod
    def _coerce_json_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return cast(dict[str, Any], value)
        if isinstance(value, str):
            try:
                parsed: Any = json.loads(value)
                if isinstance(parsed, dict):
                    return cast(dict[str, Any], parsed)
            except json.JSONDecodeError:
                return {}
        return {}

    @staticmethod
    def _parse_iso_datetime(value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and value.strip():
            raw = value.strip()
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            try:
                parsed = datetime.fromisoformat(raw)
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=UTC)
                return parsed
            except ValueError:
                pass
        return datetime.min.replace(tzinfo=UTC)

    def _resolve_username_key(self, username: str) -> str | None:
        candidate = str(username or "").strip()
        if not candidate:
            return None
        if candidate in self.users:
            return candidate

        lowered = candidate.lower()
        for existing in self.users.keys():
            if str(existing or "").strip().lower() == lowered:
                return existing
        return None

    @classmethod
    def _merge_tasks_payload(cls, local_tasks: list[dict[str, Any]], remote_tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged: dict[int, dict[str, Any]] = {}

        def ingest(candidate: dict[str, Any]) -> None:
            raw_id = candidate.get("id")
            if raw_id is None:
                return
            try:
                task_id = int(raw_id)
            except (TypeError, ValueError):
                return

            current = merged.get(task_id)
            if current is None:
                merged[task_id] = candidate
                return

            current_dt = cls._parse_iso_datetime(current.get("updatedAt"))
            candidate_dt = cls._parse_iso_datetime(candidate.get("updatedAt"))

            if candidate_dt > current_dt:
                merged[task_id] = candidate
                return

            if candidate_dt == current_dt:
                current_version = _parse_int_env(str(current.get("version", "1")), 1)
                candidate_version = _parse_int_env(str(candidate.get("version", "1")), 1)
                if candidate_version >= current_version:
                    merged[task_id] = candidate

        for task in remote_tasks:
            ingest(task)
        for task in local_tasks:
            ingest(task)

        return [merged[key] for key in sorted(merged.keys())]

    @staticmethod
    def _merge_clients_payload(local_clients: list[dict[str, Any]], remote_clients: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged: dict[int, dict[str, Any]] = {}

        def ingest(candidate: dict[str, Any]) -> None:
            raw_id = candidate.get("id")
            if raw_id is None:
                return
            try:
                client_id = int(raw_id)
            except (TypeError, ValueError):
                return

            current = merged.get(client_id)
            if current is None:
                merged[client_id] = candidate
                return

            current_version = _parse_int_env(str(current.get("version", "1")), 1)
            candidate_version = _parse_int_env(str(candidate.get("version", "1")), 1)
            if candidate_version >= current_version:
                merged[client_id] = candidate

        for client in remote_clients:
            ingest(client)
        for client in local_clients:
            ingest(client)

        return [merged[key] for key in sorted(merged.keys())]

    @staticmethod
    def _as_sequence(value: Any) -> list[Any]:
        if isinstance(value, list):
            return cast(list[Any], value)
        if isinstance(value, dict):
            # Legacy payloads may store collections as keyed objects.
            return list(cast(dict[str, Any], value).values())
        return []

    @staticmethod
    def _coerce_task_payload(item: Any) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None

        payload: dict[str, Any] = dict(cast(dict[str, Any], item))
        now_iso = datetime.now(UTC).isoformat()

        task_id = payload.get("id")
        if task_id is None:
            return None
        try:
            payload["id"] = int(task_id)
        except (TypeError, ValueError):
            return None

        payload["createdBy"] = payload.get("createdBy") or payload.get("staff") or "System"
        payload["version"] = _parse_int_env(str(payload.get("version", "1")), 1)

        created_at = payload.get("createdAt") or payload.get("updatedAt") or now_iso
        updated_at = payload.get("updatedAt") or payload.get("createdAt") or now_iso
        payload["createdAt"] = created_at
        payload["updatedAt"] = updated_at
        payload["operationalCategory"] = str(payload.get("operationalCategory") or "")

        approval_status = str(payload.get("approvalStatus") or "Pending")
        if approval_status not in {"Pending", "Approved", "Rejected", "Not Required"}:
            approval_status = "Pending"
        payload["approvalStatus"] = approval_status

        approved_by = str(payload.get("approvedBy") or "").strip()
        payload["approvedBy"] = approved_by or None
        payload["approvedAt"] = payload.get("approvedAt") or None

        activity_log = payload.get("activityLog")
        if not isinstance(activity_log, list):
            payload["activityLog"] = [
                {
                    "action": "Task migrated",
                    "user": "System",
                    "timestamp": updated_at,
                }
            ]

        return payload

    @staticmethod
    def _coerce_client_payload(item: Any, fallback_id: int) -> dict[str, Any] | None:
        if isinstance(item, str):
            return {
                "id": fallback_id,
                "name": item,
                "contact": "",
                "email": "",
                "phone": "",
                "version": 1,
            }
        if not isinstance(item, dict):
            return None

        payload: dict[str, Any] = dict(cast(dict[str, Any], item))
        if not payload.get("name"):
            return None

        try:
            payload["id"] = int(payload.get("id", fallback_id))
        except (TypeError, ValueError):
            payload["id"] = fallback_id

        payload["version"] = _parse_int_env(str(payload.get("version", "1")), 1)
        payload["contact"] = payload.get("contact") or ""
        payload["email"] = payload.get("email") or ""
        payload["phone"] = payload.get("phone") or ""
        return payload

    @staticmethod
    def _coerce_session_payload(item: Any) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None

        payload: dict[str, Any] = dict(cast(dict[str, Any], item))
        session_id = str(payload.get("id") or "").strip()
        username = str(payload.get("username") or "").strip()
        if not session_id or not username:
            return None

        payload["id"] = session_id
        payload["username"] = username
        payload["durationSeconds"] = _parse_int_env(str(payload.get("durationSeconds", 0)), 0)
        payload["activeSeconds"] = _parse_int_env(str(payload.get("activeSeconds", 0)), 0)
        payload["idleSeconds"] = _parse_int_env(str(payload.get("idleSeconds", 0)), 0)
        payload["projectTag"] = str(payload.get("projectTag") or "")
        payload["operationalCategory"] = str(payload.get("operationalCategory") or "")
        payload["billableSeconds"] = _parse_int_env(str(payload.get("billableSeconds", 0)), 0)
        payload["administrativeSeconds"] = _parse_int_env(str(payload.get("administrativeSeconds", 0)), 0)
        return payload

    def __init__(self) -> None:
        default_state_file = Path(__file__).resolve().parent.parent / "data" / "state_store.json"
        # Vercel's project filesystem is read-only at runtime; /tmp is writable per instance.
        if os.getenv("VERCEL"):
            self.state_file = Path("/tmp") / "state_store.json"
        else:
            self.state_file = default_state_file
        self.state_driver_note = ""
        self.env_debug: dict[str, str] = {}
        self.last_remote_bootstrap_error = ""

        raw_driver, driver_source = _get_env_compat_with_source(
            names=(
                "WERUNOPS_STATE_DRIVER",
                "NEXT_PUBLIC_WERUNOPS_STATE_DRIVER",
                "werunops_kanbanboard_supabase_WERUNOPS_STATE_DRIVER",
            ),
            suffixes=("_WERUNOPS_STATE_DRIVER", "_NEXT_PUBLIC_WERUNOPS_STATE_DRIVER"),
            default="",
        )
        self.state_driver = raw_driver.lower()
        self.env_debug["stateDriverSource"] = driver_source or ""

        self.supabase_url, supabase_url_source = _get_env_compat_with_source(
            names=(
                "SUPABASE_URL",
                "NEXT_PUBLIC_SUPABASE_URL",
                "NEXT_PUBLIC_werunops_kanbanboard_supabase_SUPABASE_URL",
                "werunops_kanbanboard_supabase_SUPABASE_URL",
                "SUPABASE_PROJECT_URL",
            ),
            suffixes=(
                "_SUPABASE_URL",
                "_NEXT_PUBLIC_SUPABASE_URL",
                "_SUPABASE_PROJECT_URL",
                "_SUPABASE_PROJECT_API_URL",
                "_PROJECT_URL",
            ),
            default="",
        )
        self.supabase_url = self.supabase_url.rstrip("/")
        self.env_debug["supabaseUrlSource"] = supabase_url_source or ""

        self.supabase_key, supabase_key_source = _get_env_compat_with_source(
            names=(
                "SUPABASE_SERVICE_ROLE_KEY",
                "SUPABASE_SECRET_KEY",
                "werunops_kanbanboard_supabase_SUPABASE_SERVICE_ROLE_KEY",
                "werunops_kanbanboard_supabase_SUPABASE_SECRET_KEY",
                "SUPABASE_SERVICE_KEY",
                "SUPABASE_KEY",
            ),
            suffixes=(
                "_SUPABASE_SERVICE_ROLE_KEY",
                "_SUPABASE_SECRET_KEY",
                "_SUPABASE_SERVICE_KEY",
                "_SUPABASE_KEY",
            ),
            default="",
        )
        self.env_debug["supabaseKeySource"] = supabase_key_source or ""

        self.supabase_table, supabase_table_source = _get_env_compat_with_source(
            names=("SUPABASE_STATE_TABLE",),
            suffixes=("_SUPABASE_STATE_TABLE",),
            default="werunops_state",
        )
        self.env_debug["supabaseTableSource"] = supabase_table_source or "default"
        self.supabase_table = _safe_identifier(self.supabase_table, "werunops_state")

        supabase_row_id_raw, supabase_row_id_source = _get_env_compat_with_source(
            names=("SUPABASE_STATE_ROW_ID",),
            suffixes=("_SUPABASE_STATE_ROW_ID",),
            default="1",
        )
        self.env_debug["supabaseRowIdSource"] = supabase_row_id_source or "default"
        self.supabase_row_id = _parse_int_env(
            supabase_row_id_raw,
            1,
        )

        storage_mode_raw, storage_mode_source = _get_env_compat_with_source(
            names=("SUPABASE_STORAGE_MODE",),
            suffixes=("_SUPABASE_STORAGE_MODE",),
            default="",
        )
        storage_mode = storage_mode_raw.strip().lower()
        if storage_mode in {"relational", "singleton"}:
            self.supabase_storage_mode = storage_mode
        else:
            self.supabase_storage_mode = ""
        self.env_debug["supabaseStorageModeSource"] = storage_mode_source or "auto"

        supabase_prefix_raw, supabase_prefix_source = _get_env_compat_with_source(
            names=("SUPABASE_RELATIONAL_PREFIX",),
            suffixes=("_SUPABASE_RELATIONAL_PREFIX",),
            default="werunops",
        )
        self.supabase_relational_prefix = _safe_identifier(supabase_prefix_raw, "werunops")
        self.env_debug["supabaseRelationalPrefixSource"] = supabase_prefix_source or "default"

        self.supabase_postgres_url, supabase_postgres_source = _get_env_compat_with_source(
            names=(
                "SUPABASE_POSTGRES_URL_NON_POOLING",
                "SUPABASE_POSTGRES_URL",
                "werunops_kanbanboard_supabase_POSTGRES_URL_NON_POOLING",
                "werunops_kanbanboard_supabase_POSTGRES_URL",
                "SUPABASE_DB_URL",
                "DATABASE_URL",
                "POSTGRES_URL_NON_POOLING",
                "POSTGRES_URL",
            ),
            suffixes=(
                "_SUPABASE_POSTGRES_URL_NON_POOLING",
                "_SUPABASE_POSTGRES_URL",
                "_SUPABASE_DB_URL",
                "_DATABASE_URL",
                "_POSTGRES_URL_NON_POOLING",
                "_POSTGRES_URL",
            ),
            default="",
        )
        self.env_debug["supabasePostgresUrlSource"] = supabase_postgres_source or ""

        if not self.supabase_storage_mode:
            self.supabase_storage_mode = "relational" if (self.supabase_postgres_url and psycopg is not None) else "singleton"

        if self.supabase_storage_mode == "relational" and (not self.supabase_postgres_url or psycopg is None):
            self.supabase_storage_mode = "singleton"
            self.state_driver_note = "supabase relational mode unavailable; falling back to singleton payload mode"

        self.firebase_url = _get_env_compat(
            names=("FIREBASE_DATABASE_URL",),
            suffixes=("_FIREBASE_DATABASE_URL",),
            default="",
        ).rstrip("/")
        self.firebase_auth_secret = _get_env_compat(
            names=("FIREBASE_AUTH_SECRET",),
            suffixes=("_FIREBASE_AUTH_SECRET",),
            default="",
        )
        self.token_secret = (
            _get_env_compat(
                names=("WERUNOPS_TOKEN_SECRET",),
                suffixes=("_WERUNOPS_TOKEN_SECRET",),
                default="",
            )
            or self.supabase_key
            or self.firebase_auth_secret
            or "werunops-dev-token-secret"
        )
        raw_path = _get_env_compat(
            names=("FIREBASE_STATE_PATH",),
            suffixes=("_FIREBASE_STATE_PATH",),
            default="werunops_state",
        ).strip("/")
        # Restrict path to safe characters to prevent path traversal.
        self.firebase_state_path = raw_path if re.fullmatch(r"[A-Za-z0-9_\-/]+", raw_path) else "werunops_state"

        if not self.state_driver:
            if self.firebase_url and self.firebase_auth_secret:
                self.state_driver = "firebase"
                self.state_driver_note = "auto-detected firebase credentials"
            elif self.supabase_url and self.supabase_key:
                self.state_driver = "supabase"
                self.state_driver_note = "auto-detected supabase credentials"
            else:
                self.state_driver = "file"
                self.state_driver_note = "no backend credentials found; using file mode"

        if self.state_driver == "supabase" and (not self.supabase_url or not self.supabase_key):
            # Fall back to file mode if Supabase credentials are missing.
            self.state_driver = "file"
            self.state_driver_note = "supabase selected but URL or service key missing"

        if self.state_driver == "firebase" and not self.firebase_url:
            # Fall back to file mode if Firebase URL is missing.
            self.state_driver = "file"
            self.state_driver_note = "firebase selected but database URL missing"

        self.users: dict[str, dict[str, Any]] = {
            "Eshwar": {
                "username": "Eshwar",
                "passwordHash": "f91b043302878951ce9258214033bd206ea0a92bb88931ba8bb6edb01b57d020",
                "name": "Pritheeswarar",
                "role": "Admin",
                "initials": "P",
                "department": "Leadership",
                "timezone": "Asia/Kolkata",
                "isActive": True,
            },
            "Mubarak": {
                "username": "Mubarak",
                "passwordHash": "23fece5f1a2a4452cba0113271736a16d241201bef2fd15b72819582e13fb267",
                "name": "Mubarak",
                "role": "Manager",
                "initials": "M",
                "department": "Operations",
                "timezone": "Asia/Kolkata",
                "isActive": True,
            },
            "Sudhar": {
                "username": "Sudhar",
                "passwordHash": "56e89b1d6436fc86deea34dbb0306af59c40d29f20bc20b6efcb001cee9ae71b",
                "name": "Sudharshan",
                "role": "User",
                "initials": "S",
                "department": "Delivery",
                "timezone": "Asia/Kolkata",
                "isActive": True,
            },
        }
        self.tasks: dict[int, TaskOut] = {}
        self.clients: dict[int, ClientOut] = {}

        if self.state_driver == "file":
            now = datetime.now(UTC)
            self.tasks = {
                1: TaskOut(
                    id=1,
                    client="JS Roofing",
                    project="House 12",
                    task="Create PO fascia",
                    staff="Mubarak",
                    status="In Progress",
                    priority="High",
                    startDate="2026-03-09",
                    dueDate=now.date().isoformat(),
                    waitingFor="Supplier",
                    notes="Waiting for supplier pricing",
                    parentId=None,
                    createdAt=now,
                    updatedAt=now,
                    createdBy="Pritheeswarar",
                    activityLog=[ActivityEntry(action="Task created", user="Pritheeswarar", timestamp=now)],
                    version=1,
                )
            }
            self.clients = {
                1: ClientOut(id=1, name="JS Roofing", contact="John Smith", email="john@jsroofing.com", phone="555-0100", version=1),
                2: ClientOut(id=2, name="A to Z Roofing", contact="Alice", email="alice@atoz.com", phone="555-0101", version=1),
            }
        self.presence: dict[str, PresenceOut] = {}
        self.sessions: dict[str, SessionOut] = {}
        self.task_locks: dict[int, TaskLockOut] = {}
        self.admin_audit_logs: list[dict[str, Any]] = []
        self.saved_filter_sets: list[dict[str, Any]] = []
        self.automation_rules: list[dict[str, Any]] = [
            {
                "id": "rule_daily_standup",
                "name": "Daily Standup Reminder",
                "enabled": True,
                "trigger": "weekday_0900",
                "action": "notify_all_users",
            },
            {
                "id": "rule_overdue_alert",
                "name": "Overdue High Priority Alert",
                "enabled": True,
                "trigger": "task_overdue_high",
                "action": "notify_admin",
            },
        ]
        self.task_comments: dict[int, list[dict[str, Any]]] = {}
        self.next_task_id = 2 if self.state_driver == "file" else 1
        self.next_client_id = 3 if self.state_driver == "file" else 1
        self._last_remote_refresh_monotonic = 0.0
        self._deleted_task_ids: set[int] = set()
        self._deleted_client_ids: set[int] = set()
        self._restored_task_ids: set[int] = set()
        self._restored_client_ids: set[int] = set()
        try:
            self._load_state()
        except Exception as error:
            # Keep API alive even when remote state bootstrap fails.
            self.state_driver = "file"
            self.last_remote_bootstrap_error = str(error)
            self.state_driver_note = f"remote state bootstrap failed; fell back to file mode ({self.last_remote_bootstrap_error})"
            self._load_state()

        self.env_debug["stateDriver"] = self.state_driver
        self.env_debug["supabaseUrlPresent"] = str(bool(self.supabase_url)).lower()
        self.env_debug["supabaseKeyPresent"] = str(bool(self.supabase_key)).lower()
        self.env_debug["supabasePostgresUrlPresent"] = str(bool(self.supabase_postgres_url)).lower()
        self.env_debug["supabaseTable"] = self.supabase_table
        self.env_debug["supabaseRowId"] = str(self.supabase_row_id)
        self.env_debug["supabaseStorageMode"] = self.supabase_storage_mode
        self.env_debug["supabaseRelationalPrefix"] = self.supabase_relational_prefix
        self.env_debug["lastRemoteBootstrapError"] = self.last_remote_bootstrap_error

    def _supabase_headers(self) -> dict[str, str]:
        return {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def _supabase_endpoint(self) -> str:
        return f"{self.supabase_url}/rest/v1/{self.supabase_table}"

    def _supabase_postgres_conninfo(self) -> str:
        conninfo = self.supabase_postgres_url
        if "connect_timeout=" not in conninfo:
            separator = "&" if "?" in conninfo else "?"
            conninfo = f"{conninfo}{separator}connect_timeout=10"
        return conninfo

    def _supabase_rel_table(self, suffix: str) -> str:
        return f"{self.supabase_relational_prefix}_{suffix}"

    def _bootstrap_supabase_relational_storage(self) -> bool:
        if not self.supabase_postgres_url:
            self.state_driver_note = "supabase relational mode missing postgres URL"
            return False
        if psycopg is None:
            self.state_driver_note = "supabase relational mode unavailable; psycopg not installed"
            return False

        users_table = self._supabase_rel_table("users")
        clients_table = self._supabase_rel_table("clients")
        tasks_table = self._supabase_rel_table("tasks")
        task_activity_table = self._supabase_rel_table("task_activity")
        presence_table = self._supabase_rel_table("presence")
        sessions_table = self._supabase_rel_table("sessions")
        locks_table = self._supabase_rel_table("task_locks")
        audit_table = self._supabase_rel_table("admin_audit_logs")
        saved_filters_table = self._supabase_rel_table("saved_filters")
        rules_table = self._supabase_rel_table("automation_rules")
        comments_table = self._supabase_rel_table("task_comments")
        deleted_tasks_table = self._supabase_rel_table("deleted_tasks")
        deleted_clients_table = self._supabase_rel_table("deleted_clients")
        meta_table = self._supabase_rel_table("state_meta")

        try:
            with psycopg.connect(self._supabase_postgres_conninfo()) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        f"""
                        create table if not exists public.{users_table} (
                          username text primary key,
                          password_hash text not null,
                          name text not null,
                          role text not null,
                          initials text not null
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{users_table}
                        add column if not exists department text not null default ''
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{users_table}
                        add column if not exists timezone text not null default 'UTC'
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{users_table}
                        add column if not exists is_active boolean not null default true
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{clients_table} (
                          id bigint primary key,
                          name text not null,
                          contact text not null default '',
                          email text not null default '',
                          phone text not null default '',
                          version integer not null default 1
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{tasks_table} (
                          id bigint primary key,
                          client text not null,
                          project text not null default '',
                          task text not null,
                          staff text not null,
                          status text not null,
                          priority text not null,
                          start_date text not null default '',
                          due_date text not null default '',
                          waiting_for text not null default '',
                          notes text not null default '',
                          parent_id bigint,
                          created_at timestamptz not null,
                          updated_at timestamptz not null,
                          created_by text not null,
                          version integer not null default 1
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{tasks_table}
                        add column if not exists operational_category text not null default ''
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{tasks_table}
                        add column if not exists approval_status text not null default 'Pending'
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{tasks_table}
                        add column if not exists approved_by text
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{tasks_table}
                        add column if not exists approved_at timestamptz
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{task_activity_table} (
                          task_id bigint not null,
                          seq integer not null,
                          action text not null,
                          user_name text not null,
                          timestamp timestamptz not null,
                          primary key (task_id, seq),
                          foreign key (task_id) references public.{tasks_table}(id) on delete cascade
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{presence_table} (
                          username text primary key,
                          online boolean not null,
                          status text not null default 'online',
                          last_seen timestamptz not null,
                          browser text,
                          device text
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{presence_table}
                        add column if not exists status text not null default 'online'
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{sessions_table} (
                          id text primary key,
                          username text not null,
                          login_time timestamptz not null,
                          logout_time timestamptz,
                          duration_seconds integer not null default 0,
                          active_seconds integer not null default 0,
                          idle_seconds integer not null default 0,
                          browser text,
                          device text
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{sessions_table}
                        add column if not exists project_tag text not null default ''
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{sessions_table}
                        add column if not exists operational_category text not null default ''
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{sessions_table}
                        add column if not exists billable_seconds integer not null default 0
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{sessions_table}
                        add column if not exists administrative_seconds integer not null default 0
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{locks_table} (
                          task_id bigint primary key,
                          locked_by text not null,
                          locked_by_name text not null,
                          acquired_at timestamptz not null,
                          expires_at timestamptz not null
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{audit_table} (
                          seq integer primary key,
                          timestamp timestamptz not null,
                          admin text,
                          admin_name text,
                          action text not null,
                          details_json jsonb not null default '{{}}'::jsonb
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{saved_filters_table} (
                          name text primary key,
                          filters_json jsonb not null default '{{}}'::jsonb,
                          position integer not null default 0,
                          saved_at timestamptz,
                          saved_by text
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        alter table public.{saved_filters_table}
                        add column if not exists position integer not null default 0
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{rules_table} (
                          id text primary key,
                          name text not null,
                          trigger text not null,
                          action text not null,
                          enabled boolean not null default true,
                          position integer not null default 0,
                          metadata_json jsonb not null default '{{}}'::jsonb
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{comments_table} (
                          task_id bigint not null,
                          seq integer not null,
                          id text not null,
                          comment text not null,
                          user_name text not null,
                          username text,
                          timestamp timestamptz not null,
                          primary key (task_id, seq)
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{deleted_tasks_table} (
                          task_id bigint primary key,
                          deleted_at timestamptz not null default now()
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{deleted_clients_table} (
                          client_id bigint primary key,
                          deleted_at timestamptz not null default now()
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        create table if not exists public.{meta_table} (
                          key text primary key,
                          value_text text not null
                        )
                        """
                    )

                    cursor.execute(f"select 1 from public.{users_table} limit 1")
                    has_rows = cursor.fetchone() is not None
                    if not has_rows:
                        cursor.execute("select to_regclass(%s)", (f"public.{self.supabase_table}",))
                        legacy_relation = cursor.fetchone()
                        if legacy_relation and legacy_relation[0]:
                            cursor.execute(
                                f"select payload from public.{self.supabase_table} where id = %s limit 1",
                                (self.supabase_row_id,),
                            )
                            legacy_row = cursor.fetchone()
                            if legacy_row and isinstance(legacy_row[0], dict):
                                self._write_relational_payload(cursor, cast(dict[str, Any], legacy_row[0]))
                                self.state_driver_note = "auto-migrated legacy singleton state into relational tables"

            self.state_driver_note = "supabase relational storage ready"
            return True
        except Exception as error:
            self.state_driver_note = f"supabase relational bootstrap failed ({error})"
            return False

    def _write_relational_payload(self, cursor: Any, payload: dict[str, Any]) -> None:
        users_table = self._supabase_rel_table("users")
        clients_table = self._supabase_rel_table("clients")
        tasks_table = self._supabase_rel_table("tasks")
        task_activity_table = self._supabase_rel_table("task_activity")
        presence_table = self._supabase_rel_table("presence")
        sessions_table = self._supabase_rel_table("sessions")
        locks_table = self._supabase_rel_table("task_locks")
        audit_table = self._supabase_rel_table("admin_audit_logs")
        saved_filters_table = self._supabase_rel_table("saved_filters")
        rules_table = self._supabase_rel_table("automation_rules")
        comments_table = self._supabase_rel_table("task_comments")
        deleted_tasks_table = self._supabase_rel_table("deleted_tasks")
        deleted_clients_table = self._supabase_rel_table("deleted_clients")
        meta_table = self._supabase_rel_table("state_meta")

        cursor.execute(f"delete from public.{task_activity_table}")
        cursor.execute(f"delete from public.{comments_table}")
        cursor.execute(f"delete from public.{locks_table}")
        cursor.execute(f"delete from public.{sessions_table}")
        cursor.execute(f"delete from public.{presence_table}")
        cursor.execute(f"delete from public.{tasks_table}")
        cursor.execute(f"delete from public.{clients_table}")
        cursor.execute(f"delete from public.{users_table}")
        cursor.execute(f"delete from public.{audit_table}")
        cursor.execute(f"delete from public.{saved_filters_table}")
        cursor.execute(f"delete from public.{rules_table}")
        cursor.execute(f"delete from public.{deleted_tasks_table}")
        cursor.execute(f"delete from public.{deleted_clients_table}")
        cursor.execute(f"delete from public.{meta_table} where key in ('next_task_id', 'next_client_id')")

        users_source_raw = payload.get("users", {})
        users_source: dict[str, Any] = cast(dict[str, Any], users_source_raw) if isinstance(users_source_raw, dict) else {}
        if users_source:
            for fallback_username, raw_user in sorted(users_source.items(), key=lambda item: str(item[0] or "")):
                user = self._normalize_user_record(str(fallback_username or ""), raw_user)
                if not user:
                    continue
                cursor.execute(
                    f"""
                    insert into public.{users_table} (
                      username, password_hash, name, role, initials, department, timezone, is_active
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user["username"],
                        str(user.get("passwordHash") or ""),
                        str(user.get("name") or user["username"]),
                        self._normalize_role(user.get("role")),
                        str(user.get("initials") or user["username"][:1].upper()),
                        str(user.get("department") or ""),
                        str(user.get("timezone") or "UTC"),
                        self._coerce_bool(user.get("isActive", True)),
                    ),
                )

        clients_source = self._as_sequence(payload.get("clients", []))
        for raw_client in clients_source:
            if not isinstance(raw_client, dict):
                continue
            client = cast(dict[str, Any], raw_client)
            client_id = self._coerce_id(client.get("id"))
            if client_id is None:
                continue
            cursor.execute(
                f"""
                insert into public.{clients_table} (id, name, contact, email, phone, version)
                values (%s, %s, %s, %s, %s, %s)
                """,
                (
                    client_id,
                    str(client.get("name") or ""),
                    str(client.get("contact") or ""),
                    str(client.get("email") or ""),
                    str(client.get("phone") or ""),
                    _parse_int_env(str(client.get("version", 1)), 1),
                ),
            )

        tasks_source = self._as_sequence(payload.get("tasks", []))
        for raw_task in tasks_source:
            task = self._coerce_task_payload(raw_task)
            if not task:
                continue
            task_id = self._coerce_id(task.get("id"))
            if task_id is None:
                continue
            parent_id = self._coerce_id(task.get("parentId"))
            approved_at_raw = task.get("approvedAt")
            cursor.execute(
                f"""
                insert into public.{tasks_table} (
                  id, client, project, task, staff, status, priority,
                  start_date, due_date, waiting_for, notes, parent_id,
                  operational_category, approval_status, approved_by, approved_at,
                  created_at, updated_at, created_by, version
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    task_id,
                    str(task.get("client") or ""),
                    str(task.get("project") or ""),
                    str(task.get("task") or ""),
                    str(task.get("staff") or ""),
                    str(task.get("status") or "New"),
                    str(task.get("priority") or "Medium"),
                    str(task.get("startDate") or ""),
                    str(task.get("dueDate") or ""),
                    str(task.get("waitingFor") or ""),
                    str(task.get("notes") or ""),
                    parent_id,
                    str(task.get("operationalCategory") or ""),
                    str(task.get("approvalStatus") or "Pending"),
                    str(task.get("approvedBy") or "") or None,
                    self._parse_iso_datetime(approved_at_raw) if approved_at_raw else None,
                    self._parse_iso_datetime(task.get("createdAt")),
                    self._parse_iso_datetime(task.get("updatedAt")),
                    str(task.get("createdBy") or "System"),
                    _parse_int_env(str(task.get("version", 1)), 1),
                ),
            )

            activity_source = self._as_sequence(task.get("activityLog", []))
            for seq, raw_activity in enumerate(activity_source):
                if not isinstance(raw_activity, dict):
                    continue
                activity = cast(dict[str, Any], raw_activity)
                cursor.execute(
                    f"""
                    insert into public.{task_activity_table} (task_id, seq, action, user_name, timestamp)
                    values (%s, %s, %s, %s, %s)
                    """,
                    (
                        task_id,
                        seq,
                        str(activity.get("action") or ""),
                        str(activity.get("user") or ""),
                        self._parse_iso_datetime(activity.get("timestamp")),
                    ),
                )

        presence_source = self._as_sequence(payload.get("presence", []))
        for raw_presence in presence_source:
            if not isinstance(raw_presence, dict):
                continue
            presence = cast(dict[str, Any], raw_presence)
            username = str(presence.get("username") or "").strip()
            if not username:
                continue
            cursor.execute(
                f"""
                insert into public.{presence_table} (username, online, status, last_seen, browser, device)
                values (%s, %s, %s, %s, %s, %s)
                """,
                (
                    username,
                    self._coerce_bool(presence.get("online")),
                    str(presence.get("status") or "online"),
                    self._parse_iso_datetime(presence.get("lastSeen")),
                    str(presence.get("browser") or "") or None,
                    str(presence.get("device") or "") or None,
                ),
            )

        sessions_source = self._as_sequence(payload.get("sessions", []))
        for raw_session in sessions_source:
            session = self._coerce_session_payload(raw_session)
            if not session:
                continue
            session_id = str(session.get("id") or "").strip()
            username = str(session.get("username") or "").strip()
            if not session_id or not username:
                continue
            logout_time_raw = session.get("logoutTime")
            cursor.execute(
                f"""
                insert into public.{sessions_table} (
                  id, username, login_time, logout_time, duration_seconds,
                  active_seconds, idle_seconds, browser, device,
                  project_tag, operational_category, billable_seconds, administrative_seconds
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    session_id,
                    username,
                    self._parse_iso_datetime(session.get("loginTime")),
                    self._parse_iso_datetime(logout_time_raw) if logout_time_raw else None,
                    _parse_int_env(str(session.get("durationSeconds", 0)), 0),
                    _parse_int_env(str(session.get("activeSeconds", 0)), 0),
                    _parse_int_env(str(session.get("idleSeconds", 0)), 0),
                    str(session.get("browser") or "") or None,
                    str(session.get("device") or "") or None,
                    str(session.get("projectTag") or ""),
                    str(session.get("operationalCategory") or ""),
                    _parse_int_env(str(session.get("billableSeconds", 0)), 0),
                    _parse_int_env(str(session.get("administrativeSeconds", 0)), 0),
                ),
            )

        locks_source = self._as_sequence(payload.get("task_locks", []))
        for raw_lock in locks_source:
            if not isinstance(raw_lock, dict):
                continue
            lock = cast(dict[str, Any], raw_lock)
            task_id = self._coerce_id(lock.get("taskId"))
            if task_id is None:
                continue
            cursor.execute(
                f"""
                insert into public.{locks_table} (task_id, locked_by, locked_by_name, acquired_at, expires_at)
                values (%s, %s, %s, %s, %s)
                """,
                (
                    task_id,
                    str(lock.get("lockedBy") or ""),
                    str(lock.get("lockedByName") or ""),
                    self._parse_iso_datetime(lock.get("acquiredAt")),
                    self._parse_iso_datetime(lock.get("expiresAt")),
                ),
            )

        audit_source = self._as_sequence(payload.get("admin_audit_logs", []))
        for seq, raw_audit in enumerate(audit_source):
            if not isinstance(raw_audit, dict):
                continue
            audit = cast(dict[str, Any], raw_audit)
            details_raw = audit.get("details")
            details = cast(dict[str, Any], details_raw) if isinstance(details_raw, dict) else {}
            cursor.execute(
                f"""
                insert into public.{audit_table} (seq, timestamp, admin, admin_name, action, details_json)
                values (%s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    seq,
                    self._parse_iso_datetime(audit.get("timestamp")),
                    str(audit.get("admin") or "") or None,
                    str(audit.get("adminName") or "") or None,
                    str(audit.get("action") or ""),
                    json.dumps(details),
                ),
            )

        filters_source = self._as_sequence(payload.get("saved_filter_sets", []))
        for seq, raw_filter in enumerate(filters_source):
            if not isinstance(raw_filter, dict):
                continue
            saved_filter = cast(dict[str, Any], raw_filter)
            name = str(saved_filter.get("name") or "").strip()
            if not name:
                continue
            filters_raw = saved_filter.get("filters")
            filters = cast(dict[str, Any], filters_raw) if isinstance(filters_raw, dict) else {}
            saved_at = saved_filter.get("savedAt")
            cursor.execute(
                f"""
                insert into public.{saved_filters_table} (name, filters_json, position, saved_at, saved_by)
                values (%s, %s::jsonb, %s, %s, %s)
                """,
                (
                    name,
                    json.dumps(filters),
                    seq,
                    self._parse_iso_datetime(saved_at) if saved_at else None,
                    str(saved_filter.get("savedBy") or "") or None,
                ),
            )

        rules_source = self._as_sequence(payload.get("automation_rules", []))
        for seq, raw_rule in enumerate(rules_source):
            if not isinstance(raw_rule, dict):
                continue
            rule = cast(dict[str, Any], raw_rule)
            rule_id = str(rule.get("id") or "").strip() or f"rule_{seq}"
            metadata = {key: value for key, value in rule.items() if key not in {"id", "name", "trigger", "action", "enabled"}}
            cursor.execute(
                f"""
                insert into public.{rules_table} (id, name, trigger, action, enabled, position, metadata_json)
                values (%s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    rule_id,
                    str(rule.get("name") or rule_id),
                    str(rule.get("trigger") or "manual"),
                    str(rule.get("action") or "none"),
                    self._coerce_bool(rule.get("enabled", True)),
                    seq,
                    json.dumps(metadata),
                ),
            )

        comments_source = payload.get("task_comments", {})
        if isinstance(comments_source, dict):
            for raw_task_id, raw_bucket in cast(dict[Any, Any], comments_source).items():
                task_id = self._coerce_id(raw_task_id)
                if task_id is None:
                    continue
                bucket = self._as_sequence(raw_bucket)
                for seq, raw_comment in enumerate(bucket):
                    if not isinstance(raw_comment, dict):
                        continue
                    comment = cast(dict[str, Any], raw_comment)
                    cursor.execute(
                        f"""
                        insert into public.{comments_table} (task_id, seq, id, comment, user_name, username, timestamp)
                        values (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            task_id,
                            seq,
                            str(comment.get("id") or f"c_{task_id}_{seq}"),
                            str(comment.get("comment") or ""),
                            str(comment.get("user") or ""),
                            str(comment.get("username") or "") or None,
                            self._parse_iso_datetime(comment.get("timestamp")),
                        ),
                    )

        for task_id in sorted(self._coerce_id_set(payload.get("deleted_task_ids", []))):
            cursor.execute(
                f"insert into public.{deleted_tasks_table} (task_id) values (%s)",
                (task_id,),
            )

        for client_id in sorted(self._coerce_id_set(payload.get("deleted_client_ids", []))):
            cursor.execute(
                f"insert into public.{deleted_clients_table} (client_id) values (%s)",
                (client_id,),
            )

        next_task_id = _parse_int_env(str(payload.get("next_task_id", 1)), 1)
        next_client_id = _parse_int_env(str(payload.get("next_client_id", 1)), 1)
        cursor.execute(
            f"insert into public.{meta_table} (key, value_text) values (%s, %s)",
            ("next_task_id", str(next_task_id)),
        )
        cursor.execute(
            f"insert into public.{meta_table} (key, value_text) values (%s, %s)",
            ("next_client_id", str(next_client_id)),
        )

    def _load_state_from_supabase_relational(self) -> dict[str, Any] | None:
        if not self._bootstrap_supabase_relational_storage():
            raise RuntimeError("Supabase relational storage is not available")

        if psycopg is None:
            raise RuntimeError("psycopg is required for relational Supabase mode")

        users_table = self._supabase_rel_table("users")
        clients_table = self._supabase_rel_table("clients")
        tasks_table = self._supabase_rel_table("tasks")
        task_activity_table = self._supabase_rel_table("task_activity")
        presence_table = self._supabase_rel_table("presence")
        sessions_table = self._supabase_rel_table("sessions")
        locks_table = self._supabase_rel_table("task_locks")
        audit_table = self._supabase_rel_table("admin_audit_logs")
        saved_filters_table = self._supabase_rel_table("saved_filters")
        rules_table = self._supabase_rel_table("automation_rules")
        comments_table = self._supabase_rel_table("task_comments")
        deleted_tasks_table = self._supabase_rel_table("deleted_tasks")
        deleted_clients_table = self._supabase_rel_table("deleted_clients")
        meta_table = self._supabase_rel_table("state_meta")

        with psycopg.connect(self._supabase_postgres_conninfo()) as conn:
            with conn.cursor() as cursor:
                cursor.execute("select pg_advisory_xact_lock_shared(%s)", (self.SUPABASE_ADVISORY_LOCK_KEY,))

                cursor.execute(
                    f"""
                    select username, password_hash, name, role, initials, department, timezone, is_active
                    from public.{users_table}
                    order by username
                    """
                )
                users_rows = cursor.fetchall()
                users: dict[str, dict[str, Any]] = {}
                for username, password_hash, name, role, initials, department, timezone, is_active in users_rows:
                    normalized_user = self._normalize_user_record(
                        str(username or ""),
                        {
                            "username": username,
                            "passwordHash": password_hash,
                            "name": name,
                            "role": role,
                            "initials": initials,
                            "department": department,
                            "timezone": timezone,
                            "isActive": is_active,
                        },
                    )
                    if not normalized_user:
                        continue
                    users[normalized_user["username"]] = normalized_user

                cursor.execute(
                    f"select task_id, seq, action, user_name, timestamp from public.{task_activity_table} order by task_id, seq"
                )
                activity_rows = cursor.fetchall()
                activity_map: dict[int, list[dict[str, Any]]] = {}
                for task_id, _seq, action, user_name, timestamp in activity_rows:
                    task_key = int(task_id)
                    bucket = activity_map.setdefault(task_key, [])
                    bucket.append(
                        {
                            "action": str(action or ""),
                            "user": str(user_name or ""),
                            "timestamp": timestamp,
                        }
                    )

                cursor.execute(
                    f"""
                    select id, client, project, task, staff, status, priority,
                           start_date, due_date, waiting_for, notes, parent_id,
                           operational_category, approval_status, approved_by, approved_at,
                           created_at, updated_at, created_by, version
                    from public.{tasks_table}
                    order by id
                    """
                )
                task_rows = cursor.fetchall()
                tasks: list[dict[str, Any]] = []
                for (
                    task_id,
                    client,
                    project,
                    task_name,
                    staff,
                    status,
                    priority,
                    start_date,
                    due_date,
                    waiting_for,
                    notes,
                    parent_id,
                    operational_category,
                    approval_status,
                    approved_by,
                    approved_at,
                    created_at,
                    updated_at,
                    created_by,
                    version,
                ) in task_rows:
                    tasks.append(
                        {
                            "id": int(task_id),
                            "client": str(client or ""),
                            "project": str(project or ""),
                            "task": str(task_name or ""),
                            "staff": str(staff or ""),
                            "status": str(status or "New"),
                            "priority": str(priority or "Medium"),
                            "startDate": str(start_date or ""),
                            "dueDate": str(due_date or ""),
                            "waitingFor": str(waiting_for or ""),
                            "notes": str(notes or ""),
                            "parentId": self._coerce_id(parent_id),
                            "operationalCategory": str(operational_category or ""),
                            "approvalStatus": str(approval_status or "Pending"),
                            "approvedBy": str(approved_by or "") or None,
                            "approvedAt": approved_at,
                            "createdAt": created_at,
                            "updatedAt": updated_at,
                            "createdBy": str(created_by or "System"),
                            "version": _parse_int_env(str(version), 1),
                            "activityLog": activity_map.get(int(task_id), []),
                        }
                    )

                cursor.execute(
                    f"select id, name, contact, email, phone, version from public.{clients_table} order by id"
                )
                client_rows = cursor.fetchall()
                clients: list[dict[str, Any]] = [
                    {
                        "id": int(client_id),
                        "name": str(name or ""),
                        "contact": str(contact or ""),
                        "email": str(email or ""),
                        "phone": str(phone or ""),
                        "version": _parse_int_env(str(version), 1),
                    }
                    for client_id, name, contact, email, phone, version in client_rows
                ]

                cursor.execute(
                    f"select username, online, status, last_seen, browser, device from public.{presence_table} order by username"
                )
                presence_rows = cursor.fetchall()
                presence: list[dict[str, Any]] = [
                    {
                        "username": str(username or ""),
                        "online": self._coerce_bool(online),
                        "status": str(status or "online"),
                        "lastSeen": last_seen,
                        "browser": browser,
                        "device": device,
                    }
                    for username, online, status, last_seen, browser, device in presence_rows
                    if str(username or "").strip()
                ]

                cursor.execute(
                    f"""
                    select id, username, login_time, logout_time, duration_seconds,
                           active_seconds, idle_seconds, browser, device,
                           project_tag, operational_category, billable_seconds, administrative_seconds
                    from public.{sessions_table}
                    order by login_time desc
                    """
                )
                session_rows = cursor.fetchall()
                sessions: list[dict[str, Any]] = [
                    {
                        "id": str(session_id or ""),
                        "username": str(username or ""),
                        "loginTime": login_time,
                        "logoutTime": logout_time,
                        "durationSeconds": _parse_int_env(str(duration_seconds), 0),
                        "activeSeconds": _parse_int_env(str(active_seconds), 0),
                        "idleSeconds": _parse_int_env(str(idle_seconds), 0),
                        "browser": browser,
                        "device": device,
                        "projectTag": str(project_tag or ""),
                        "operationalCategory": str(operational_category or ""),
                        "billableSeconds": _parse_int_env(str(billable_seconds), 0),
                        "administrativeSeconds": _parse_int_env(str(administrative_seconds), 0),
                    }
                    for (
                        session_id,
                        username,
                        login_time,
                        logout_time,
                        duration_seconds,
                        active_seconds,
                        idle_seconds,
                        browser,
                        device,
                        project_tag,
                        operational_category,
                        billable_seconds,
                        administrative_seconds,
                    ) in session_rows
                    if str(session_id or "").strip() and str(username or "").strip()
                ]

                cursor.execute(
                    f"select task_id, locked_by, locked_by_name, acquired_at, expires_at from public.{locks_table} order by task_id"
                )
                lock_rows = cursor.fetchall()
                task_locks: list[dict[str, Any]] = [
                    {
                        "taskId": int(task_id),
                        "lockedBy": str(locked_by or ""),
                        "lockedByName": str(locked_by_name or ""),
                        "acquiredAt": acquired_at,
                        "expiresAt": expires_at,
                    }
                    for task_id, locked_by, locked_by_name, acquired_at, expires_at in lock_rows
                ]

                cursor.execute(
                    f"select seq, timestamp, admin, admin_name, action, details_json from public.{audit_table} order by seq"
                )
                audit_rows = cursor.fetchall()
                admin_audit_logs: list[dict[str, Any]] = []
                for _seq, timestamp, admin, admin_name, action, details_json in audit_rows:
                    admin_audit_logs.append(
                        {
                            "timestamp": timestamp.isoformat() if isinstance(timestamp, datetime) else str(timestamp or ""),
                            "admin": str(admin or ""),
                            "adminName": str(admin_name or ""),
                            "action": str(action or ""),
                            "details": self._coerce_json_dict(details_json),
                        }
                    )

                cursor.execute(
                    f"select name, filters_json, saved_at, saved_by from public.{saved_filters_table} order by position, saved_at desc"
                )
                filter_rows = cursor.fetchall()
                saved_filter_sets: list[dict[str, Any]] = []
                for name, filters_json, saved_at, saved_by in filter_rows:
                    saved_filter_sets.append(
                        {
                            "name": str(name or ""),
                            "filters": self._coerce_json_dict(filters_json),
                            "savedAt": saved_at.isoformat() if isinstance(saved_at, datetime) else "",
                            "savedBy": str(saved_by or ""),
                        }
                    )

                cursor.execute(
                    f"select id, name, trigger, action, enabled, metadata_json from public.{rules_table} order by position, id"
                )
                rule_rows = cursor.fetchall()
                automation_rules: list[dict[str, Any]] = []
                for rule_id, name, trigger, action, enabled, metadata_json in rule_rows:
                    metadata = self._coerce_json_dict(metadata_json)
                    entry: dict[str, Any] = {
                        "id": str(rule_id or ""),
                        "name": str(name or ""),
                        "trigger": str(trigger or ""),
                        "action": str(action or ""),
                        "enabled": self._coerce_bool(enabled),
                    }
                    entry.update(metadata)
                    automation_rules.append(entry)

                cursor.execute(
                    f"select task_id, id, comment, user_name, username, timestamp from public.{comments_table} order by task_id, seq"
                )
                comment_rows = cursor.fetchall()
                task_comments: dict[int, list[dict[str, Any]]] = {}
                for task_id, comment_id, comment, user_name, username, timestamp in comment_rows:
                    key = int(task_id)
                    bucket = task_comments.setdefault(key, [])
                    bucket.append(
                        {
                            "id": str(comment_id or ""),
                            "taskId": key,
                            "comment": str(comment or ""),
                            "user": str(user_name or ""),
                            "username": str(username or ""),
                            "timestamp": timestamp.isoformat() if isinstance(timestamp, datetime) else str(timestamp or ""),
                        }
                    )

                cursor.execute(f"select task_id from public.{deleted_tasks_table} order by task_id")
                deleted_task_ids = [int(task_id) for (task_id,) in cursor.fetchall()]

                cursor.execute(f"select client_id from public.{deleted_clients_table} order by client_id")
                deleted_client_ids = [int(client_id) for (client_id,) in cursor.fetchall()]

                cursor.execute(
                    f"select key, value_text from public.{meta_table} where key in ('next_task_id', 'next_client_id')"
                )
                meta_rows = cursor.fetchall()
                next_task_id = 1
                next_client_id = 1
                for key, value_text in meta_rows:
                    if key == "next_task_id":
                        next_task_id = _parse_int_env(str(value_text), 1)
                    if key == "next_client_id":
                        next_client_id = _parse_int_env(str(value_text), 1)

        payload: dict[str, Any] = {
            "users": users,
            "tasks": tasks,
            "clients": clients,
            "presence": presence,
            "sessions": sessions,
            "task_locks": task_locks,
            "admin_audit_logs": admin_audit_logs,
            "saved_filter_sets": saved_filter_sets,
            "automation_rules": automation_rules,
            "task_comments": task_comments,
            "next_task_id": next_task_id,
            "next_client_id": next_client_id,
            "deleted_task_ids": deleted_task_ids,
            "deleted_client_ids": deleted_client_ids,
        }

        if not users and not tasks and not clients and not sessions and not presence:
            return {}

        return payload

    def _save_state_to_supabase_relational(self, payload: dict[str, Any]) -> None:
        if not self._bootstrap_supabase_relational_storage():
            raise RuntimeError("Supabase relational storage is not available")

        if psycopg is None:
            raise RuntimeError("psycopg is required for relational Supabase mode")

        with psycopg.connect(self._supabase_postgres_conninfo()) as conn:
            with conn.cursor() as cursor:
                cursor.execute("select pg_advisory_xact_lock(%s)", (self.SUPABASE_ADVISORY_LOCK_KEY,))
                self._write_relational_payload(cursor, payload)

    def _bootstrap_supabase_storage(self) -> bool:
        if not self.supabase_postgres_url:
            self.state_driver_note = "supabase relation missing; no postgres URL available for bootstrap"
            return False
        if psycopg is None:
            self.state_driver_note = "supabase relation missing; psycopg not installed for bootstrap"
            return False

        index_name = f"{self.supabase_table}_payload_gin"
        try:
            with psycopg.connect(self._supabase_postgres_conninfo(), autocommit=True) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        f"""
                        create table if not exists public.{self.supabase_table} (
                          id bigint primary key,
                          payload jsonb not null,
                          updated_at timestamptz not null default now()
                        )
                        """
                    )
                    cursor.execute(
                        f"""
                        insert into public.{self.supabase_table} (id, payload)
                        values (%s, '{{}}'::jsonb)
                        on conflict (id) do nothing
                        """,
                        (self.supabase_row_id,),
                    )
                    cursor.execute(
                        f"""
                        create index if not exists {index_name}
                        on public.{self.supabase_table}
                        using gin (payload)
                        """
                    )
            self.state_driver_note = "auto-bootstrapped supabase state table"
            return True
        except Exception as error:
            self.state_driver_note = f"supabase relation missing; bootstrap failed ({error})"
            return False

    def _load_state_from_supabase(self) -> dict[str, Any] | None:
        if self.supabase_storage_mode == "relational":
            return self._load_state_from_supabase_relational()

        endpoint = self._supabase_endpoint()
        params = {
            "select": "payload",
            "id": f"eq.{self.supabase_row_id}",
            "limit": "1",
        }
        with httpx.Client(timeout=15.0) as client:
            response = client.get(endpoint, params=params, headers=self._supabase_headers())
            response_text_upper = (response.text or "").upper()
            missing_table_error = (
                "42P01" in response_text_upper
                or "PGRST205" in response_text_upper
                or "SCHEMA CACHE" in response_text_upper
                or "COULD NOT FIND THE TABLE" in response_text_upper
            )
            if response.status_code >= 400 and missing_table_error:
                if self._bootstrap_supabase_storage():
                    # PostgREST schema cache can take a moment to observe new relations.
                    for _ in range(3):
                        response = client.get(endpoint, params=params, headers=self._supabase_headers())
                        if response.status_code < 400:
                            break
                        if "PGRST205" not in (response.text or "").upper():
                            break
                        time.sleep(0.6)
            if response.status_code >= 400:
                raise RuntimeError(f"Supabase load failed with HTTP {response.status_code}: {response.text}")

            rows: Any = response.json()
            if not isinstance(rows, list):
                return None
            if not rows:
                return None

            first_row: dict[str, Any]
            if isinstance(rows[0], dict):
                first_row = cast(dict[str, Any], rows[0])
            else:
                first_row = {}
            payload: Any = first_row.get("payload")
            if isinstance(payload, dict):
                return cast(dict[str, Any], payload)
            return None

    def _save_state_to_supabase(self, payload: dict[str, Any]) -> None:
        if self.supabase_storage_mode == "relational":
            self._save_state_to_supabase_relational(payload)
            return

        endpoint = self._supabase_endpoint()
        body: dict[str, Any] = {
            "id": self.supabase_row_id,
            "payload": payload,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        headers = self._supabase_headers()
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

        with httpx.Client(timeout=20.0) as client:
            response = client.post(endpoint, json=body, headers=headers)
            if response.status_code >= 400:
                raise RuntimeError(f"Supabase save failed with HTTP {response.status_code}: {response.text}")

    def _firebase_endpoint(self) -> str:
        return f"{self.firebase_url}/{self.firebase_state_path}.json"

    def _firebase_params(self) -> dict[str, str]:
        params: dict[str, str] = {}
        if self.firebase_auth_secret:
            params["auth"] = self.firebase_auth_secret
        return params

    def _load_state_from_firebase(self) -> dict[str, Any] | None:
        endpoint = self._firebase_endpoint()
        with httpx.Client(timeout=15.0) as client:
            response = client.get(endpoint, params=self._firebase_params())
            if response.status_code >= 400:
                raise RuntimeError(f"Firebase load failed with HTTP {response.status_code}")
            data: Any = response.json()
            if isinstance(data, dict):
                return cast(dict[str, Any], data)
            return None

    def _save_state_to_firebase(self, payload: dict[str, Any]) -> None:
        endpoint = self._firebase_endpoint()
        with httpx.Client(timeout=20.0) as client:
            response = client.put(endpoint, json=payload, params=self._firebase_params())
            if response.status_code >= 400:
                raise RuntimeError(f"Firebase save failed with HTTP {response.status_code}")

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    @staticmethod
    def _sha256(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _issue_token(self, username: str, expires_in_seconds: int = 3600) -> str:
        expires_at = int(time.time()) + max(60, int(expires_in_seconds))
        payload = f"{username}|{expires_at}"
        signature = hmac.new(self.token_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        raw = f"{payload}|{signature}".encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

    def _username_from_token(self, token: str) -> str:
        try:
            padded = token + ("=" * ((4 - len(token) % 4) % 4))
            decoded = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
            username, expires_raw, signature = decoded.split("|", 2)
            payload = f"{username}|{expires_raw}"
            expected_signature = hmac.new(self.token_secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected_signature):
                raise UnauthorizedError("Invalid or expired token")

            expires_at = int(expires_raw)
            if expires_at < int(time.time()):
                raise UnauthorizedError("Invalid or expired token")
            return username
        except (ValueError, TypeError, binascii.Error) as error:
            raise UnauthorizedError("Invalid or expired token") from error

    def authenticate(self, username: str, password: str) -> tuple[str, UserProfile]:
        username_key = self._resolve_username_key(username)
        user = self.users.get(username_key or "")
        if not user or not username_key:
            raise UnauthorizedError("Invalid username or password")
        if not self._coerce_bool(user.get("isActive", True)):
            raise UnauthorizedError("User is inactive")
        if user["passwordHash"] != self._sha256(password):
            raise UnauthorizedError("Invalid username or password")

        token = self._issue_token(username_key)
        profile = self._user_profile_from_record(user)
        return token, profile

    def change_password(self, username: str, current_password: str, new_password: str) -> None:
        user = self.users.get(username)
        if not user:
            raise UnauthorizedError("Invalid user")
        if user["passwordHash"] != self._sha256(current_password):
            raise UnauthorizedError("Incorrect current password")
        user["passwordHash"] = self._sha256(new_password)
        self.save_state()

    def user_from_token(self, token: str) -> UserProfile:
        username = self._username_from_token(token)
        if username not in self.users:
            raise UnauthorizedError("Invalid or expired token")
        user = self.users[username]
        if not self._coerce_bool(user.get("isActive", True)):
            raise UnauthorizedError("Invalid or expired token")
        return self._user_profile_from_record(user)

    def logout(self, token: str) -> None:
        # Stateless token mode: logout is handled client-side by dropping the token.
        return

    def _cleanup_expired_locks(self) -> None:
        now = self._now()
        expired = [task_id for task_id, lock in self.task_locks.items() if lock.expiresAt <= now]
        for task_id in expired:
            self.task_locks.pop(task_id, None)

    def list_task_locks(self) -> list[TaskLockOut]:
        self._cleanup_expired_locks()
        return list(self.task_locks.values())

    def lock_task(self, task_id: int, username: str, name: str, ttl_seconds: int = 60) -> TaskLockOut:
        self._cleanup_expired_locks()
        existing = self.task_locks.get(task_id)
        if existing and existing.lockedBy != username:
            raise ConflictError(f'Task is locked by {existing.lockedByName}')

        now = self._now()
        lock = TaskLockOut(
            taskId=task_id,
            lockedBy=username,
            lockedByName=name,
            acquiredAt=existing.acquiredAt if existing else now,
            expiresAt=now + timedelta(seconds=max(15, min(ttl_seconds, 300))),
        )
        self.task_locks[task_id] = lock
        self.save_state()
        return lock

    def unlock_task(self, task_id: int, username: str) -> None:
        self._cleanup_expired_locks()
        existing = self.task_locks.get(task_id)
        if not existing:
            return
        if existing.lockedBy != username:
            raise ConflictError("Task lock owned by another user")
        self.task_locks.pop(task_id, None)
        self.save_state()

    def lock_for_task(self, task_id: int) -> TaskLockOut | None:
        self._cleanup_expired_locks()
        return self.task_locks.get(task_id)

    def mark_task_deleted(self, task_id: int) -> None:
        parsed = self._coerce_id(task_id)
        if parsed is not None:
            self._deleted_task_ids.add(parsed)
            self._restored_task_ids.discard(parsed)

    def mark_client_deleted(self, client_id: int) -> None:
        parsed = self._coerce_id(client_id)
        if parsed is not None:
            self._deleted_client_ids.add(parsed)
            self._restored_client_ids.discard(parsed)

    def mark_task_restored(self, task_id: int) -> None:
        parsed = self._coerce_id(task_id)
        if parsed is not None:
            self._restored_task_ids.add(parsed)
            self._deleted_task_ids.discard(parsed)

    def mark_client_restored(self, client_id: int) -> None:
        parsed = self._coerce_id(client_id)
        if parsed is not None:
            self._restored_client_ids.add(parsed)
            self._deleted_client_ids.discard(parsed)

    def save_state(self) -> None:
        payload: dict[str, Any] = {
            "users": self.users,
            "tasks": [task.model_dump(mode="json") for task in self.tasks.values()],
            "clients": [client.model_dump(mode="json") for client in self.clients.values()],
            "presence": [item.model_dump(mode="json") for item in self.presence.values()],
            "sessions": [item.model_dump(mode="json") for item in self.sessions.values()],
            "task_locks": [item.model_dump(mode="json") for item in self.task_locks.values()],
            "admin_audit_logs": self.admin_audit_logs,
            "saved_filter_sets": self.saved_filter_sets,
            "automation_rules": self.automation_rules,
            "task_comments": self.task_comments,
            "next_task_id": self.next_task_id,
            "next_client_id": self.next_client_id,
        }
        if self.state_driver == "supabase":
            remote_payload = self._load_state_from_supabase() or {}

            merged_payload = dict(payload)
            effective_deleted_task_ids = self._coerce_id_set(remote_payload.get("deleted_task_ids", []))
            effective_deleted_task_ids |= self._deleted_task_ids
            effective_deleted_task_ids -= self._restored_task_ids
            if len(effective_deleted_task_ids) > self.MAX_PERSISTED_TOMBSTONES:
                effective_deleted_task_ids = set(sorted(effective_deleted_task_ids)[-self.MAX_PERSISTED_TOMBSTONES :])

            effective_deleted_client_ids = self._coerce_id_set(remote_payload.get("deleted_client_ids", []))
            effective_deleted_client_ids |= self._deleted_client_ids
            effective_deleted_client_ids -= self._restored_client_ids
            if len(effective_deleted_client_ids) > self.MAX_PERSISTED_TOMBSTONES:
                effective_deleted_client_ids = set(sorted(effective_deleted_client_ids)[-self.MAX_PERSISTED_TOMBSTONES :])

            remote_tasks = [cast(dict[str, Any], item) for item in self._as_sequence(remote_payload.get("tasks", [])) if isinstance(item, dict)]
            local_tasks = [cast(dict[str, Any], item) for item in self._as_sequence(payload.get("tasks", [])) if isinstance(item, dict)]
            merged_tasks = self._merge_tasks_payload(local_tasks, remote_tasks)
            if effective_deleted_task_ids:
                merged_tasks = [
                    item
                    for item in merged_tasks
                    if (self._coerce_id(item.get("id")) not in effective_deleted_task_ids)
                ]

            remote_clients = [cast(dict[str, Any], item) for item in self._as_sequence(remote_payload.get("clients", [])) if isinstance(item, dict)]
            local_clients = [cast(dict[str, Any], item) for item in self._as_sequence(payload.get("clients", [])) if isinstance(item, dict)]
            merged_clients = self._merge_clients_payload(local_clients, remote_clients)
            if effective_deleted_client_ids:
                merged_clients = [
                    item
                    for item in merged_clients
                    if (self._coerce_id(item.get("id")) not in effective_deleted_client_ids)
                ]

            merged_payload["tasks"] = merged_tasks
            merged_payload["clients"] = merged_clients
            merged_payload["deleted_task_ids"] = sorted(effective_deleted_task_ids)
            merged_payload["deleted_client_ids"] = sorted(effective_deleted_client_ids)
            merged_payload["next_task_id"] = max(
                _parse_int_env(str(payload.get("next_task_id", 1)), 1),
                _parse_int_env(str(remote_payload.get("next_task_id", 1)), 1),
                max(((self._coerce_id(item.get("id")) or 0) for item in merged_tasks), default=0) + 1,
            )
            merged_payload["next_client_id"] = max(
                _parse_int_env(str(payload.get("next_client_id", 1)), 1),
                _parse_int_env(str(remote_payload.get("next_client_id", 1)), 1),
                max(((self._coerce_id(item.get("id")) or 0) for item in merged_clients), default=0) + 1,
            )

            self._save_state_to_supabase(merged_payload)
            self._deleted_task_ids.clear()
            self._deleted_client_ids.clear()
            self._restored_task_ids.clear()
            self._restored_client_ids.clear()
            return
        if self.state_driver == "firebase":
            self._save_state_to_firebase(payload)
            self._deleted_task_ids.clear()
            self._deleted_client_ids.clear()
            self._restored_task_ids.clear()
            self._restored_client_ids.clear()
            return
        try:
            self.state_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            self._deleted_task_ids.clear()
            self._deleted_client_ids.clear()
            self._restored_task_ids.clear()
            self._restored_client_ids.clear()
        except OSError:
            # Keep API responses successful even when file persistence is unavailable.
            # In this mode, state remains in-memory for the current instance only.
            return

    def reload_state(self) -> None:
        self._load_state()
        self._last_remote_refresh_monotonic = time.monotonic()

    def refresh_remote_state_if_needed(self, min_interval_seconds: float = 2.0) -> None:
        if self.state_driver not in {"supabase", "firebase"}:
            return

        now = time.monotonic()
        if now - self._last_remote_refresh_monotonic < max(0.0, float(min_interval_seconds)):
            return

        self.reload_state()

    def _load_state(self) -> None:
        if self.state_driver == "supabase":
            raw = self._load_state_from_supabase()
            if not isinstance(raw, dict) or not raw:
                self.save_state()
                raw = self._load_state_from_supabase() or {}
        elif self.state_driver == "firebase":
            raw = self._load_state_from_firebase()
            if not isinstance(raw, dict) or not raw:
                self.save_state()
                raw = self._load_state_from_firebase() or {}
        else:
            if not self.state_file.exists():
                self.save_state()
                return
            raw = json.loads(self.state_file.read_text(encoding="utf-8"))

        loaded_users = raw.get("users")
        if isinstance(loaded_users, dict):
            normalized_users: dict[str, dict[str, Any]] = {}
            loaded_user_map = cast(dict[Any, Any], loaded_users)
            for fallback_username, raw_user in loaded_user_map.items():
                normalized_user = self._normalize_user_record(str(fallback_username or ""), raw_user)
                if normalized_user:
                    normalized_users[normalized_user["username"]] = normalized_user
            if normalized_users:
                self.users = normalized_users

        skipped_tasks = 0
        skipped_clients = 0
        skipped_presence = 0
        skipped_sessions = 0
        skipped_locks = 0

        tasks = self._as_sequence(raw.get("tasks", []))
        self.tasks = {}
        for item in tasks:
            coerced_task = self._coerce_task_payload(item)
            if not coerced_task:
                skipped_tasks += 1
                continue
            try:
                task = TaskOut.model_validate(coerced_task)
                self.tasks[task.id] = task
            except Exception:
                skipped_tasks += 1

        clients_source = raw.get("clients")
        if clients_source is None and isinstance(raw.get("config"), dict):
            clients_source = cast(dict[str, Any], raw.get("config")).get("clients", [])

        clients = self._as_sequence(clients_source)
        self.clients = {}
        next_fallback_client_id = 1
        for item in clients:
            coerced_client = self._coerce_client_payload(item, next_fallback_client_id)
            next_fallback_client_id += 1
            if not coerced_client:
                skipped_clients += 1
                continue
            try:
                client = ClientOut.model_validate(coerced_client)
                self.clients[client.id] = client
            except Exception:
                skipped_clients += 1

        loaded_deleted_task_ids = self._coerce_id_set(raw.get("deleted_task_ids", []))
        loaded_deleted_client_ids = self._coerce_id_set(raw.get("deleted_client_ids", []))
        for task_id in loaded_deleted_task_ids:
            self.tasks.pop(task_id, None)
            self.task_locks.pop(task_id, None)
        for client_id in loaded_deleted_client_ids:
            self.clients.pop(client_id, None)
        self._deleted_task_ids = loaded_deleted_task_ids
        self._deleted_client_ids = loaded_deleted_client_ids
        self._restored_task_ids.clear()
        self._restored_client_ids.clear()

        presence = self._as_sequence(raw.get("presence", []))
        self.presence = {}
        for item in presence:
            try:
                record = PresenceOut.model_validate(item)
                self.presence[record.username] = record
            except Exception:
                skipped_presence += 1

        sessions = self._as_sequence(raw.get("sessions", []))
        self.sessions = {}
        for item in sessions:
            try:
                coerced_session = self._coerce_session_payload(item)
                if not coerced_session:
                    skipped_sessions += 1
                    continue
                session = SessionOut.model_validate(coerced_session)
                self.sessions[session.id] = session
            except Exception:
                skipped_sessions += 1

        task_locks = self._as_sequence(raw.get("task_locks", []))
        self.task_locks = {}
        for item in task_locks:
            try:
                lock = TaskLockOut.model_validate(item)
                self.task_locks[lock.taskId] = lock
            except Exception:
                skipped_locks += 1

        admin_audit_logs = raw.get("admin_audit_logs", [])
        self.admin_audit_logs = admin_audit_logs if isinstance(admin_audit_logs, list) else []

        saved_filter_sets = raw.get("saved_filter_sets", [])
        self.saved_filter_sets = saved_filter_sets if isinstance(saved_filter_sets, list) else []

        automation_rules = raw.get("automation_rules", [])
        self.automation_rules = automation_rules if isinstance(automation_rules, list) else []

        task_comments = raw.get("task_comments", {})
        self.task_comments = task_comments if isinstance(task_comments, dict) else {}

        self._cleanup_expired_locks()

        next_task_default = max(self.tasks.keys(), default=0) + 1
        next_client_default = max(self.clients.keys(), default=0) + 1
        if isinstance(raw.get("config"), dict):
            raw_config = cast(dict[str, Any], raw.get("config"))
            next_task_default = _parse_int_env(str(raw_config.get("nextTaskId", next_task_default)), next_task_default)
            next_client_default = _parse_int_env(str(raw_config.get("nextClientId", next_client_default)), next_client_default)

        self.next_task_id = _parse_int_env(str(raw.get("next_task_id", next_task_default)), next_task_default)
        self.next_client_id = _parse_int_env(str(raw.get("next_client_id", next_client_default)), next_client_default)

        if skipped_tasks or skipped_clients or skipped_presence or skipped_sessions or skipped_locks:
            self.state_driver_note = (
                f"state loaded with skipped invalid entries: tasks={skipped_tasks}, clients={skipped_clients}, "
                f"presence={skipped_presence}, sessions={skipped_sessions}, locks={skipped_locks}"
            )


store = InMemoryStore()
