from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

class WorkShiftBase(BaseModel):
    date: date
    hours_worked: float
    hourly_rate: float
    task_notes: Optional[str] = None

class WorkShiftCreate(WorkShiftBase):
    pass

class WorkShiftResponse(WorkShiftBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class WorkWeekSummary(BaseModel):
    week_start: date
    week_end: date
    total_hours: float
    hours_cap: float
    hourly_rate: float
    estimated_pay: float
    deduction_rate: float
    deduction_amount: float
    estimated_net_pay: float
    capped_hours: float
    cap_warning: bool


class AcademicTaskBase(BaseModel):
    course_name: str
    title: str
    due_date: datetime
    task_type: str


class AcademicTaskCreate(AcademicTaskBase):
    pass


class AcademicTaskUpdate(BaseModel):
    is_completed: Optional[bool] = None
    title: Optional[str] = None
    course_name: Optional[str] = None
    due_date: Optional[datetime] = None
    task_type: Optional[str] = None


class WorkShiftUpdate(BaseModel):
    date: Optional[date] = None
    hours_worked: Optional[float] = None
    hourly_rate: Optional[float] = None
    task_notes: Optional[str] = None


class FinancialAccountUpdate(BaseModel):
    account_name: Optional[str] = None
    current_balance: Optional[float] = None
    account_type: Optional[str] = None


class AcademicTaskResponse(AcademicTaskBase):
    id: int
    is_completed: bool

    model_config = ConfigDict(from_attributes=True)


class FinancialAccountBase(BaseModel):
    plaid_item_id: str
    account_name: str
    current_balance: float
    account_type: str


class FinancialAccountCreate(FinancialAccountBase):
    pass


class FinancialAccountResponse(FinancialAccountBase):
    id: int
    last_synced: datetime

    model_config = ConfigDict(from_attributes=True)


class FinanceSummary(BaseModel):
    assets_total: float
    liabilities_total: float
    net_worth: float


class PlaidStatus(BaseModel):
    configured: bool
    connected: bool
    institution: str
    environment: str
    items_connected: int


class PlaidLinkTokenResponse(BaseModel):
    link_token: str
    mode: str
    message: str


class PlaidLinkTokenCreateRequest(BaseModel):
    client_user_id: Optional[str] = None


class PlaidPublicTokenExchangeRequest(BaseModel):
    public_token: str


class PlaidExchangeResponse(BaseModel):
    item_id: str
    accounts_synced: int
    message: str


class PlaidSyncResponse(BaseModel):
    item_id: str
    accounts_synced: int
    synced_at: datetime


class CanvasStatus(BaseModel):
    configured: bool
    api_url: str


class CanvasSyncResponse(BaseModel):
    courses_checked: int
    assignments_found: int
    tasks_created: int
    tasks_updated: int
    synced_at: datetime


class CanvasCourseResponse(BaseModel):
    id: int
    canvas_course_id: str
    name: str
    course_code: Optional[str]
    instructor: Optional[str]
    last_synced: datetime

    model_config = ConfigDict(from_attributes=True)


class CanvasGradeResponse(BaseModel):
    id: int
    canvas_course_id: str
    current_score: Optional[float]
    current_grade: Optional[str]
    local_override: Optional[str]
    last_synced: datetime

    model_config = ConfigDict(from_attributes=True)


class ManualExamCreate(BaseModel):
    course_name: str
    title: str
    exam_date: datetime
    notes: Optional[str] = None


class ManualExamResponse(ManualExamCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class GradeOverrideUpdate(BaseModel):
    local_override: Optional[str] = None


class ClockStatusResponse(BaseModel):
    is_clocked_in: bool
    clocked_in_at: Optional[datetime] = None
    elapsed_hours: float = 0.0


class ClockActionResponse(ClockStatusResponse):
    message: str
    shift_id: Optional[int] = None