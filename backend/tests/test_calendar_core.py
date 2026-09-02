from datetime import datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

import main
from database import Base


def test_blank_database_migrates_to_current_schema(tmp_path: Path):
    database_path = tmp_path / "migration.db"
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path}")

    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{database_path}")
    tables = set(inspect(engine).get_table_names())
    assert set(Base.metadata.tables) <= tables
    assert "alembic_version" in tables


def test_calendar_resources_and_api_prefix(tmp_path: Path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'api.db'}",
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
    try:
        with TestClient(main.app) as client:
            assert client.get("/api/health").json() == {
                "status": "ok",
                "database": "connected",
            }
            assert client.get("/health").status_code == 404

            meeting = client.post(
                "/api/class-meetings/",
                json={
                    "name": "Computer Security",
                    "days": [2],
                    "start": "09:00",
                    "end": "10:00",
                },
            )
            assert meeting.status_code == 200

            todo = client.post(
                "/api/todos/",
                json={
                    "description": "Deploy Piranesi",
                    "due_date": "2026-09-01T12:00:00",
                    "recurrence": "daily",
                },
            )
            assert todo.status_code == 200

            first_note = client.put(
                "/api/calendar-notes/2026-09-01",
                json={"content": "Initial note"},
            )
            second_note = client.put(
                "/api/calendar-notes/2026-09-01",
                json={"content": "Pi setup"},
            )
            assert first_note.json()["id"] == second_note.json()["id"]

            week = client.get("/api/calendar/week?start=2026-08-31")
            assert week.status_code == 200
            payload = week.json()
            assert len(payload["days"]) == 7
            tuesday = payload["days"][1]
            assert tuesday["date"] == "2026-09-01"
            assert tuesday["class_meetings"][0]["name"] == "Computer Security"
            assert tuesday["todos"][0]["description"] == "Deploy Piranesi"
            assert tuesday["note"]["content"] == "Pi setup"

            completed = client.patch(
                f"/api/todos/{todo.json()['id']}",
                json={"is_completed": True},
            )
            assert completed.status_code == 200
            assert completed.json()["is_completed"] is False
            assert datetime.fromisoformat(completed.json()["due_date"]) > datetime.now()
    finally:
        main.api_app.dependency_overrides.clear()