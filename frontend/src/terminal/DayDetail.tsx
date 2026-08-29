// Single-day drill-down opened by typing a date (e.g. "08/24") or clicking a day header in WeekSchedule.
import { useState } from 'react'
import { classesForDay, formatTime12h, isSameDay, isToday, shiftNetPay, type ClassMeeting } from './classSchedule'
import type { AcademicTask, CalendarNote, Exam, TodoItem, WorkShift } from './TerminalUI'

type DayDetailProps = {
  dateKey: string
  tasks: AcademicTask[]
  exams: Exam[]
  classMeetings: ClassMeeting[]
  todos: TodoItem[]
  shifts: WorkShift[]
  deductionRate: number
  note: CalendarNote | undefined
  onSaveNote: (content: string) => void
  onSaveLog: (dayLog: string) => void
  onToggleTodo: (id: number, isCompleted: boolean) => void
  onBack: () => void
}

export function DayDetail({ dateKey, tasks, exams, classMeetings, todos, shifts, deductionRate, note, onSaveNote, onSaveLog, onToggleTodo, onBack }: DayDetailProps) {
  const date = new Date(`${dateKey}T12:00:00`)
  const [contentDraft, setContentDraft] = useState(note?.content ?? '')
  const [logDraft, setLogDraft] = useState(note?.day_log ?? '')

  const dayClasses = classesForDay(classMeetings, date)
  const dayTasks = tasks.filter((task) => !task.is_completed && isSameDay(task.due_date, date))
  const dayExams = exams.filter((exam) => isSameDay(exam.exam_date, date))
  const dayTodos = todos.filter((todo) => todo.due_date && isSameDay(todo.due_date, date))
  const dayShifts = shifts.filter((shift) => shift.date === dateKey)
  const fullLabel = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="day-detail">
      <div className="day-detail-header">
        <button type="button" onClick={onBack}>&lsaquo; back to week</button>
        <span className={isToday(date) ? 'accent today-label' : 'accent'}>{fullLabel}</span>
      </div>
      <div className="day-detail-columns">
        <div className="day-detail-pane">
          <div className="block-title">CLASSES</div>
          {dayClasses.length === 0 && <p className="muted">no classes</p>}
          {dayClasses.map((cls) => (
            <p key={cls.id}><span className="accent">{formatTime12h(cls.start)}-{formatTime12h(cls.end)}</span> {cls.name}{cls.room ? ` // ${cls.room}` : ''}</p>
          ))}
          <div className="block-title">DUE TODAY</div>
          {dayTasks.map((task) => (
            <p key={`task-${task.id}`}><span className="accent">DUE</span> {task.course_name}: {task.title}</p>
          ))}
          {dayExams.map((exam) => (
            <p key={`exam-${exam.id}`}><span className="warn">EXAM</span> {exam.course_name}: {exam.title}</p>
          ))}
          {dayTasks.length === 0 && dayExams.length === 0 && dayTodos.length === 0 && <p className="muted">nothing due</p>}
          {dayTodos.length > 0 && <div className="block-title">TODO</div>}
          {dayTodos.map((todo) => (
            <p key={`todo-${todo.id}`} className={todo.is_completed ? 'muted' : ''}>
              <label>
                <input type="checkbox" checked={todo.is_completed} onChange={(event) => onToggleTodo(todo.id, event.target.checked)} />{' '}
                {todo.description}
              </label>
            </p>
          ))}
          {dayShifts.length > 0 && <div className="block-title">SHIFT</div>}
          {dayShifts.map((shift) => (
            <p key={`shift-${shift.id}`}><span className="accent">{shift.hours_worked}h</span> // net ${shiftNetPay(shift, deductionRate).toFixed(2)} {shift.task_notes || ''}</p>
          ))}
        </div>
        <div className="day-detail-pane">
          <div className="block-title">NOTES</div>
          <textarea
            className="day-detail-textarea"
            value={contentDraft}
            placeholder="notes for this day..."
            onChange={(event) => setContentDraft(event.target.value)}
            onBlur={(event) => onSaveNote(event.target.value)}
          />
          <div className="block-title">DAY LOG</div>
          <textarea
            className="day-detail-textarea"
            value={logDraft}
            placeholder="how did the day go..."
            onChange={(event) => setLogDraft(event.target.value)}
            onBlur={(event) => onSaveLog(event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
