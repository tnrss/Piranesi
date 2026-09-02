import { useState } from 'react'

export type ClassMeeting = {
  id: number
  name: string
  days: number[]
  start: string
  end: string
  room: string | null
}

export type TodoItem = {
  id: number
  description: string
  due_date: string | null
  is_completed: boolean
  recurrence: 'none' | 'daily' | 'weekly'
  created_at: string
}

export type CalendarNote = {
  id: number
  note_date: string
  content: string
  day_log: string | null
  updated_at: string
}

export type CalendarDay = {
  date: string
  class_meetings: ClassMeeting[]
  shifts: { id: number; date: string; hours_worked: number; hourly_rate: number; task_notes: string | null }[]
  assignments: { id: number; course_name: string; title: string; due_date: string; task_type: string; is_completed: boolean }[]
  exams: { id: number; course_name: string; title: string; exam_date: string; notes: string | null }[]
  todos: TodoItem[]
  note: CalendarNote | null
}

export type CalendarWeek = { start: string; end: string; days: CalendarDay[] }

type WeekScheduleProps = {
  week: CalendarWeek | null
  onNavigate: (direction: -1 | 0 | 1) => void
  onToggleTodo: (id: number, completed: boolean) => void
  onSaveNote: (date: string, content: string) => void
}

function formatDay(dateValue: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${dateValue}T12:00:00`).toLocaleDateString(undefined, options)
}

function DailyNoteEditor({ day, onSave }: { day: CalendarDay; onSave: (date: string, content: string) => void }) {
  const [draft, setDraft] = useState(day.note?.content ?? '')
  return (
    <textarea
      id="daily-note"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onSave(day.date, draft)}
      placeholder="notes for this day..."
    />
  )
}

export function WeekSchedule({ week, onNavigate, onToggleTodo, onSaveNote }: WeekScheduleProps) {
  const [selectedDate, setSelectedDate] = useState(week?.days[0]?.date ?? '')
  const selectedDay = week?.days.find((day) => day.date === selectedDate) ?? week?.days[0]

  if (!week || !selectedDay) {
    return <div className="week-workspace muted">loading calendar...</div>
  }

  return (
    <div className="week-workspace">
      <div className="week-toolbar">
        <button type="button" onClick={() => onNavigate(-1)} aria-label="Previous week" title="Previous week">‹</button>
        <strong>{formatDay(week.start, { month: 'short', day: 'numeric' })}–{formatDay(week.end, { month: 'short', day: 'numeric' })}</strong>
        <button type="button" onClick={() => onNavigate(0)}>Today</button>
        <button type="button" onClick={() => onNavigate(1)} aria-label="Next week" title="Next week">›</button>
      </div>

      <div className="week-strip" aria-label="Seven day calendar">
        {week.days.map((day) => {
          const itemCount = day.class_meetings.length + day.assignments.length + day.exams.length + day.todos.length + day.shifts.length
          return (
            <button
              type="button"
              key={day.date}
              className={day.date === selectedDay.date ? 'selected' : ''}
              aria-pressed={day.date === selectedDay.date}
              onClick={() => setSelectedDate(day.date)}
            >
              <span>{formatDay(day.date, { weekday: 'short' })}</span>
              <strong>{formatDay(day.date, { day: 'numeric' })}</strong>
              <small>{itemCount || '·'}{day.note ? ' +' : ''}</small>
            </button>
          )
        })}
      </div>

      <div className="day-workspace">
        <section className="day-agenda">
          <div className="block-title">{formatDay(selectedDay.date, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          {selectedDay.class_meetings.map((meeting) => (
            <p key={`class-${meeting.id}`}><span className="accent">{meeting.start}–{meeting.end}</span> {meeting.name}{meeting.room ? ` // ${meeting.room}` : ''}</p>
          ))}
          {selectedDay.assignments.map((assignment) => (
            <p key={`assignment-${assignment.id}`}><span className="accent">DUE</span> {assignment.course_name}: {assignment.title}</p>
          ))}
          {selectedDay.exams.map((exam) => (
            <p key={`exam-${exam.id}`}><span className="warn">EXAM</span> {exam.course_name}: {exam.title}</p>
          ))}
          {selectedDay.shifts.map((shift) => (
            <p key={`shift-${shift.id}`}><span className="accent">SHIFT</span> {shift.hours_worked}h {shift.task_notes ?? ''}</p>
          ))}
          {selectedDay.todos.map((todo) => (
            <label className="day-todo" key={`todo-${todo.id}`}>
              <input type="checkbox" checked={todo.is_completed} onChange={(event) => onToggleTodo(todo.id, event.target.checked)} />
              <span>{todo.description}{todo.recurrence !== 'none' ? ` // ${todo.recurrence}` : ''}</span>
            </label>
          ))}
          {selectedDay.class_meetings.length + selectedDay.assignments.length + selectedDay.exams.length + selectedDay.shifts.length + selectedDay.todos.length === 0 && (
            <p className="muted">nothing scheduled</p>
          )}
        </section>

        <section className="day-note">
          <label className="block-title" htmlFor="daily-note">DAILY NOTE</label>
          <DailyNoteEditor key={`${selectedDay.date}:${selectedDay.note?.updated_at ?? ''}`} day={selectedDay} onSave={onSaveNote} />
        </section>
      </div>
    </div>
  )
}