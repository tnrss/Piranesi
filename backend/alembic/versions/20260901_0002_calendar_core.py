"""Add class meetings, daily calendar notes, and todos."""

from alembic import op
import sqlalchemy as sa

revision = "20260829_0002"
down_revision = "20260829_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "class_meetings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("days", sa.JSON(), nullable=False),
        sa.Column("start", sa.String(), nullable=False),
        sa.Column("end", sa.String(), nullable=False),
        sa.Column("room", sa.String(), nullable=True),
    )
    op.create_index("ix_class_meetings_id", "class_meetings", ["id"])
    op.create_table(
        "calendar_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("note_date", sa.Date(), nullable=False),
        sa.Column("content", sa.String(), nullable=False, server_default=""),
        sa.Column("day_log", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_calendar_notes_id", "calendar_notes", ["id"])
    op.create_index("ix_calendar_notes_note_date", "calendar_notes", ["note_date"], unique=True)
    op.create_table(
        "todo_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("due_date", sa.DateTime(), nullable=True),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_todo_items_id", "todo_items", ["id"])


def downgrade() -> None:
    op.drop_table("todo_items")
    op.drop_table("calendar_notes")
    op.drop_table("class_meetings")