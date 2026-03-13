from datetime import datetime
from typing import Any, Literal, cast

from pydantic import BaseModel, Field


class APIError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class APIMeta(BaseModel):
    requestId: str
    timestamp: datetime


class APIResponse(BaseModel):
    data: Any
    meta: APIMeta


class UserProfile(BaseModel):
    username: str
    name: str
    role: str
    initials: str


class LoginRequest(BaseModel):
    username: str
    password: str
    deviceInfo: dict[str, Any] | None = None


class LoginResponse(BaseModel):
    accessToken: str
    tokenType: str = "Bearer"
    expiresInSeconds: int = 3600
    profile: UserProfile


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=6)


TaskStatus = Literal[
    "New",
    "In Progress",
    "Waiting Client",
    "Waiting Supplier",
    "Follow Up",
    "Completed",
]
TaskPriority = Literal["High", "Medium", "Low"]


class ActivityEntry(BaseModel):
    action: str
    user: str
    timestamp: datetime


class TaskBase(BaseModel):
    client: str
    project: str | None = ""
    task: str
    staff: str
    status: TaskStatus = "New"
    priority: TaskPriority = "Medium"
    startDate: str | None = ""
    dueDate: str | None = ""
    waitingFor: str | None = ""
    notes: str | None = ""
    parentId: int | None = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(TaskBase):
    version: int


class TaskStatusPatch(BaseModel):
    status: TaskStatus
    version: int


class TaskOut(TaskBase):
    id: int
    createdAt: datetime
    updatedAt: datetime
    createdBy: str
    activityLog: list[ActivityEntry] = Field(default_factory=lambda: cast(list[ActivityEntry], []))
    version: int


class TaskRestoreRequest(BaseModel):
    task: TaskOut


class TaskLockRequest(BaseModel):
    ttlSeconds: int = 60


class TaskLockOut(BaseModel):
    taskId: int
    lockedBy: str
    lockedByName: str
    acquiredAt: datetime
    expiresAt: datetime


class BulkDeleteRequest(BaseModel):
    taskIds: list[int]


class ClientBase(BaseModel):
    name: str
    contact: str | None = ""
    email: str | None = ""
    phone: str | None = ""


class ClientCreate(ClientBase):
    pass


class ClientUpdate(ClientBase):
    version: int


class ClientOut(ClientBase):
    id: int
    version: int


class PresenceMeRequest(BaseModel):
    online: bool
    browser: str | None = None
    device: str | None = None


class PresenceOut(BaseModel):
    username: str
    online: bool
    lastSeen: datetime
    browser: str | None = None
    device: str | None = None


class SessionStartRequest(BaseModel):
    browser: str | None = None
    device: str | None = None


class SessionHeartbeatRequest(BaseModel):
    activeSeconds: int = 0
    idleSeconds: int = 0


class SessionOut(BaseModel):
    id: str
    username: str
    loginTime: datetime
    logoutTime: datetime | None = None
    durationSeconds: int = 0
    activeSeconds: int = 0
    idleSeconds: int = 0
    browser: str | None = None
    device: str | None = None
