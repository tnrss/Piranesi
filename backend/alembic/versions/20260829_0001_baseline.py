"""Baseline the existing schema and add persistent class meetings."""

from collections.abc import Callable

from alembic import op
import sqlalchemy as sa

revision = "20260829_0001"
down_revision = None
branch_labels = None
depends_on = None


def _create_missing_table(name: str, create: Callable[[], None]) -> None:
    if name not in sa.inspect(op.get_bind()).get_table_names():
        create()


def _create_missing_index(name: str, table: str, columns: list[str], unique: bool = False) -> None:
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}
    if name not in indexes:
        op.create_index(name, table, columns, unique=unique)


def upgrade() -> None:
    _create_missing_table("work_shifts", lambda: op.create_table(
        "work_shifts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("date", sa.Date()),
        sa.Column("hours_worked", sa.Float()),
        sa.Column("hourly_rate", sa.Float()),
        sa.Column("task_notes", sa.String(), nullable=True),
    ))
    _create_missing_table("academic_tasks", lambda: op.create_table(
        "academic_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_name", sa.String()),
        sa.Column("title", sa.String()),
        sa.Column("due_date", sa.DateTime()),
        sa.Column("task_type", sa.String()),
        sa.Column("is_completed", sa.Boolean()),
    ))
    _create_missing_table("financial_accounts", lambda: op.create_table(
        "financial_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("plaid_item_id", sa.String()),
        sa.Column("account_name", sa.String()),
        sa.Column("current_balance", sa.Float()),
        sa.Column("account_type", sa.String()),
        sa.Column("last_synced", sa.DateTime()),
    ))
    _create_missing_table("plaid_connection_state", lambda: op.create_table(
        "plaid_connection_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("institution", sa.String()),
        sa.Column("is_connected", sa.Boolean()),
        sa.Column("updated_at", sa.DateTime()),
    ))
    _create_missing_table("plaid_items", lambda: op.create_table(
        "plaid_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.String()),
        sa.Column("access_token", sa.String()),
        sa.Column("institution", sa.String(), nullable=True),
        sa.Column("last_synced", sa.DateTime(), nullable=True),
        sa.Column("liabilities_updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime()),
    ))
    _create_missing_table("canvas_assignments", lambda: op.create_table(
        "canvas_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("canvas_assignment_id", sa.String()),
        sa.Column("canvas_course_id", sa.String()),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("last_synced", sa.DateTime()),
        sa.UniqueConstraint("canvas_assignment_id"),
        sa.UniqueConstraint("task_id"),
    ))
    _create_missing_table("canvas_courses", lambda: op.create_table(
        "canvas_courses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("canvas_course_id", sa.String()),
        sa.Column("name", sa.String()),
        sa.Column("course_code", sa.String(), nullable=True),
        sa.Column("instructor", sa.String(), nullable=True),
        sa.Column("last_synced", sa.DateTime()),
    ))
    _create_missing_table("canvas_course_grades", lambda: op.create_table(
        "canvas_course_grades",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("canvas_course_id", sa.String()),
        sa.Column("current_score", sa.Float(), nullable=True),
        sa.Column("current_grade", sa.String(), nullable=True),
        sa.Column("local_override", sa.String(), nullable=True),
        sa.Column("last_synced", sa.DateTime()),
    ))
    _create_missing_table("manual_exams", lambda: op.create_table(
        "manual_exams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_name", sa.String()),
        sa.Column("title", sa.String()),
        sa.Column("exam_date", sa.DateTime()),
        sa.Column("notes", sa.String(), nullable=True),
    ))
    _create_missing_table("calendar_notes", lambda: op.create_table(
        "calendar_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("note_date", sa.Date()),
        sa.Column("content", sa.String()),
        sa.Column("day_log", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime()),
    ))
    _create_missing_table("todo_items", lambda: op.create_table(
        "todo_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("description", sa.String()),
        sa.Column("due_date", sa.DateTime(), nullable=True),
        sa.Column("is_completed", sa.Boolean()),
        sa.Column("created_at", sa.DateTime()),
    ))
    _create_missing_table("work_clock_sessions", lambda: op.create_table(
        "work_clock_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("clocked_in_at", sa.DateTime(), nullable=False),
        sa.Column("clocked_out_at", sa.DateTime(), nullable=True),
        sa.Column("hourly_rate", sa.Float()),
    ))
    _create_missing_table("class_meetings", lambda: op.create_table(
        "class_meetings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("days", sa.JSON(), nullable=False),
        sa.Column("start", sa.String(), nullable=False),
        sa.Column("end", sa.String(), nullable=False),
        sa.Column("room", sa.String(), nullable=True),
    ))

    plaid_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("plaid_items")}
    if "liabilities_updated_at" not in plaid_columns:
        op.add_column("plaid_items", sa.Column("liabilities_updated_at", sa.DateTime(), nullable=True))

    for index_name, table_name, columns, unique in [
        ("ix_work_shifts_id", "work_shifts", ["id"], False),
        ("ix_work_shifts_date", "work_shifts", ["date"], False),
        ("ix_academic_tasks_id", "academic_tasks", ["id"], False),
        ("ix_financial_accounts_id", "financial_accounts", ["id"], False),
        ("ix_financial_accounts_plaid_item_id", "financial_accounts", ["plaid_item_id"], True),
        ("ix_plaid_connection_state_id", "plaid_connection_state", ["id"], False),
        ("ix_plaid_items_id", "plaid_items", ["id"], False),
        ("ix_plaid_items_item_id", "plaid_items", ["item_id"], True),
        ("ix_canvas_assignments_id", "canvas_assignments", ["id"], False),
        ("ix_canvas_assignments_canvas_assignment_id", "canvas_assignments", ["canvas_assignment_id"], True),
        ("ix_canvas_assignments_canvas_course_id", "canvas_assignments", ["canvas_course_id"], False),
        ("ix_canvas_courses_id", "canvas_courses", ["id"], False),
        ("ix_canvas_courses_canvas_course_id", "canvas_courses", ["canvas_course_id"], True),
        ("ix_canvas_course_grades_id", "canvas_course_grades", ["id"], False),
        ("ix_canvas_course_grades_canvas_course_id", "canvas_course_grades", ["canvas_course_id"], True),
        ("ix_manual_exams_id", "manual_exams", ["id"], False),
        ("ix_calendar_notes_id", "calendar_notes", ["id"], False),
        ("ix_calendar_notes_note_date", "calendar_notes", ["note_date"], True),
        ("ix_todo_items_id", "todo_items", ["id"], False),
        ("ix_work_clock_sessions_id", "work_clock_sessions", ["id"], False),
        ("ix_class_meetings_id", "class_meetings", ["id"], False),
    ]:
        _create_missing_index(index_name, table_name, columns, unique)

    meetings = sa.table(
        "class_meetings",
        sa.column("name", sa.String()),
        sa.column("days", sa.JSON()),
        sa.column("start", sa.String()),
        sa.column("end", sa.String()),
        sa.column("room", sa.String()),
    )
    count = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM class_meetings")).scalar_one()
    if count == 0:
        op.bulk_insert(meetings, [
            {"name": "Intro to Intelligent Robotics", "days": [1, 3, 5], "start": "09:00", "end": "09:50", "room": None},
            {"name": "AI Ethics", "days": [1, 3, 5], "start": "12:00", "end": "12:50", "room": None},
            {"name": "Linear Algebra", "days": [1, 3, 5], "start": "14:00", "end": "14:50", "room": None},
            {"name": "Computer Security", "days": [2, 4], "start": "15:00", "end": "16:15", "room": None},
        ])


def downgrade() -> None:
    op.drop_table("class_meetings")