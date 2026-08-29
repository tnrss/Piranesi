"""SQLAlchemy ORM models for every Piranesi table (work, academics, finance, Canvas/Plaid sync, calendar)."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, Date, DateTime, Float, Integer, String
from database import Base

class WorkShift(Base):
    __tablename__ = "work_shifts"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True)
    hours_worked = Column(Float)
    hourly_rate = Column(Float, default=18.0)
    task_notes = Column(String, nullable=True)
    
class AcademicTask(Base):
    __tablename__ = "academic_tasks"

    id = Column(Integer, primary_key=True, index=True)
    course_name = Column(String)
    title = Column(String)
    due_date = Column(DateTime)
    task_type = Column(String)
    is_completed = Column(Boolean, default=False)

class FinancialAccount(Base):
    __tablename__ = "financial_accounts"

    id = Column(Integer, primary_key=True, index=True)
    plaid_item_id = Column(String, unique=True, index=True)
    account_name = Column(String)
    current_balance = Column(Float)
    account_type = Column(String)
    last_synced = Column(DateTime)


class PlaidConnectionState(Base):
    __tablename__ = "plaid_connection_state"

    id = Column(Integer, primary_key=True, index=True)
    institution = Column(String, default="Bank of America")
    is_connected = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow)


class PlaidItem(Base):
    __tablename__ = "plaid_items"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(String, unique=True, index=True)
    access_token = Column(String)
    institution = Column(String, nullable=True)
    last_synced = Column(DateTime, nullable=True)
    liabilities_updated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CanvasAssignment(Base):
    __tablename__ = "canvas_assignments"

    id = Column(Integer, primary_key=True, index=True)
    canvas_assignment_id = Column(String, unique=True, index=True)
    canvas_course_id = Column(String, index=True)
    task_id = Column(Integer, unique=True, nullable=False)
    last_synced = Column(DateTime, default=datetime.utcnow)


class CanvasCourse(Base):
    __tablename__ = "canvas_courses"

    id = Column(Integer, primary_key=True, index=True)
    canvas_course_id = Column(String, unique=True, index=True)
    name = Column(String)
    course_code = Column(String, nullable=True)
    instructor = Column(String, nullable=True)
    last_synced = Column(DateTime, default=datetime.utcnow)


class CanvasCourseGrade(Base):
    __tablename__ = "canvas_course_grades"

    id = Column(Integer, primary_key=True, index=True)
    canvas_course_id = Column(String, unique=True, index=True)
    current_score = Column(Float, nullable=True)
    current_grade = Column(String, nullable=True)
    local_override = Column(String, nullable=True)
    last_synced = Column(DateTime, default=datetime.utcnow)


class ClassMeeting(Base):
    __tablename__ = "class_meetings"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    days = Column(JSON, nullable=False)
    start = Column(String, nullable=False)
    end = Column(String, nullable=False)
    room = Column(String, nullable=True)


class ManualExam(Base):
    __tablename__ = "manual_exams"

    id = Column(Integer, primary_key=True, index=True)
    course_name = Column(String)
    title = Column(String)
    exam_date = Column(DateTime)
    notes = Column(String, nullable=True)


class CalendarNote(Base):
    __tablename__ = "calendar_notes"

    id = Column(Integer, primary_key=True, index=True)
    note_date = Column(Date, unique=True, index=True)
    content = Column(String, default="")
    day_log = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TodoItem(Base):
    __tablename__ = "todo_items"

    id = Column(Integer, primary_key=True, index=True)
    description = Column(String)
    due_date = Column(DateTime, nullable=True)
    is_completed = Column(Boolean, default=False)
    recurrence = Column(String, nullable=False, default="none")
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkClockSession(Base):
    __tablename__ = "work_clock_sessions"

    id = Column(Integer, primary_key=True, index=True)
    clocked_in_at = Column(DateTime, nullable=False)
    clocked_out_at = Column(DateTime, nullable=True)
    hourly_rate = Column(Float, default=18.0)