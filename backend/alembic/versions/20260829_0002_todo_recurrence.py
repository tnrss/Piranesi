"""Add daily and weekly recurrence to todos."""

from alembic import op
import sqlalchemy as sa

revision = "20260829_0002"
down_revision = "20260829_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("todo_items") as batch_op:
        batch_op.add_column(
            sa.Column("recurrence", sa.String(), nullable=False, server_default="none")
        )


def downgrade() -> None:
    with op.batch_alter_table("todo_items") as batch_op:
        batch_op.drop_column("recurrence")