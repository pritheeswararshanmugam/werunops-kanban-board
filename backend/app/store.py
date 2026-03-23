from __future__ import annotations

import json
import hashlib
import hmac
import os
import re
import time
import base64
import binascii
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import httpx

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


def _parse_int_env(value: str, fallback: int) -> int:
    try:
        return int(_normalize_env_value(value))
    except (TypeError, ValueError):
        return fallback


class InMemoryStore:
    def __init__(self) -> None:
        default_state_file = Path(__file__).resolve().parent.parent / "data" / "state_store.json"
        # Vercel's project filesystem is read-only at runtime; /tmp is writable per instance.
        if os.getenv("VERCEL"):
            self.state_file = Path("/tmp") / "state_store.json"
        else:
            self.state_file = default_state_file
        self.state_driver_note = ""
        self.state_driver = _get_env_compat(
            names=("WERUNOPS_STATE_DRIVER",),
            suffixes=("_WERUNOPS_STATE_DRIVER",),
            default="",
        ).lower()
        self.supabase_url = _get_env_compat(
            names=("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
            suffixes=("_SUPABASE_URL", "_NEXT_PUBLIC_SUPABASE_URL"),
            default="",
        ).rstrip("/")
        self.supabase_key = _get_env_compat(
            names=("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"),
            suffixes=("_SUPABASE_SERVICE_ROLE_KEY", "_SUPABASE_SECRET_KEY"),
            default="",
        )
        self.supabase_table = _get_env_compat(
            names=("SUPABASE_STATE_TABLE",),
            suffixes=("_SUPABASE_STATE_TABLE",),
            default="werunops_state",
        )
        self.supabase_row_id = _parse_int_env(
            _get_env_compat(
                names=("SUPABASE_STATE_ROW_ID",),
                suffixes=("_SUPABASE_STATE_ROW_ID",),
                default="1",
            ),
            1,
        )
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
            },
            "Mubarak": {
                "username": "Mubarak",
                "passwordHash": "23fece5f1a2a4452cba0113271736a16d241201bef2fd15b72819582e13fb267",
                "name": "Mubarak",
                "role": "Manager",
                "initials": "M",
            },
            "Sudhar": {
                "username": "Sudhar",
                "passwordHash": "56e89b1d6436fc86deea34dbb0306af59c40d29f20bc20b6efcb001cee9ae71b",
                "name": "Sudharshan",
                "role": "User",
                "initials": "S",
            },
        }
        now = datetime.now(UTC)
        self.tasks: dict[int, TaskOut] = {
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
        self.clients: dict[int, ClientOut] = {
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
        self.next_task_id = 2
        self.next_client_id = 3
        try:
            self._load_state()
        except Exception:
            # Keep API alive even when remote state bootstrap fails.
            self.state_driver = "file"
            self.state_driver_note = "remote state bootstrap failed; fell back to file mode"
            self._load_state()

    def _supabase_headers(self) -> dict[str, str]:
        return {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def _supabase_endpoint(self) -> str:
        return f"{self.supabase_url}/rest/v1/{self.supabase_table}"

    def _load_state_from_supabase(self) -> dict[str, Any] | None:
        endpoint = self._supabase_endpoint()
        params = {
            "select": "payload",
            "id": f"eq.{self.supabase_row_id}",
            "limit": "1",
        }
        with httpx.Client(timeout=15.0) as client:
            response = client.get(endpoint, params=params, headers=self._supabase_headers())
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
        user = self.users.get(username)
        if not user:
            raise UnauthorizedError("Invalid username or password")
        if user["passwordHash"] != self._sha256(password):
            raise UnauthorizedError("Invalid username or password")

        token = self._issue_token(username)
        profile = UserProfile(
            username=user["username"],
            name=user["name"],
            role=user["role"],
            initials=user["initials"],
        )
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
        return UserProfile(
            username=user["username"],
            name=user["name"],
            role=user["role"],
            initials=user["initials"],
        )

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
            self._save_state_to_supabase(payload)
            return
        if self.state_driver == "firebase":
            self._save_state_to_firebase(payload)
            return
        try:
            self.state_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError:
            # Keep API responses successful even when file persistence is unavailable.
            # In this mode, state remains in-memory for the current instance only.
            return

    def reload_state(self) -> None:
        self._load_state()

    def _load_state(self) -> None:
        if self.state_driver == "supabase":
            raw = self._load_state_from_supabase()
            if raw is None:
                self.save_state()
                raw = self._load_state_from_supabase() or {}
        elif self.state_driver == "firebase":
            raw = self._load_state_from_firebase()
            if raw is None:
                self.save_state()
                raw = self._load_state_from_firebase() or {}
        else:
            if not self.state_file.exists():
                self.save_state()
                return
            raw = json.loads(self.state_file.read_text(encoding="utf-8"))

        loaded_users = raw.get("users")
        if isinstance(loaded_users, dict):
            self.users = loaded_users

        tasks = raw.get("tasks", [])
        self.tasks = {}
        for item in tasks:
            task = TaskOut.model_validate(item)
            self.tasks[task.id] = task

        clients = raw.get("clients", [])
        self.clients = {}
        for item in clients:
            client = ClientOut.model_validate(item)
            self.clients[client.id] = client

        presence = raw.get("presence", [])
        self.presence = {}
        for item in presence:
            record = PresenceOut.model_validate(item)
            self.presence[record.username] = record

        sessions = raw.get("sessions", [])
        self.sessions = {}
        for item in sessions:
            session = SessionOut.model_validate(item)
            self.sessions[session.id] = session

        task_locks = raw.get("task_locks", [])
        self.task_locks = {}
        for item in task_locks:
            lock = TaskLockOut.model_validate(item)
            self.task_locks[lock.taskId] = lock

        admin_audit_logs = raw.get("admin_audit_logs", [])
        self.admin_audit_logs = admin_audit_logs if isinstance(admin_audit_logs, list) else []

        saved_filter_sets = raw.get("saved_filter_sets", [])
        self.saved_filter_sets = saved_filter_sets if isinstance(saved_filter_sets, list) else []

        automation_rules = raw.get("automation_rules", [])
        self.automation_rules = automation_rules if isinstance(automation_rules, list) else []

        task_comments = raw.get("task_comments", {})
        self.task_comments = task_comments if isinstance(task_comments, dict) else {}

        self._cleanup_expired_locks()

        self.next_task_id = int(raw.get("next_task_id", max(self.tasks.keys(), default=0) + 1))
        self.next_client_id = int(raw.get("next_client_id", max(self.clients.keys(), default=0) + 1))


store = InMemoryStore()
