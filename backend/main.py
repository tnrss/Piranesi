"""Piranesi FastAPI app: work/pay tracking, academics, calendar/todos, finance, and Canvas/Plaid sync routes."""

import os
import json
import base64
import hashlib
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen
from datetime import date, datetime, timedelta
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from plaid import Environment
from plaid.api import plaid_api
from plaid.api_client import ApiClient
from plaid.configuration import Configuration
from plaid.exceptions import ApiException
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.liabilities_get_request import LiabilitiesGetRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.products import Products
from plaid.model.webhook_verification_key_get_request import WebhookVerificationKeyGetRequest
from sqlalchemy.orm import Session
from database import SessionLocal
import models, schemas


def load_env_file() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def get_plaid_client_id() -> str | None:
    return os.getenv("PLAID_CLIENT_ID") or os.getenv("PLAID_USER_ID")


def get_plaid_secret() -> str | None:
    return os.getenv("PLAID_SECRET") or os.getenv("PLAID_KEY")


def plaid_is_configured() -> bool:
    return bool(get_plaid_client_id() and get_plaid_secret())


def get_canvas_api_url() -> str:
    return os.getenv("CANVAS_API_URL", "").strip().rstrip("/")


def canvas_is_configured() -> bool:
    return bool(get_canvas_api_url() and os.getenv("CANVAS_API_TOKEN", "").strip())


def canvas_get(path: str) -> list | dict:
    request = UrlRequest(
        f"{get_canvas_api_url()}{path}",
        headers={
            "Authorization": f"Bearer {os.getenv('CANVAS_API_TOKEN', '').strip()}",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Canvas API request failed: {exc}") from exc


def canvas_course_instructor(course: dict) -> str | None:
    teachers = course.get("teachers") or []
    if teachers and isinstance(teachers[0], dict):
        return teachers[0].get("display_name") or teachers[0].get("name")
    return None


def remove_null_canvas_courses(db: Session) -> None:
    null_courses = (
        db.query(models.CanvasCourse)
        .filter(models.CanvasCourse.name == "NULL")
        .all()
    )
    for course in null_courses:
        mappings = (
            db.query(models.CanvasAssignment)
            .filter(models.CanvasAssignment.canvas_course_id == course.canvas_course_id)
            .all()
        )
        for mapping in mappings:
            task = db.query(models.AcademicTask).filter(models.AcademicTask.id == mapping.task_id).first()
            if task:
                db.delete(task)
            db.delete(mapping)

        grade = (
            db.query(models.CanvasCourseGrade)
            .filter(models.CanvasCourseGrade.canvas_course_id == course.canvas_course_id)
            .first()
        )
        if grade:
            db.delete(grade)
        db.delete(course)

    db.commit()


def remove_canvas_assignments_for_course(db: Session, course_id: str) -> None:
    mappings = (
        db.query(models.CanvasAssignment)
        .filter(models.CanvasAssignment.canvas_course_id == course_id)
        .all()
    )
    for mapping in mappings:
        task = db.query(models.AcademicTask).filter(models.AcademicTask.id == mapping.task_id).first()
        if task:
            db.delete(task)
        db.delete(mapping)
    db.commit()


def parse_csv_env(name: str, default: str) -> list[str]:
    raw_value = os.getenv(name, default)
    return [part.strip() for part in raw_value.split(",") if part.strip()]


def get_plaid_environment() -> str:
    return os.getenv("PLAID_ENV", "sandbox").strip().lower()


def get_plaid_host() -> str:
    env_name = get_plaid_environment()
    development_host = getattr(Environment, "Development", "https://development.plaid.com")
    host_map = {
        "sandbox": Environment.Sandbox,
        "development": development_host,
        "production": Environment.Production,
    }
    return host_map.get(env_name, Environment.Sandbox)


def get_plaid_client() -> plaid_api.PlaidApi:
    client_id = get_plaid_client_id()
    secret = get_plaid_secret()
    if not client_id or not secret:
        raise HTTPException(status_code=400, detail="Plaid credentials are missing")

    configuration = Configuration(
        host=get_plaid_host(),
        api_key={
            "clientId": client_id,
            "secret": secret,
            "plaidVersion": "2020-09-14",
        },
    )
    return plaid_api.PlaidApi(ApiClient(configuration))


def model_to_dict(model: object) -> dict:
    if hasattr(model, "to_dict"):
        return model.to_dict()
    if isinstance(model, dict):
        return model
    return {}


def plaid_products() -> list[Products]:
    requested = parse_csv_env("PLAID_PRODUCTS", "transactions,liabilities")
    # liabilities is required to fetch credit card due dates/minimum payments
    if "liabilities" not in requested:
        requested.append("liabilities")
    return [Products(item) for item in dict.fromkeys(requested)]


def plaid_countries() -> list[CountryCode]:
    return [CountryCode(item.upper()) for item in parse_csv_env("PLAID_COUNTRY_CODES", "US")]


_webhook_verification_keys: dict[str, ec.EllipticCurvePublicKey] = {}


def _b64url_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def get_webhook_verification_key(key_id: str) -> ec.EllipticCurvePublicKey:
    cached = _webhook_verification_keys.get(key_id)
    if cached:
        return cached

    response = get_plaid_client().webhook_verification_key_get(
        WebhookVerificationKeyGetRequest(key_id=key_id)
    )
    key_data = model_to_dict(response).get("key", {})
    x = int.from_bytes(_b64url_decode(key_data["x"]), "big")
    y = int.from_bytes(_b64url_decode(key_data["y"]), "big")
    public_key = ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()
    _webhook_verification_keys[key_id] = public_key
    return public_key


def verify_plaid_webhook(raw_body: bytes, signed_jwt: str) -> dict:
    """Validate a Plaid webhook's ES256 JWT signature and body hash. Raises HTTPException on failure."""
    try:
        header_b64, payload_b64, signature_b64 = signed_jwt.split(".")
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
        signature = _b64url_decode(signature_b64)
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Malformed webhook signature") from exc

    if header.get("alg") != "ES256" or len(signature) != 64:
        raise HTTPException(status_code=401, detail="Unsupported webhook signature algorithm")

    try:
        public_key = get_webhook_verification_key(header["kid"])
        der_signature = encode_dss_signature(
            int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big")
        )
        public_key.verify(der_signature, f"{header_b64}.{payload_b64}".encode("ascii"), ec.ECDSA(hashes.SHA256()))
    except (ApiException, InvalidSignature, KeyError) as exc:
        raise HTTPException(status_code=401, detail="Invalid webhook signature") from exc

    if abs(time.time() - float(payload.get("iat", 0))) > 300:
        raise HTTPException(status_code=401, detail="Webhook signature expired")

    if hashlib.sha256(raw_body).hexdigest() != payload.get("request_body_sha256"):
        raise HTTPException(status_code=401, detail="Webhook body hash mismatch")

    return payload


def sync_balances_for_item(
    db: Session,
    plaid_client: plaid_api.PlaidApi,
    access_token: str,
    item_id: str,
) -> int:
    balance_request = AccountsBalanceGetRequest(access_token=access_token)
    response = plaid_client.accounts_balance_get(balance_request)
    payload = model_to_dict(response)
    accounts = payload.get("accounts", [])

    synced_count = 0
    for account in accounts:
        account_id = account.get("account_id")
        if not account_id:
            continue

        external_item_key = f"{item_id}:{account_id}"
        balances = account.get("balances", {})
        # Depository (checking/savings) accounts: banks like BofA show the "available" balance
        # (which nets out pending holds) as the primary figure, not "current".
        # Credit/loan accounts should keep "current" as the primary balance.
        if account.get("type") == "depository":
            current_balance = balances.get("available")
            if current_balance is None:
                current_balance = balances.get("current")
        else:
            current_balance = balances.get("current")
            if current_balance is None:
                current_balance = balances.get("available")
        if current_balance is None:
            current_balance = 0.0

        account_type = account.get("type", "unknown")
        account_subtype = account.get("subtype")
        if account_subtype:
            account_type = f"{account_type}/{account_subtype}"

        existing = (
            db.query(models.FinancialAccount)
            .filter(models.FinancialAccount.plaid_item_id == external_item_key)
            .first()
        )
        if not existing:
            # Relinking the same institution creates a new Plaid item_id, so fall back to
            # matching by name to avoid duplicating accounts already tracked under an older item.
            existing = (
                db.query(models.FinancialAccount)
                .filter(models.FinancialAccount.account_name == account.get("name"))
                .first()
            )
        if existing:
            existing.plaid_item_id = external_item_key
            existing.account_name = account.get("name", existing.account_name)
            existing.current_balance = float(current_balance)
            existing.account_type = account_type
            existing.last_synced = datetime.utcnow()
        else:
            db.add(
                models.FinancialAccount(
                    plaid_item_id=external_item_key,
                    account_name=account.get("name", "Plaid Account"),
                    current_balance=float(current_balance),
                    account_type=account_type,
                    last_synced=datetime.utcnow(),
                )
            )
        synced_count += 1

    plaid_item = db.query(models.PlaidItem).filter(models.PlaidItem.item_id == item_id).first()
    if plaid_item:
        plaid_item.last_synced = datetime.utcnow()
    db.commit()
    return synced_count


load_env_file()

app = FastAPI(title="Piranesi API")

DEFAULT_HOURLY_RATE = env_float("DEFAULT_HOURLY_RATE", 18.0)
DEFAULT_HOURS_CAP = env_float("DEFAULT_HOURS_CAP", 28.0)
PAYROLL_DEDUCTION_RATE = env_float("PAYROLL_DEDUCTION_RATE", 0.0765)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1):[0-9]+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# This function safely opens and closes the database connection for each request
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def read_root():
    return {"status": "Piranesi backend is running"}

# --- WORK SHIFT ENDPOINTS ---

@app.post("/shifts/", response_model=schemas.WorkShiftResponse)
def create_shift(shift: schemas.WorkShiftCreate, db: Session = Depends(get_db)):
    db_shift = models.WorkShift(**shift.model_dump())
    db.add(db_shift)
    db.commit()
    db.refresh(db_shift)
    return db_shift

@app.get("/shifts/", response_model=list[schemas.WorkShiftResponse])
def get_shifts(db: Session = Depends(get_db)):
    return db.query(models.WorkShift).all()


def clock_status(session: models.WorkClockSession) -> schemas.ClockStatusResponse:
    now = session.clocked_out_at or datetime.utcnow()
    elapsed_hours = round(max((now - session.clocked_in_at).total_seconds(), 0) / 3600, 2)
    return schemas.ClockStatusResponse(
        is_clocked_in=session.clocked_out_at is None,
        clocked_in_at=session.clocked_in_at,
        elapsed_hours=elapsed_hours,
    )


# --- WORK CLOCK ENDPOINTS ---

@app.get("/work/clock", response_model=schemas.ClockStatusResponse)
def get_clock_status(db: Session = Depends(get_db)):
    session = (
        db.query(models.WorkClockSession)
        .filter(models.WorkClockSession.clocked_out_at.is_(None))
        .order_by(models.WorkClockSession.id.desc())
        .first()
    )
    if not session:
        return schemas.ClockStatusResponse(is_clocked_in=False)
    return clock_status(session)


@app.post("/work/clock-in", response_model=schemas.ClockActionResponse)
def clock_in(db: Session = Depends(get_db)):
    existing = (
        db.query(models.WorkClockSession)
        .filter(models.WorkClockSession.clocked_out_at.is_(None))
        .first()
    )
    if existing:
        current = clock_status(existing)
        return schemas.ClockActionResponse(**current.model_dump(), message="Already clocked in.")

    session = models.WorkClockSession(
        clocked_in_at=datetime.utcnow(),
        hourly_rate=DEFAULT_HOURLY_RATE,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    current = clock_status(session)
    return schemas.ClockActionResponse(**current.model_dump(), message="Clocked in.")


@app.post("/work/clock-out", response_model=schemas.ClockActionResponse)
def clock_out(db: Session = Depends(get_db)):
    session = (
        db.query(models.WorkClockSession)
        .filter(models.WorkClockSession.clocked_out_at.is_(None))
        .order_by(models.WorkClockSession.id.desc())
        .first()
    )
    if not session:
        raise HTTPException(status_code=400, detail="No active clock-in found")

    session.clocked_out_at = datetime.utcnow()
    hours_worked = round(max((session.clocked_out_at - session.clocked_in_at).total_seconds(), 0) / 3600, 2)
    shift = models.WorkShift(
        date=session.clocked_in_at.date(),
        hours_worked=hours_worked,
        hourly_rate=session.hourly_rate,
        task_notes="Clocked shift",
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    current = clock_status(session)
    return schemas.ClockActionResponse(
        **current.model_dump(),
        message=f"Clocked out. Added {hours_worked} hours to shifts.",
        shift_id=shift.id,
    )


@app.patch("/shifts/{shift_id:int}", response_model=schemas.WorkShiftResponse)
def update_shift(shift_id: int, payload: schemas.WorkShiftUpdate, db: Session = Depends(get_db)):
    shift = db.query(models.WorkShift).filter(models.WorkShift.id == shift_id).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(shift, field, value)
    db.commit()
    db.refresh(shift)
    return shift


@app.delete("/shifts/{shift_id:int}")
def delete_shift(shift_id: int, db: Session = Depends(get_db)):
    shift = db.query(models.WorkShift).filter(models.WorkShift.id == shift_id).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    db.delete(shift)
    db.commit()
    return {"deleted": 1, "shift_id": shift_id}


@app.delete("/shifts/reset-week")
def reset_week_shifts(week_start: date | None = None, db: Session = Depends(get_db)):
    start = week_start or (date.today() - timedelta(days=date.today().weekday()))
    end = start + timedelta(days=6)

    deleted_count = (
        db.query(models.WorkShift)
        .filter(models.WorkShift.date >= start)
        .filter(models.WorkShift.date <= end)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {
        "deleted": deleted_count,
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
    }


@app.get("/shifts/summary", response_model=schemas.WorkWeekSummary)
def get_shift_summary(
    week_start: date | None = None,
    hourly_rate: float = DEFAULT_HOURLY_RATE,
    hours_cap: float = DEFAULT_HOURS_CAP,
    db: Session = Depends(get_db),
):
    start = week_start or (date.today() - timedelta(days=date.today().weekday()))
    end = start + timedelta(days=6)

    shifts = (
        db.query(models.WorkShift)
        .filter(models.WorkShift.date >= start)
        .filter(models.WorkShift.date <= end)
        .all()
    )
    total_hours = round(sum(shift.hours_worked for shift in shifts), 2)
    capped_hours = round(min(total_hours, hours_cap), 2)
    estimated_pay = round(capped_hours * hourly_rate, 2)
    deduction_amount = round(estimated_pay * PAYROLL_DEDUCTION_RATE, 2)
    estimated_net_pay = round(estimated_pay - deduction_amount, 2)

    return schemas.WorkWeekSummary(
        week_start=start,
        week_end=end,
        total_hours=total_hours,
        hours_cap=hours_cap,
        hourly_rate=hourly_rate,
        estimated_pay=estimated_pay,
        deduction_rate=PAYROLL_DEDUCTION_RATE,
        deduction_amount=deduction_amount,
        estimated_net_pay=estimated_net_pay,
        capped_hours=capped_hours,
        cap_warning=total_hours > hours_cap,
    )


# --- ACADEMIC TASK ENDPOINTS ---

@app.post("/tasks/", response_model=schemas.AcademicTaskResponse)
def create_task(task: schemas.AcademicTaskCreate, db: Session = Depends(get_db)):
    db_task = models.AcademicTask(**task.model_dump())
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


@app.get("/tasks/", response_model=list[schemas.AcademicTaskResponse])
def list_tasks(include_completed: bool = True, db: Session = Depends(get_db)):
    query = db.query(models.AcademicTask)
    if not include_completed:
        query = query.filter(models.AcademicTask.is_completed.is_(False))
    return query.order_by(models.AcademicTask.due_date.asc()).all()


@app.patch("/tasks/{task_id}", response_model=schemas.AcademicTaskResponse)
def update_task(task_id: int, payload: schemas.AcademicTaskUpdate, db: Session = Depends(get_db)):
    task = db.query(models.AcademicTask).filter(models.AcademicTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@app.delete("/tasks/{task_id:int}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(models.AcademicTask).filter(models.AcademicTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    mapping = db.query(models.CanvasAssignment).filter(models.CanvasAssignment.task_id == task_id).first()
    if mapping:
        db.delete(mapping)
    db.delete(task)
    db.commit()
    return {"deleted": 1, "task_id": task_id}


# --- CANVAS INTEGRATION ENDPOINTS ---

@app.get("/integrations/canvas/courses", response_model=list[schemas.CanvasCourseResponse])
def list_canvas_courses(db: Session = Depends(get_db)):
    return db.query(models.CanvasCourse).order_by(models.CanvasCourse.name.asc()).all()


@app.get("/integrations/canvas/grades", response_model=list[schemas.CanvasGradeResponse])
def list_canvas_grades(db: Session = Depends(get_db)):
    return db.query(models.CanvasCourseGrade).order_by(models.CanvasCourseGrade.canvas_course_id.asc()).all()


@app.put("/integrations/canvas/grades/{canvas_course_id}", response_model=schemas.CanvasGradeResponse)
def set_canvas_grade_override(
    canvas_course_id: str,
    payload: schemas.GradeOverrideUpdate,
    db: Session = Depends(get_db),
):
    grade = (
        db.query(models.CanvasCourseGrade)
        .filter(models.CanvasCourseGrade.canvas_course_id == canvas_course_id)
        .first()
    )
    if not grade:
        raise HTTPException(status_code=404, detail="Canvas grade not found")

    grade.local_override = payload.local_override
    db.commit()
    db.refresh(grade)
    return grade


@app.post("/integrations/canvas/sync-full", response_model=schemas.CanvasSyncResponse)
def sync_canvas_full(db: Session = Depends(get_db)):
    if not canvas_is_configured():
        raise HTTPException(
            status_code=400,
            detail="Canvas is not configured. Add CANVAS_API_URL and CANVAS_API_TOKEN to backend/.env.",
        )

    courses = canvas_get("/api/v1/courses?enrollment_state=active&include[]=teachers&per_page=100")
    if not isinstance(courses, list):
        raise HTTPException(status_code=502, detail="Canvas returned an invalid courses response")

    for course in courses:
        course_id = course.get("id")
        if not course_id:
            continue
        course_key = str(course_id)
        course_name = course.get("name") or course.get("course_code") or ""
        if course_name.strip().upper() == "NULL":
            continue
        local_course = (
            db.query(models.CanvasCourse)
            .filter(models.CanvasCourse.canvas_course_id == course_key)
            .first()
        )
        if not local_course:
            local_course = models.CanvasCourse(canvas_course_id=course_key)
            db.add(local_course)

        local_course.name = course_name or f"Canvas course {course_id}"
        local_course.course_code = course.get("course_code")
        local_course.instructor = canvas_course_instructor(course)
        local_course.last_synced = datetime.utcnow()

        enrollments = canvas_get(
            f"/api/v1/courses/{course_id}/enrollments?user_id=self&include[]=current_grades&per_page=100"
        )
        enrollment = enrollments[0] if isinstance(enrollments, list) and enrollments else {}
        current_grades = enrollment.get("grades", {}) if isinstance(enrollment, dict) else {}
        local_grade = (
            db.query(models.CanvasCourseGrade)
            .filter(models.CanvasCourseGrade.canvas_course_id == course_key)
            .first()
        )
        if not local_grade:
            local_grade = models.CanvasCourseGrade(canvas_course_id=course_key)
            db.add(local_grade)
        local_grade.current_score = current_grades.get("current_score")
        local_grade.current_grade = current_grades.get("current_grade")
        local_grade.last_synced = datetime.utcnow()

    db.commit()
    remove_null_canvas_courses(db)
    assignment_sync = sync_canvas_assignments(db)
    remove_null_canvas_courses(db)
    return assignment_sync


# --- MANUAL EXAM ENDPOINTS ---

@app.post("/exams/", response_model=schemas.ManualExamResponse)
def create_manual_exam(exam: schemas.ManualExamCreate, db: Session = Depends(get_db)):
    db_exam = models.ManualExam(**exam.model_dump())
    db.add(db_exam)
    db.commit()
    db.refresh(db_exam)
    return db_exam


@app.get("/exams/", response_model=list[schemas.ManualExamResponse])
def list_manual_exams(db: Session = Depends(get_db)):
    return db.query(models.ManualExam).order_by(models.ManualExam.exam_date.asc()).all()


@app.delete("/exams/{exam_id}")
def delete_manual_exam(exam_id: int, db: Session = Depends(get_db)):
    exam = db.query(models.ManualExam).filter(models.ManualExam.id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    db.delete(exam)
    db.commit()
    return {"deleted": 1, "exam_id": exam_id}


# --- CALENDAR NOTE ENDPOINTS (per-day notes + day log shown on the calendar) ---

@app.get("/calendar/notes/", response_model=list[schemas.CalendarNoteResponse])
def list_calendar_notes(db: Session = Depends(get_db)):
    return db.query(models.CalendarNote).order_by(models.CalendarNote.note_date.asc()).all()


@app.put("/calendar/notes/{note_date}", response_model=schemas.CalendarNoteResponse)
def upsert_calendar_note(note_date: date, payload: schemas.CalendarNoteUpsert, db: Session = Depends(get_db)):
    note = db.query(models.CalendarNote).filter(models.CalendarNote.note_date == note_date).first()
    if not note:
        note = models.CalendarNote(note_date=note_date, content="")
        db.add(note)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(note, field, value)
    note.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(note)
    return note


@app.delete("/calendar/notes/{note_date}")
def delete_calendar_note(note_date: date, db: Session = Depends(get_db)):
    note = db.query(models.CalendarNote).filter(models.CalendarNote.note_date == note_date).first()
    if not note:
        raise HTTPException(status_code=404, detail="Calendar note not found")
    db.delete(note)
    db.commit()
    return {"deleted": 1, "note_date": str(note_date)}


# --- TODO ENDPOINTS (manual week-based checklist, shown on the homepage) ---

@app.post("/todos/", response_model=schemas.TodoItemResponse)
def create_todo(todo: schemas.TodoItemCreate, db: Session = Depends(get_db)):
    db_todo = models.TodoItem(**todo.model_dump())
    db.add(db_todo)
    db.commit()
    db.refresh(db_todo)
    return db_todo


@app.get("/todos/", response_model=list[schemas.TodoItemResponse])
def list_todos(db: Session = Depends(get_db)):
    return db.query(models.TodoItem).order_by(models.TodoItem.created_at.asc()).all()


@app.patch("/todos/{todo_id}", response_model=schemas.TodoItemResponse)
def update_todo(todo_id: int, payload: schemas.TodoItemUpdate, db: Session = Depends(get_db)):
    todo = db.query(models.TodoItem).filter(models.TodoItem.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    changes = payload.model_dump(exclude_unset=True)
    recurrence = changes.get("recurrence", todo.recurrence)
    if changes.get("is_completed") is True and recurrence in {"daily", "weekly"}:
        interval = timedelta(days=1 if recurrence == "daily" else 7)
        next_due = (todo.due_date or datetime.now()) + interval
        while next_due <= datetime.now():
            next_due += interval
        changes["due_date"] = next_due
        changes["is_completed"] = False
    for field, value in changes.items():
        setattr(todo, field, value)
    db.commit()
    db.refresh(todo)
    return todo


@app.delete("/todos/{todo_id}")
def delete_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(models.TodoItem).filter(models.TodoItem.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    db.delete(todo)
    db.commit()
    return {"deleted": 1, "todo_id": todo_id}


@app.get("/integrations/canvas/status", response_model=schemas.CanvasStatus)
def get_canvas_status():
    return schemas.CanvasStatus(
        configured=canvas_is_configured(),
        api_url=get_canvas_api_url() or "Not configured",
    )


@app.post("/integrations/canvas/sync", response_model=schemas.CanvasSyncResponse)
def sync_canvas_assignments(db: Session = Depends(get_db)):
    if not canvas_is_configured():
        raise HTTPException(
            status_code=400,
            detail="Canvas is not configured. Add CANVAS_API_URL and CANVAS_API_TOKEN to backend/.env.",
        )

    courses = canvas_get("/api/v1/courses?enrollment_state=active&per_page=100")
    if not isinstance(courses, list):
        raise HTTPException(status_code=502, detail="Canvas returned an invalid courses response")

    assignments_found = 0
    tasks_created = 0
    tasks_updated = 0

    for course in courses:
        course_id = course.get("id")
        if not course_id:
            continue

        course_name = course.get("name") or course.get("course_code") or f"Canvas course {course_id}"
        if course_name.strip().upper() == "NULL":
            remove_canvas_assignments_for_course(db, str(course_id))
            continue
        assignments = canvas_get(f"/api/v1/courses/{course_id}/assignments?per_page=100")
        if not isinstance(assignments, list):
            continue

        for assignment in assignments:
            assignment_id = assignment.get("id")
            due_at = assignment.get("due_at")
            title = assignment.get("name")
            if not assignment_id or not due_at or not title:
                continue

            assignments_found += 1
            due_date = datetime.fromisoformat(due_at.replace("Z", "+00:00")).replace(tzinfo=None)
            mapping = (
                db.query(models.CanvasAssignment)
                .filter(models.CanvasAssignment.canvas_assignment_id == str(assignment_id))
                .first()
            )

            if mapping:
                task = db.query(models.AcademicTask).filter(models.AcademicTask.id == mapping.task_id).first()
                if not task:
                    continue
                tasks_updated += 1
            else:
                task = models.AcademicTask(
                    course_name=course_name,
                    title=title,
                    due_date=due_date,
                    task_type="Canvas Assignment",
                    is_completed=bool(assignment.get("has_submitted_submissions", False)),
                )
                db.add(task)
                db.flush()
                db.add(
                    models.CanvasAssignment(
                        canvas_assignment_id=str(assignment_id),
                        canvas_course_id=str(course_id),
                        task_id=task.id,
                    )
                )
                tasks_created += 1

            task.course_name = course_name
            task.title = title
            task.due_date = due_date
            task.is_completed = bool(assignment.get("has_submitted_submissions", task.is_completed))
            if mapping:
                mapping.canvas_course_id = str(course_id)
                mapping.last_synced = datetime.utcnow()

    db.commit()
    return schemas.CanvasSyncResponse(
        courses_checked=len(courses),
        assignments_found=assignments_found,
        tasks_created=tasks_created,
        tasks_updated=tasks_updated,
        synced_at=datetime.utcnow(),
    )


# --- FINANCE ENDPOINTS ---

@app.post("/finance/accounts/", response_model=schemas.FinancialAccountResponse)
def create_financial_account(
    account: schemas.FinancialAccountCreate,
    db: Session = Depends(get_db),
):
    db_account = models.FinancialAccount(
        **account.model_dump(),
        last_synced=datetime.utcnow(),
    )
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account


@app.get("/finance/accounts/", response_model=list[schemas.FinancialAccountResponse])
def list_financial_accounts(db: Session = Depends(get_db)):
    return db.query(models.FinancialAccount).order_by(models.FinancialAccount.account_name.asc()).all()


@app.delete("/finance/accounts/{account_id}")
def delete_financial_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    db.delete(account)
    db.commit()
    return {"deleted": 1, "account_id": account_id}


@app.patch("/finance/accounts/{account_id}", response_model=schemas.FinancialAccountResponse)
def update_financial_account(
    account_id: int,
    payload: schemas.FinancialAccountUpdate,
    db: Session = Depends(get_db),
):
    account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    account.last_synced = datetime.utcnow()
    db.commit()
    db.refresh(account)
    return account


@app.get("/finance/summary", response_model=schemas.FinanceSummary)
def get_finance_summary(db: Session = Depends(get_db)):
    accounts = db.query(models.FinancialAccount).all()
    assets_total = 0.0
    liabilities_total = 0.0

    for account in accounts:
        account_type = account.account_type.lower()
        if "credit" in account_type:
            liabilities_total += abs(account.current_balance)
        else:
            assets_total += account.current_balance

    return schemas.FinanceSummary(
        assets_total=round(assets_total, 2),
        liabilities_total=round(liabilities_total, 2),
        net_worth=round(assets_total - liabilities_total, 2),
    )


# --- CLASS MEETING ENDPOINTS ---

@app.post("/class-meetings/", response_model=schemas.ClassMeetingResponse)
def create_class_meeting(payload: schemas.ClassMeetingCreate, db: Session = Depends(get_db)):
    meeting = models.ClassMeeting(**payload.model_dump())
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


@app.get("/class-meetings/", response_model=list[schemas.ClassMeetingResponse])
def list_class_meetings(db: Session = Depends(get_db)):
    return db.query(models.ClassMeeting).order_by(models.ClassMeeting.start.asc(), models.ClassMeeting.name.asc()).all()


@app.patch("/class-meetings/{meeting_id}", response_model=schemas.ClassMeetingResponse)
def update_class_meeting(
    meeting_id: int,
    payload: schemas.ClassMeetingUpdate,
    db: Session = Depends(get_db),
):
    meeting = db.query(models.ClassMeeting).filter(models.ClassMeeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Class meeting not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(meeting, field, value)
    db.commit()
    db.refresh(meeting)
    return meeting


@app.delete("/class-meetings/{meeting_id}")
def delete_class_meeting(meeting_id: int, db: Session = Depends(get_db)):
    meeting = db.query(models.ClassMeeting).filter(models.ClassMeeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Class meeting not found")
    db.delete(meeting)
    db.commit()
    return {"deleted": 1, "meeting_id": meeting_id}


@app.get("/finance/liabilities", response_model=list[schemas.LiabilityInfo])
def get_liabilities(db: Session = Depends(get_db)):
    if not plaid_is_configured():
        raise HTTPException(status_code=400, detail="Plaid credentials are missing")

    items = db.query(models.PlaidItem).filter(models.PlaidItem.access_token.isnot(None)).all()
    if not items:
        return []

    plaid_client = get_plaid_client()
    results: list[schemas.LiabilityInfo] = []

    for item in items:
        try:
            response = plaid_client.liabilities_get(LiabilitiesGetRequest(access_token=item.access_token))
        except ApiException:
            # item may not have granted the liabilities product; skip it
            continue

        payload = model_to_dict(response)
        credit_by_account_id = {
            credit.get("account_id"): credit
            for credit in (payload.get("liabilities") or {}).get("credit") or []
        }
        # Plaid can take a while to generate liability details after linking, so fall back
        # to the plain account list (still returned even when "credit" data is null) and
        # surface those as pending rather than silently omitting them.
        credit_accounts = [account for account in payload.get("accounts") or [] if account.get("type") == "credit"]

        for account_payload in credit_accounts:
            plaid_account_id = account_payload.get("account_id")
            credit = credit_by_account_id.get(plaid_account_id, {})
            external_key = f"{item.item_id}:{plaid_account_id}"
            account = (
                db.query(models.FinancialAccount)
                .filter(models.FinancialAccount.plaid_item_id == external_key)
                .first()
            )
            results.append(
                schemas.LiabilityInfo(
                    account_id=account.id if account else None,
                    plaid_account_id=plaid_account_id,
                    account_name=account.account_name if account else account_payload.get("name", "Unknown credit card"),
                    next_payment_due_date=credit.get("next_payment_due_date"),
                    minimum_payment_amount=credit.get("minimum_payment_amount"),
                )
            )

    return results


# --- PLAID INTEGRATION ENDPOINTS ---

@app.get("/integrations/plaid/status", response_model=schemas.PlaidStatus)
def get_plaid_status(db: Session = Depends(get_db)):
    has_keys = plaid_is_configured()
    state = db.query(models.PlaidConnectionState).first()
    if not state:
        state = models.PlaidConnectionState(is_connected=False)
        db.add(state)
        db.commit()
        db.refresh(state)

    return schemas.PlaidStatus(
        configured=has_keys,
        connected=state.is_connected,
        institution=state.institution,
        environment=get_plaid_environment(),
        items_connected=db.query(models.PlaidItem).count(),
    )


@app.get("/integrations/plaid/items", response_model=list[schemas.PlaidItemResponse])
def list_plaid_items(db: Session = Depends(get_db)):
    return db.query(models.PlaidItem).order_by(models.PlaidItem.created_at.asc()).all()


@app.delete("/integrations/plaid/items/{item_id}")
def disconnect_plaid_item(item_id: str, db: Session = Depends(get_db)):
    plaid_item = db.query(models.PlaidItem).filter(models.PlaidItem.item_id == item_id).first()
    if not plaid_item and item_id.isdigit():
        plaid_item = db.query(models.PlaidItem).filter(models.PlaidItem.id == int(item_id)).first()
    if not plaid_item:
        raise HTTPException(status_code=404, detail="Plaid item not found")

    try:
        get_plaid_client().item_remove(ItemRemoveRequest(access_token=plaid_item.access_token))
    except ApiException as exc:
        raise HTTPException(status_code=400, detail=f"Plaid item removal error: {exc}") from exc

    account_prefix = f"{plaid_item.item_id}:%"
    accounts_deleted = (
        db.query(models.FinancialAccount)
        .filter(models.FinancialAccount.plaid_item_id.like(account_prefix))
        .delete(synchronize_session=False)
    )
    db.delete(plaid_item)

    external_item_id = plaid_item.item_id
    remaining_items = db.query(models.PlaidItem).filter(models.PlaidItem.id != plaid_item.id).count()
    state = db.query(models.PlaidConnectionState).first()
    if state:
        state.is_connected = remaining_items > 0
        state.updated_at = datetime.utcnow()
    db.commit()
    return {"deleted": 1, "item_id": external_item_id, "accounts_deleted": accounts_deleted}


@app.post("/integrations/plaid/webhook")
async def receive_plaid_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    signed_jwt = request.headers.get("plaid-verification")
    if not signed_jwt:
        raise HTTPException(status_code=401, detail="Missing webhook verification header")

    verify_plaid_webhook(raw_body, signed_jwt)

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Malformed webhook body") from exc

    webhook_type = payload.get("webhook_type")
    webhook_code = payload.get("webhook_code")
    item_id = payload.get("item_id")

    if webhook_type == "LIABILITIES" and item_id:
        plaid_item = db.query(models.PlaidItem).filter(models.PlaidItem.item_id == item_id).first()
        if plaid_item:
            plaid_item.liabilities_updated_at = datetime.utcnow()
            db.commit()

    return {"acknowledged": True, "webhook_type": webhook_type, "webhook_code": webhook_code}


@app.post("/integrations/plaid/link-token", response_model=schemas.PlaidLinkTokenResponse)
def create_plaid_link_token(payload: schemas.PlaidLinkTokenCreateRequest):
    if not plaid_is_configured():
        raise HTTPException(status_code=400, detail="Plaid credentials are missing")

    client_user_id = payload.client_user_id or f"piranesi-{int(datetime.utcnow().timestamp())}"
    request_kwargs = {
        "products": plaid_products(),
        "client_name": "Piranesi",
        "country_codes": plaid_countries(),
        "language": "en",
        "user": LinkTokenCreateRequestUser(client_user_id=client_user_id),
    }
    redirect_uri = (os.getenv("PLAID_REDIRECT_URI") or "").strip()
    if redirect_uri:
        request_kwargs["redirect_uri"] = redirect_uri

    webhook_url = (os.getenv("PLAID_WEBHOOK_URL") or "").strip()
    if webhook_url:
        request_kwargs["webhook"] = webhook_url

    link_request = LinkTokenCreateRequest(**request_kwargs)

    try:
        response = get_plaid_client().link_token_create(link_request)
    except (ApiException, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Plaid link token error: {exc}") from exc

    payload_data = model_to_dict(response)
    return schemas.PlaidLinkTokenResponse(
        link_token=payload_data.get("link_token", ""),
        mode=get_plaid_environment(),
        message="Plaid link token created.",
    )


@app.post("/integrations/plaid/exchange", response_model=schemas.PlaidExchangeResponse)
def exchange_public_token(
    payload: schemas.PlaidPublicTokenExchangeRequest,
    db: Session = Depends(get_db),
):
    if not plaid_is_configured():
        raise HTTPException(status_code=400, detail="Plaid credentials are missing")

    try:
        exchange_response = get_plaid_client().item_public_token_exchange(
            ItemPublicTokenExchangeRequest(public_token=payload.public_token)
        )
    except ApiException as exc:
        raise HTTPException(status_code=400, detail=f"Plaid token exchange error: {exc}") from exc

    exchange_data = model_to_dict(exchange_response)
    access_token = exchange_data.get("access_token")
    item_id = exchange_data.get("item_id")
    if not access_token or not item_id:
        raise HTTPException(status_code=502, detail="Plaid response did not include access token")

    plaid_item = db.query(models.PlaidItem).filter(models.PlaidItem.item_id == item_id).first()
    if plaid_item:
        plaid_item.access_token = access_token
    else:
        db.add(models.PlaidItem(item_id=item_id, access_token=access_token))

    state = db.query(models.PlaidConnectionState).first()
    if not state:
        state = models.PlaidConnectionState()
        db.add(state)
    state.is_connected = True
    state.updated_at = datetime.utcnow()
    db.commit()

    synced_accounts = sync_balances_for_item(db, get_plaid_client(), access_token, item_id)
    return schemas.PlaidExchangeResponse(
        item_id=item_id,
        accounts_synced=synced_accounts,
        message="Public token exchanged and balances synced.",
    )


@app.post("/integrations/plaid/sync", response_model=schemas.PlaidSyncResponse)
def sync_plaid_balances(item_id: str | None = None, db: Session = Depends(get_db)):
    if item_id:
        plaid_items = [db.query(models.PlaidItem).filter(models.PlaidItem.item_id == item_id).first()]
        if not plaid_items[0]:
            raise HTTPException(status_code=404, detail="No connected Plaid item found")
    else:
        # No item_id means "sync everything", not just the most recently linked item.
        plaid_items = db.query(models.PlaidItem).all()
        if not plaid_items:
            raise HTTPException(status_code=404, detail="No connected Plaid item found")

    synced_count = 0
    for plaid_item in plaid_items:
        if not plaid_item.access_token:
            continue
        try:
            synced_count += sync_balances_for_item(
                db,
                get_plaid_client(),
                plaid_item.access_token,
                plaid_item.item_id,
            )
        except ApiException as exc:
            raise HTTPException(status_code=400, detail=f"Plaid sync error: {exc}") from exc

    return schemas.PlaidSyncResponse(
        item_id=item_id,
        accounts_synced=synced_count,
        synced_at=datetime.utcnow(),
    )