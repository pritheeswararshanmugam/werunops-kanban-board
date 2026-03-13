import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.main import app
from app.store import store


client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200


def test_auth_and_task_create() -> None:
    login = client.post("/api/v1/auth/login", json={"username": "Eshwar", "password": "110495"})
    assert login.status_code == 200

    token = login.json()["data"]["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    created = client.post(
        "/api/v1/tasks",
        json={
            "client": "JS Roofing",
            "project": "House 77",
            "task": "Validate API smoke",
            "staff": "Mubarak",
            "status": "New",
            "priority": "Low",
            "startDate": "2026-03-12",
            "dueDate": "2026-03-15",
            "waitingFor": "",
            "notes": "",
            "parentId": None,
        },
        headers=headers,
    )
    assert created.status_code == 200

    metrics = client.get("/api/v1/dashboard/metrics", headers=headers)
    assert metrics.status_code == 200

    summary = client.get("/api/v1/reports/sessions/summary", headers=headers)
    assert summary.status_code == 200

    export_csv = client.get("/api/v1/exports/sessions.csv", headers=headers)
    assert export_csv.status_code == 200


def test_task_lock_and_restore_flow() -> None:
    login_a = client.post("/api/v1/auth/login", json={"username": "Eshwar", "password": "110495"})
    assert login_a.status_code == 200

    token_a = login_a.json()["data"]["accessToken"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    created = client.post(
        "/api/v1/tasks",
        json={
            "client": "JS Roofing",
            "project": "House Lock",
            "task": "Lock contention test",
            "staff": "Mubarak",
            "status": "New",
            "priority": "Medium",
            "startDate": "2026-03-13",
            "dueDate": "2026-03-20",
            "waitingFor": "",
            "notes": "",
            "parentId": None,
        },
        headers=headers_a,
    )
    assert created.status_code == 200
    task = created.json()["data"]
    task_id = task["id"]

    lock_response = client.put(f"/api/v1/locks/tasks/{task_id}", json={"ttlSeconds": 90}, headers=headers_a)
    assert lock_response.status_code == 200

    # Simulate a second user owning the lock so conflict handling is verified.
    lock_record = store.task_locks.get(task_id)
    assert lock_record is not None
    lock_record.lockedBy = "AnotherUser"
    lock_record.lockedByName = "Another User"
    store.task_locks[task_id] = lock_record

    blocked_update = client.put(
        f"/api/v1/tasks/{task_id}",
        json={
            "client": task["client"],
            "project": task["project"],
            "task": "Update should fail when locked",
            "staff": task["staff"],
            "status": task["status"],
            "priority": task["priority"],
            "startDate": task["startDate"],
            "dueDate": task["dueDate"],
            "waitingFor": task["waitingFor"],
            "notes": task["notes"],
            "parentId": task["parentId"],
            "version": task["version"],
        },
        headers=headers_a,
    )
    assert blocked_update.status_code == 409

    # Restore ownership so unlock path can be verified.
    lock_record = store.task_locks.get(task_id)
    assert lock_record is not None
    lock_record.lockedBy = "Eshwar"
    lock_record.lockedByName = "Pritheeswarar"
    store.task_locks[task_id] = lock_record

    unlock_response = client.delete(f"/api/v1/locks/tasks/{task_id}", headers=headers_a)
    assert unlock_response.status_code == 200

    delete_response = client.delete(f"/api/v1/tasks/{task_id}", headers=headers_a)
    assert delete_response.status_code == 200

    restore_response = client.post(
        "/api/v1/tasks/restore",
        json={"task": task},
        headers=headers_a,
    )
    assert restore_response.status_code == 200

    fetched = client.get(f"/api/v1/tasks/{task_id}", headers=headers_a)
    assert fetched.status_code == 200


if __name__ == "__main__":
    test_health()
    test_auth_and_task_create()
    test_task_lock_and_restore_flow()
    print("Smoke tests passed")
