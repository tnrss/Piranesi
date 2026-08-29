// Mon-Sun block calendar: API-backed classes, due tasks/exams/todos/shifts per day, and per-day notes.
import { useState } from 'react'
import { classesForDay, formatTime12h, getWeekDates, isSameDay, isToday, shiftNetPay, toDateKey, type ClassMeeting } from './classSchedule'
import { TodoList } from './TodoList'
import type { AcademicTask, CalendarNote, Exam, TodoItem, TodoRecurrence, WorkShift } from './TerminalUI'

type WeekScheduleProps = {
  weekOffset: number
  tasks: AcademicTask[]
  exams: Exam[]
  classMeetings: ClassMeeting[]
  notes: CalendarNote[]
  todos: TodoItem[]
  shifts: WorkShift[]
  deductionRate: number
  onNavigate: (offset: number) => void
  onSaveNote: (dateKey: string, content: string) => void
  onOpenDay: (dateKey: string) => void
  onAddTodo: (description: string, dueDate: string | null, recurrence: TodoRecurrence) => void
  onUpdateTodo: (id: number, payload: { description?: string; due_date?: string | null; is_completed?: boolean; recurrence?: TodoRecurrence }) => void
  onDeleteTodo: (id: number) => void
}

const WEEKDAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

export function WeekSchedule({ weekOffset, tasks, exams, classMeetings, notes, todos, shifts, deductionRate, onNavigate, onSaveNote, onOpenDay, onAddTodo, onUpdateTodo, onDeleteTodo }: WeekScheduleProps) {
  const weekDates = getWeekDates(weekOffset)
  // Tracks in-progress edits so the textarea isn't reset by a re-fetch before the blur-save lands.
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const rangeLabel = `${weekDates[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${weekDates[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

  function noteFor(dateKey: string): string {
    if (dateKey in drafts) return drafts[dateKey]
    return notes.find((note) => note.note_date === dateKey)?.content ?? ''
  }

  return (
    <div className="week-schedule">
      <div className="week-schedule-nav">
        <button type="button" onClick={() => onNavigate(weekOffset - 1)}>&lsaquo; prev</button>
        <span className="accent">{weekOffset === 0 ? 'this week' : rangeLabel}</span>
        <button type="button" onClick={() => onNavigate(0)}>today</button>
        <button type="button" onClick={() => onNavigate(weekOffset + 1)}>next &rsaquo;</button>
      </div>
      <TodoList todos={todos} onAdd={onAddTodo} onUpdateTodo={onUpdateTodo} onDeleteTodo={onDeleteTodo} />
      <div className="week-schedule-grid">
        {weekDates.map((date, index) => {
          const dateKey = toDateKey(date)
          const dayClasses = classesForDay(classMeetings, date)
          const dayTasks = tasks.filter((task) => !task.is_completed && isSameDay(task.due_date, date))
          const dayExams = exams.filter((exam) => isSameDay(exam.exam_date, date))
          const dayTodos = todos.filter((todo) => todo.due_date && isSameDay(todo.due_date, date))
          const dayShifts = shifts.filter((shift) => shift.date === dateKey)
          return (
            <div key={dateKey} className={`week-day${isToday(date) ? ' today' : ''}`}>
              <button type="button" className="week-day-header" onClick={() => onOpenDay(dateKey)}>
                <span className="block-title">{WEEKDAY_LABELS[index]}</span>
                <span className="muted">{date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })}</span>
              </button>
              {dayClasses.length === 0 && <p className="muted">no classes</p>}
              {dayClasses.map((cls) => (
                <p key={cls.id}><span className="accent">{formatTime12h(cls.start)}-{formatTime12h(cls.end)}</span> {cls.name}{cls.room ? ` // ${cls.room}` : ''}</p>
              ))}
              {dayTasks.map((task) => (
                <p key={`task-${task.id}`}><span className="accent">DUE</span> {task.course_name}: {task.title}</p>
              ))}
              {dayExams.map((exam) => (
                <p key={`exam-${exam.id}`}><span className="warn">EXAM</span> {exam.course_name}: {exam.title}</p>
              ))}
              {dayTodos.map((todo) => (
                <p key={`todo-${todo.id}`} className={todo.is_completed ? 'muted' : ''}><span className="accent">TODO</span> {todo.description}</p>
              ))}
              {dayShifts.map((shift) => (
                <p key={`shift-${shift.id}`}><span className="accent">SHIFT</span> {shift.hours_worked}h // net ${shiftNetPay(shift, deductionRate).toFixed(2)}</p>
              ))}
              <textarea
                className="week-day-note"
                value={noteFor(dateKey)}
                placeholder="notes..."
                onChange={(event) => setDrafts((prev) => ({ ...prev, [dateKey]: event.target.value }))}
                onBlur={(event) => onSaveNote(dateKey, event.target.value)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
