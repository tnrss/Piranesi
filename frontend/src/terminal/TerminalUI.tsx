import { useEffect, useRef, useState } from 'react'
import { getSuggestions, parseViewCommand, terminalCommands, type Suggestion, type TerminalCommand } from './CommandParser'
import { WeekSchedule, type CalendarWeek } from './WeekSchedule'
import './Terminal.css'

type WorkSummary = {
  total_hours: number
  hours_cap: number
  estimated_pay: number
  deduction_amount: number
  estimated_net_pay: number
}
type ClockStatus = { is_clocked_in: boolean; clocked_in_at: string | null; elapsed_hours: number }

type WorkShift = { id: number; date: string; hours_worked: number; task_notes: string | null }
type AcademicTask = { id: number; course_name: string; title: string; due_date: string; task_type: string; is_completed: boolean }
type Exam = { id: number; course_name: string; title: string; exam_date: string; notes: string | null }
type Course = { canvas_course_id: string; name: string; course_code: string | null; instructor: string | null }
type Grade = { canvas_course_id: string; current_score: number | null; current_grade: string | null; local_override: string | null }
type Account = { id: number; account_name: string; account_type: string; current_balance: number }
type FinanceSummary = { assets_total: number; liabilities_total: number; net_worth: number }
type PlaidStatus = { configured: boolean; connected: boolean; environment: string; items_connected: number }

export type TerminalData = {
  workSummary: WorkSummary | null
  clockStatus: ClockStatus | null
  shifts: WorkShift[]
  tasks: AcademicTask[]
  exams: Exam[]
  courses: Course[]
  grades: Grade[]
  accounts: Account[]
  financeSummary: FinanceSummary | null
  plaidStatus: PlaidStatus | null
  calendarWeek: CalendarWeek | null
}

type TerminalUIProps = {
  data: TerminalData
  status: string
  onCommand: (command: string) => void
  onNavigateWeek: (direction: -1 | 0 | 1) => void
  onToggleTodo: (id: number, completed: boolean) => void
  onSaveCalendarNote: (noteDate: string, content: string) => void
}

function money(value: number | undefined) {
  return `$${(value ?? 0).toFixed(2)}`
}

export function TerminalUI({ data, status, onCommand, onNavigateWeek, onToggleTodo, onSaveCalendarNote }: TerminalUIProps) {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [view, setView] = useState<TerminalCommand>('overview')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function submit() {
    const value = input.trim()
    if (!value) return
    setView(parseViewCommand(value))
    setHistory((items) => [value, ...items])
    setHistoryIndex(-1)
    setInput('')
    onCommand(value)
    setSuggestions([])
  }

  function runQuickCommand(command: TerminalCommand) {
    setView(command === 'clock in' || command === 'clock out' ? 'work' : command)
    onCommand(command)
  }

  function applySuggestion(suggestion: Suggestion) {
    setInput(suggestion.insert || `${suggestion.value} `)
    setSuggestions([])
    inputRef.current?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      if (suggestions.length > 0 && input.trim().endsWith(' ')) {
        applySuggestion(suggestions[suggestionIndex])
        return
      }
      submit()
    }
    if (event.key === 'Tab' && suggestions.length > 0) {
      event.preventDefault()
      applySuggestion(suggestions[suggestionIndex])
      return
    }
    if (event.key === 'Escape') {
      setSuggestions([])
      return
    }
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setSuggestionIndex((index) => (index + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setSuggestionIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHistoryIndex((index) => Math.min(index + 1, history.length - 1))
      setInput(history[Math.min(historyIndex + 1, history.length - 1)] ?? '')
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIndex = Math.max(historyIndex - 1, -1)
      setHistoryIndex(nextIndex)
      setInput(nextIndex === -1 ? '' : history[nextIndex])
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      setView('overview')
      onCommand('clear')
    }
  }

  const gradeByCourse = new Map(data.grades.map((grade) => [grade.canvas_course_id, grade]))
  const showOverview = view === 'overview' || view === 'sync' || view === 'help' || view === 'clear'

  return (
    <main className="terminal-shell" onClick={(event) => {
      if (!(event.target as HTMLElement).closest('button, input, textarea')) inputRef.current?.focus()
    }}>
      <header className="terminal-header">
        <span className="terminal-brand">PIRANESI // LIFE LOG</span>
        <span className="terminal-status">{status}</span>
      </header>

      <section className="terminal-overview">
        <div className="terminal-line">{`> ${view}`}</div>
        <p>personal command center // {data.courses.length} active courses // {data.tasks.filter((task) => !task.is_completed).length} open assignments</p>
      </section>

      <section className={`terminal-columns view-${view}`}>
        {view === 'schedule' ? (
          <WeekSchedule
            week={data.calendarWeek}
            onNavigate={onNavigateWeek}
            onToggleTodo={onToggleTodo}
            onSaveNote={onSaveCalendarNote}
          />
        ) : (<>
        <div className="terminal-pane">
          <div className="pane-title">ACADEMICS + WORK</div>
          {(showOverview || view === 'grades') && <div className="terminal-block">
            <div className="block-title">COURSES / GRADES</div>
            {data.courses.length === 0 && <p className="muted">no synced courses</p>}
            {data.courses.map((course) => {
              const grade = gradeByCourse.get(course.canvas_course_id)
              return (
                <p key={course.canvas_course_id}>
                  <span className="accent">{course.course_code || course.name}</span>{' '}
                  {grade?.local_override || grade?.current_grade || (grade?.current_score != null ? `${grade.current_score}%` : '--')}
                </p>
              )
            })}
          </div>}
          {(showOverview || view === 'grades') && <div className="terminal-block">
            <div className="block-title">ASSIGNMENTS / EXAMS</div>
            {data.tasks.filter((task) => !task.is_completed).slice(0, 8).map((task) => (
              <p key={task.id}><span className="accent">{new Date(task.due_date).toLocaleDateString()}</span> {task.course_name}: {task.title}</p>
            ))}
            {data.exams.map((exam) => (
              <p key={exam.id}><span className="warn">EXAM {new Date(exam.exam_date).toLocaleDateString()}</span> {exam.course_name}: {exam.title}</p>
            ))}
            {data.tasks.filter((task) => !task.is_completed).length === 0 && data.exams.length === 0 && <p className="muted">nothing due</p>}
          </div>}
          {(showOverview || view === 'work') && <div className="terminal-block">
            <div className="block-title">WORK / PAY</div>
            <p className={data.clockStatus?.is_clocked_in ? 'accent' : 'muted'}>
              {data.clockStatus?.is_clocked_in ? `clocked in // ${data.clockStatus.elapsed_hours}h elapsed` : 'clocked out'}
            </p>
            <p>{data.workSummary?.total_hours ?? 0}h / {data.workSummary?.hours_cap ?? 28}h cap</p>
            <p>gross {money(data.workSummary?.estimated_pay)} // deduction {money(data.workSummary?.deduction_amount)}</p>
            <p className="accent">net {money(data.workSummary?.estimated_net_pay)}</p>
          </div>}
        </div>

        <div className="terminal-pane">
          <div className="pane-title">MONEY</div>
          {(showOverview || view === 'money') && <div className="terminal-block">
            <div className="block-title">BALANCE SNAPSHOT</div>
            {data.accounts.map((account) => (
              <p key={account.id}><span className="accent">{account.account_name}</span> {money(account.current_balance)} [{account.account_type}]</p>
            ))}
            {data.accounts.length === 0 && <p className="muted">no accounts</p>}
            <p>assets {money(data.financeSummary?.assets_total)}</p>
            <p>liabilities {money(data.financeSummary?.liabilities_total)}</p>
            <p className="accent">net worth {money(data.financeSummary?.net_worth)}</p>
          </div>}
          {(showOverview || view === 'money') && <div className="terminal-block">
            <div className="block-title">PLAID</div>
            <p>environment: {data.plaidStatus?.environment ?? '--'}</p>
            <p>configured: {data.plaidStatus?.configured ? 'yes' : 'no'}</p>
            <p>items: {data.plaidStatus?.items_connected ?? 0}</p>
          </div>}
          {(showOverview || view === 'work') && <div className="terminal-block">
            <div className="block-title">SHIFTS</div>
            {data.shifts.slice(0, 8).map((shift) => (
              <p key={shift.id}><span className="accent">{shift.date}</span> {shift.hours_worked}h {shift.task_notes || ''}</p>
            ))}
            {data.shifts.length === 0 && <p className="muted">no shifts logged</p>}
          </div>}
        </div>
        </>)}
      </section>

      <section className="terminal-history" aria-live="polite">
        {history.length > 0 && <p className="muted">last command: {history[0]}</p>}
      </section>

      <footer className="terminal-footer">
        <nav className="command-links" aria-label="Terminal commands">
          {terminalCommands.map((command) => (
            <button key={command} type="button" onClick={() => runQuickCommand(command)}>[{command}]</button>
          ))}
        </nav>
        <label className="prompt-line">
          <span>&gt;</span>
          <input ref={inputRef} value={input} onChange={(event) => { setInput(event.target.value); setSuggestionIndex(0); setSuggestions(getSuggestions(event.target.value, data)) }} onKeyDown={handleKeyDown} placeholder="type a command" aria-label="Terminal command" autoComplete="off" />
          <span className="cursor" aria-hidden="true">_</span>
        </label>
        {suggestions.length > 0 && <div className="terminal-suggestions" role="listbox">
          {suggestions.map((suggestion, index) => (
            <button key={suggestion.value} type="button" className={index === suggestionIndex ? 'selected' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => applySuggestion(suggestion)}>
              <span>{suggestion.value}</span><span className="muted">{suggestion.detail}</span>
            </button>
          ))}
        </div>}
        <p className="muted">type help for commands // Tab completes suggestions // Enter executes</p>
      </footer>
    </main>
  )
}

