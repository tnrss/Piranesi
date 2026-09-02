from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
import models
from database import Base


class FakePlaidClient:
    def __init__(self, accounts_by_token: dict[str, list[dict]]):
        self.accounts_by_token = accounts_by_token
        self.synced_tokens: list[str] = []

    def accounts_balance_get(self, request):
        access_token = request.access_token
        self.synced_tokens.append(access_token)
        return {"accounts": self.accounts_by_token[access_token]}


def integration_client(tmp_path: Path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'integrations.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

    def override_get_db():
        database = session_factory()
        try:
            yield database
        finally:
            database.close()

    main.api_app.dependency_overrides[main.get_db] = override_get_db
    return TestClient(main.app), session_factory


def test_plaid_bulk_sync_updates_every_item_and_deduplicates_relinks(tmp_path: Path, monkeypatch):
    client, session_factory = integration_client(tmp_path)
    database = session_factory()
    database.add_all([
        models.PlaidItem(item_id="old-item", access_token="old-token"),
        models.PlaidItem(item_id="new-item", access_token="new-token"),
        models.FinancialAccount(
            plaid_item_id="old-item:old-account",
            account_name="Adv Plus Banking",
            current_balance=100.0,
            account_type="depository/checking",
        ),
    ])
    database.commit()
    database.close()

    plaid_client = FakePlaidClient({
        "old-token": [],
        "new-token": [{
            "account_id": "new-account",
            "name": "Adv Plus Banking",
            "type": "depository",
            "subtype": "checking",
            "balances": {"current": 125.0, "available": 120.0},
        }],
    })
    monkeypatch.setattr(main, "get_plaid_client", lambda: plaid_client)

    try:
        with client:
            response = client.post("/api/integrations/plaid/sync")
        assert response.status_code == 200
        assert response.json()["item_id"] is None
        assert response.json()["accounts_synced"] == 1
        assert plaid_client.synced_tokens == ["old-token", "new-token"]

        database = session_factory()
        accounts = database.query(models.FinancialAccount).all()
        assert len(accounts) == 1
        assert accounts[0].plaid_item_id == "new-item:new-account"
        assert accounts[0].current_balance == 120.0
        database.close()
    finally:
        main.api_app.dependency_overrides.clear()


def test_canvas_sync_marks_submitted_assignment_completed(tmp_path: Path, monkeypatch):
    client, session_factory = integration_client(tmp_path)

    def fake_canvas_get(path: str):
        if path.startswith("/api/v1/courses?"):
            return [{"id": 42, "name": "Robotics"}]
        if path.startswith("/api/v1/courses/42/assignments?"):
            return [{
                "id": 9001,
                "name": "Lab 1",
                "due_at": "2026-09-07T04:59:59Z",
                "has_submitted_submissions": True,
            }]
        raise AssertionError(f"Unexpected Canvas path: {path}")

    monkeypatch.setattr(main, "canvas_is_configured", lambda: True)
    monkeypatch.setattr(main, "canvas_get", fake_canvas_get)
    monkeypatch.setenv("PIRANESI_TIMEZONE", "America/Chicago")

    try:
        with client:
            response = client.post("/api/integrations/canvas/sync")
        assert response.status_code == 200
        database = session_factory()
        task = database.query(models.AcademicTask).one()
        assert task.task_type == "Canvas Assignment"
        assert task.is_completed is True
        assert task.due_date.isoformat() == "2026-09-06T23:59:59"
        database.close()
    finally:
        main.api_app.dependency_overrides.clear()


def test_core_feature_crud_and_summaries(tmp_path: Path):
    client, session_factory = integration_client(tmp_path)
    database = session_factory()
    database.add(models.CanvasCourseGrade(canvas_course_id="42", current_score=91.5))
    database.commit()
    database.close()

    try:
        with client:
            shift = client.post("/api/shifts/", json={
                "date": "2026-09-02",
                "hours_worked": 4,
                "hourly_rate": 18,
                "task_notes": "Acceptance test",
            })
            assert shift.status_code == 200
            assert client.patch(
                f"/api/shifts/{shift.json()['id']}", json={"hours_worked": 5}
            ).json()["hours_worked"] == 5
            assert client.get("/api/shifts/summary?week_start=2026-08-31").json()["total_hours"] == 5

            assert client.post("/api/work/clock-in").status_code == 200
            assert client.get("/api/work/clock").json()["is_clocked_in"] is True
            assert client.post("/api/work/clock-out").status_code == 200

            task = client.post("/api/tasks/", json={
                "course_name": "Manual Course",
                "title": "Manual assignment",
                "due_date": "2026-09-03T12:00:00",
                "task_type": "Assignment",
            })
            assert task.status_code == 200
            assert client.patch(
                f"/api/tasks/{task.json()['id']}", json={"is_completed": True}
            ).json()["is_completed"] is True

            exam = client.post("/api/exams/", json={
                "course_name": "Manual Course",
                "title": "Midterm",
                "exam_date": "2026-09-04T10:00:00",
            })
            assert exam.status_code == 200

            grade = client.put(
                "/api/integrations/canvas/grades/42", json={"local_override": "A"}
            )
            assert grade.status_code == 200
            assert grade.json()["local_override"] == "A"

            account = client.post("/api/finance/accounts/", json={
                "plaid_item_id": "manual-acceptance",
                "account_name": "Manual Checking",
                "current_balance": 500,
                "account_type": "checking",
            })
            assert account.status_code == 200
            assert client.patch(
                f"/api/finance/accounts/{account.json()['id']}", json={"current_balance": 525}
            ).json()["current_balance"] == 525
            assert client.get("/api/finance/summary").json()["net_worth"] == 525

            meeting = client.post("/api/class-meetings/", json={
                "name": "Acceptance Class",
                "days": [3],
                "start": "09:00",
                "end": "10:00",
            })
            assert meeting.status_code == 200
            assert client.patch(
                f"/api/class-meetings/{meeting.json()['id']}", json={"room": "101"}
            ).json()["room"] == "101"

            todo = client.post("/api/todos/", json={
                "description": "Acceptance todo",
                "due_date": "2026-09-02T12:00:00",
                "recurrence": "none",
            })
            assert todo.status_code == 200
            note = client.put(
                "/api/calendar-notes/2026-09-02", json={"content": "Acceptance note"}
            )
            assert note.status_code == 200
            week = client.get("/api/calendar/week?start=2026-08-31")
            assert week.status_code == 200
            wednesday = week.json()["days"][2]
            assert wednesday["class_meetings"][0]["name"] == "Acceptance Class"
            assert wednesday["todos"][0]["description"] == "Acceptance todo"
            assert wednesday["note"]["content"] == "Acceptance note"

            assert client.delete(f"/api/tasks/{task.json()['id']}").status_code == 200
            assert client.delete(f"/api/exams/{exam.json()['id']}").status_code == 200
            assert client.delete(f"/api/finance/accounts/{account.json()['id']}").status_code == 200
            assert client.delete(f"/api/class-meetings/{meeting.json()['id']}").status_code == 200
            assert client.delete(f"/api/todos/{todo.json()['id']}").status_code == 200
            assert client.delete("/api/calendar-notes/2026-09-02").status_code == 200
            assert client.delete(
                f"/api/shifts/{shift.json()['id']}"
            ).status_code == 200
    finally:
        main.api_app.dependency_overrides.clear()