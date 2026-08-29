// Root component: owns fetched data + theme/week state and wires terminal commands to the backend API.
import { useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import './App.css'
import { parseCommand } from './terminal/CommandParser'
import { TerminalUI, type TerminalData } from './terminal/TerminalUI'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const themes: Record<string, { bg: string; text: string; accent: string }> = {
  default: { bg: '#23282b', text: '#ffffff', accent: '#bd064c' },
  matrix: { bg: '#050805', text: '#72f27b', accent: '#27c93f' },
  amber: { bg: '#100c05', text: '#ffe6a3', accent: '#ffb000' },
  ice: { bg: '#07141c', text: '#d8f6ff', accent: '#38c8ff' },
  piranesi: { bg: '#394b9f', text: '#fffbee', accent: '#d3c48a' },
}

function parseCommandDate(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const monthDay = /^(\d{1,2})\/(\d{1,2})$/.exec(trimmed)
  const normalized = monthDay
    ? `${new Date().getFullYear()}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}T12:00:00`
    : trimmed
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function isDateLike(value: string | undefined): boolean {
  return Boolean(value && (/^\d{1,2}\/\d{1,2}$/.test(value) || !Number.isNaN(new Date(value).getTime())))
}

function parseMeetingDays(value: string | undefined): number[] | null {
  if (!value) return null
  const aliases: Record<string, number> = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
    wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5, sat: 6, saturday: 6,
  }
  const days = value.split(',').map((part) => {
    const normalized = part.trim().toLowerCase()
    return normalized in aliases ? aliases[normalized] : Number(normalized)
  })
  return days.length > 0 && days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ? [...new Set(days)]
    : null
}

const emptyData: TerminalData = {
  workSummary: null,
  clockStatus: null,
  shifts: [],
  tasks: [],
  exams: [],
  classMeetings: [],
  courses: [],
  grades: [],
  accounts: [],
  financeSummary: null,
  liabilities: [],
  plaidStatus: null,
  plaidItems: [],
  calendarNotes: [],
  todos: [],
}

function App() {
  const [data, setData] = useState<TerminalData>(emptyData)
  const [status, setStatus] = useState('booting...')
  const [weekOffset, setWeekOffset] = useState(0)
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null)

  useEffect(() => {
    const savedTheme = localStorage.getItem('piranesi-theme') || 'default'
    applyTheme(savedTheme)
  }, [])

  const { open: openPlaidLink, ready: plaidLinkReady } = usePlaidLink({
    token: plaidLinkToken,
    onSuccess: (public_token) => { void handlePlaidSuccess(public_token) },
    onExit: () => { setPlaidLinkToken(null) },
  })

  useEffect(() => {
    if (plaidLinkReady && plaidLinkToken) openPlaidLink()
  }, [plaidLinkReady, plaidLinkToken, openPlaidLink])

  async function startPlaidLink() {
    setStatus('requesting plaid link token...')
    try {
      const response = await fetch(`${API_BASE}/integrations/plaid/link-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = await response.json() as { link_token?: string; detail?: string }
      if (!response.ok || !result.link_token) {
        setStatus(result.detail || 'plaid link token request failed')
        return
      }
      setPlaidLinkToken(result.link_token)
      setStatus('opening plaid link...')
    } catch {
      setStatus('plaid link failed // backend unavailable')
    }
  }

  async function handlePlaidSuccess(publicToken: string | null) {
    setPlaidLinkToken(null)
    if (!publicToken) return
    setStatus('linking plaid account...')
    try {
      const response = await fetch(`${API_BASE}/integrations/plaid/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token: publicToken }),
      })
      const result = await response.json() as { detail?: string; accounts_synced?: number }
      if (!response.ok) {
        setStatus(result.detail || 'plaid link failed')
        return
      }
      await loadData()
      setStatus(`plaid linked // ${result.accounts_synced ?? 0} accounts synced`)
    } catch {
      setStatus('plaid link failed // backend unavailable')
    }
  }

  function applyTheme(name: string) {
    const theme = themes[name]
    if (!theme) return false
    document.documentElement.style.setProperty('--bg', theme.bg)
    document.documentElement.style.setProperty('--text', theme.text)
    document.documentElement.style.setProperty('--accent', theme.accent)
    document.documentElement.dataset.theme = name
    localStorage.setItem('piranesi-theme', name)
    return true
  }

  async function loadData(attempt = 0) {
    try {
      const responses = await Promise.all([
        fetch(`${API_BASE}/shifts/`),
        fetch(`${API_BASE}/shifts/summary`),
        fetch(`${API_BASE}/work/clock`),
        fetch(`${API_BASE}/tasks/`),
        fetch(`${API_BASE}/exams/`),
        fetch(`${API_BASE}/class-meetings/`),
        fetch(`${API_BASE}/integrations/canvas/courses`),
        fetch(`${API_BASE}/integrations/canvas/grades`),
        fetch(`${API_BASE}/finance/accounts/`),
        fetch(`${API_BASE}/finance/summary`),
        fetch(`${API_BASE}/finance/liabilities`),
        fetch(`${API_BASE}/integrations/plaid/status`),
        fetch(`${API_BASE}/integrations/plaid/items`),
        fetch(`${API_BASE}/calendar/notes/`),
        fetch(`${API_BASE}/todos/`),
      ])

      const [shiftsRes, workSummaryRes, clockStatusRes, tasksRes, examsRes, classMeetingsRes, coursesRes, gradesRes, accountsRes, financeSummaryRes, liabilitiesRes, plaidStatusRes, plaidItemsRes, calendarNotesRes, todosRes] = responses

      if ([shiftsRes, workSummaryRes, clockStatusRes, tasksRes, examsRes, classMeetingsRes, coursesRes, gradesRes, accountsRes, financeSummaryRes, plaidStatusRes, plaidItemsRes, calendarNotesRes, todosRes].some((response) => !response.ok)) {
        throw new Error('one or more API requests failed')
      }

      const [shifts, workSummary, clockStatus, tasks, exams, classMeetings, courses, grades, accounts, financeSummary, liabilities, plaidStatus, plaidItems, calendarNotes, todos] = await Promise.all(
        [shiftsRes, workSummaryRes, clockStatusRes, tasksRes, examsRes, classMeetingsRes, coursesRes, gradesRes, accountsRes, financeSummaryRes, liabilitiesRes, plaidStatusRes, plaidItemsRes, calendarNotesRes, todosRes].map((response) => response.json())
      )
      setData({ workSummary, clockStatus, shifts, tasks, exams, classMeetings, courses, grades, accounts, financeSummary, liabilities: liabilitiesRes.ok ? liabilities : [], plaidStatus, plaidItems, calendarNotes, todos })
      setStatus('online')
    } catch {
      setStatus('backend unavailable // run ./start-piranesi.sh')
      if (attempt < 3) {
        window.setTimeout(() => void loadData(attempt + 1), 1000)
      }
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function onCommand(input: string) {
    const command = parseCommand(input)
    if (command.action === 'theme') {
      const name = (command.args[0] || 'default').toLowerCase()
      setStatus(applyTheme(name) ? `theme ${name} applied` : 'unknown theme // try theme matrix, amber, ice, piranesi, or default')
      return
    }
    if (command.action === 'clear') {
      setStatus('online // cleared')
      return
    }
    if (command.action === 'help') {
      setStatus('clock in|out | add shift|assignment|exam|class|account|account plaid | delete <entity> <id> | sync canvas|plaid|all')
      return
    }
    if (command.action === 'clock-in' || command.action === 'clock-out') {
      const endpoint = command.action === 'clock-in' ? '/work/clock-in' : '/work/clock-out'
      try {
        const response = await fetch(`${API_BASE}${endpoint}`, { method: 'POST' })
        const result = await response.json() as { message?: string; detail?: string }
        setStatus(response.ok ? (result.message || 'clock updated') : (result.detail || 'clock action failed'))
        if (response.ok) await loadData()
      } catch {
        setStatus('clock action failed // backend unavailable')
      }
      return
    }
    if (command.action === 'sync') {
      const target = command.entity ?? command.args[0] ?? 'canvas'
      setStatus(`syncing ${target}...`)
      try {
        if (target === 'canvas' || target === 'all') {
          const response = await fetch(`${API_BASE}/integrations/canvas/sync-full`, { method: 'POST' })
          if (!response.ok) throw new Error('Canvas sync failed')
        }
        if (target === 'plaid' || target === 'all') {
          const response = await fetch(`${API_BASE}/integrations/plaid/sync`, { method: 'POST' })
          if (!response.ok) throw new Error('Plaid sync failed')
        }
        await loadData()
        setStatus(`online // ${target} synced`)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'sync failed')
      }
      return
    }

    if (command.action === 'add') {
      const flags = command.flags
      let path = ''
      let body: Record<string, unknown> = {}
      if (command.entity === 'shift' || command.entity === 'work') {
        const shiftDate = flags.date || (isDateLike(command.args[1]) ? command.args[1] : undefined)
        const parsedShiftDate = parseCommandDate(shiftDate)
        path = '/shifts/'
        body = { date: parsedShiftDate?.slice(0, 10) || (shiftDate ? null : new Date().toISOString().slice(0, 10)), hours_worked: Number(flags.hours || command.args[0]), hourly_rate: Number(flags.rate || 18), task_notes: flags.note || null }
      } else if (command.entity === 'assignment' || command.entity === 'task') {
        const assignmentDate = flags.due || flags.date || command.args.at(-1)
        path = '/tasks/'
        body = { course_name: flags.course || command.args[0], title: flags.title || command.args.slice(1, isDateLike(command.args.at(-1)) ? -1 : undefined).join(' '), due_date: parseCommandDate(assignmentDate), task_type: flags.type || 'Assignment' }
      } else if (command.entity === 'exam') {
        const examDate = flags.date || flags.due || command.args.at(-1)
        path = '/exams/'
        body = { course_name: flags.course || 'Manual Exam', title: flags.title || command.args.slice(0, isDateLike(command.args.at(-1)) ? -1 : undefined).join(' '), exam_date: parseCommandDate(examDate), notes: flags.note || null }
      } else if (command.entity === 'class') {
        path = '/class-meetings/'
        body = { name: flags.name || command.args[0], days: parseMeetingDays(flags.days), start: flags.start, end: flags.end, room: flags.room || null }
      } else if (command.entity === 'account' && command.args[0]?.toLowerCase() === 'plaid') {
        await startPlaidLink()
        return
      } else if (command.entity === 'account') {
        path = '/finance/accounts/'
        body = { plaid_item_id: flags.item || `manual-${Date.now()}`, account_name: flags.name || command.args[0], current_balance: Number(flags.balance || command.args[1]), account_type: flags.type || 'checking' }
      }
      if (!path || Object.values(body).some((value) => value === undefined || (typeof value === 'number' && Number.isNaN(value)))) {
        setStatus('usage: add shift --hours=8 [--date=YYYY-MM-DD] | add assignment --course="CS" --title="Lab" --due=ISO')
        return
      }
      const requiredFieldMissing =
        (path === '/shifts/' && (body.date === null || body.hours_worked === undefined || Number.isNaN(body.hours_worked))) ||
        (path === '/tasks/' && (!body.course_name || !body.title || body.due_date === null)) ||
        (path === '/exams/' && (!body.title || body.exam_date === null)) ||
        (path === '/class-meetings/' && (!body.name || !body.days || !body.start || !body.end)) ||
        (path === '/finance/accounts/' && (!body.account_name || body.current_balance === undefined || Number.isNaN(body.current_balance)))
      if (requiredFieldMissing) {
        setStatus(command.entity === 'class'
          ? 'usage: add class --name="Course" --days=mon,wed,fri --start=09:00 --end=09:50 [--room="Room"]'
          : 'usage: add exam [name] [month/day] // or use --date=YYYY-MM-DD')
        return
      }
      try {
        const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        if (!response.ok) {
          const result = await response.json() as { detail?: string }
          setStatus(result.detail || 'add failed // check command fields')
          return
        }
        await loadData()
        setStatus(`added ${command.entity}`)
      } catch {
        setStatus('add failed // backend unavailable')
      }
      return
    }

    if (command.action === 'delete') {
      const entity = command.entity
      const isPlaidDisconnect = entity === 'account' && command.args[0]?.toLowerCase() === 'plaid'
      const id = Number(command.args[isPlaidDisconnect ? 1 : 0])
      if (!entity || !Number.isInteger(id)) {
        setStatus('usage: delete shift|assignment|exam|class|account <id> | delete account plaid <id>')
        return
      }
      if (isPlaidDisconnect) {
        if (!window.confirm(`Disconnect Plaid item #${id} and delete its synced accounts?`)) {
          setStatus('plaid disconnect cancelled')
          return
        }
        try {
          const response = await fetch(`${API_BASE}/integrations/plaid/items/${id}`, { method: 'DELETE' })
          const result = await response.json() as { detail?: string; accounts_deleted?: number }
          setStatus(response.ok ? `plaid item #${id} disconnected // ${result.accounts_deleted ?? 0} accounts removed` : (result.detail || `could not disconnect plaid item #${id}`))
          if (response.ok) await loadData()
        } catch {
          setStatus('plaid disconnect failed // backend unavailable')
        }
        return
      }
      const label = entity === 'assignment' || entity === 'task' ? 'task' : entity
      const path = label === 'shift' ? `/shifts/${id}` : label === 'task' ? `/tasks/${id}` : label === 'exam' ? `/exams/${id}` : label === 'class' ? `/class-meetings/${id}` : `/finance/accounts/${id}`
      if (!window.confirm(`Delete ${label} #${id}?`)) {
        setStatus('delete cancelled')
        return
      }
      const response = await fetch(`${API_BASE}${path}`, { method: 'DELETE' })
      setStatus(response.ok ? `deleted ${label} #${id}` : `could not delete ${label} #${id}`)
      if (response.ok) await loadData()
      return
    }

    if (command.action === 'done' || command.action === 'reopen') {
      const id = Number(command.args[0])
      if (!Number.isInteger(id)) {
        setStatus(`usage: assignment ${command.action} <id>`)
        return
      }
      const response = await fetch(`${API_BASE}/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_completed: command.action === 'done' }) })
      setStatus(response.ok ? `assignment #${id} ${command.action === 'done' ? 'completed' : 'reopened'}` : 'assignment update failed')
      if (response.ok) await loadData()
      return
    }

    if (command.action === 'reset' && (command.entity === 'work' || command.entity === 'shift')) {
      if (!window.confirm("Reset this week's shifts?")) return
      const response = await fetch(`${API_BASE}/shifts/reset-week`, { method: 'DELETE' })
      setStatus(response.ok ? 'weekly shifts reset' : 'shift reset failed')
      if (response.ok) await loadData()
      return
    }

    setStatus(`${command.entity || 'command'} // ready`)
  }

  async function saveCalendarNote(dateKey: string, payload: { content?: string; day_log?: string }) {
    try {
      const response = await fetch(`${API_BASE}/calendar/notes/${dateKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        setStatus('note save failed')
        return
      }
      const saved = await response.json() as { id: number; note_date: string; content: string; day_log: string | null; updated_at: string }
      setData((prev) => ({
        ...prev,
        calendarNotes: [...prev.calendarNotes.filter((note) => note.note_date !== dateKey), saved],
      }))
      setStatus(`note saved // ${dateKey}`)
    } catch {
      setStatus('note save failed // backend unavailable')
    }
  }

  async function addTodo(description: string, dueDate: string | null, recurrence: 'none' | 'daily' | 'weekly') {
    try {
      const response = await fetch(`${API_BASE}/todos/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, due_date: dueDate ? `${dueDate}T12:00:00` : null, recurrence }),
      })
      if (!response.ok) {
        setStatus('add todo failed')
        return
      }
      await loadData()
      setStatus('todo added')
    } catch {
      setStatus('add todo failed // backend unavailable')
    }
  }

  async function updateTodo(id: number, payload: { description?: string; due_date?: string | null; is_completed?: boolean; recurrence?: 'none' | 'daily' | 'weekly' }) {
    const body = 'due_date' in payload ? { ...payload, due_date: payload.due_date ? `${payload.due_date}T12:00:00` : null } : payload
    try {
      const response = await fetch(`${API_BASE}/todos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        setStatus('todo update failed')
        return
      }
      await loadData()
    } catch {
      setStatus('todo update failed // backend unavailable')
    }
  }

  async function deleteTodo(id: number) {
    try {
      const response = await fetch(`${API_BASE}/todos/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        setStatus('todo delete failed')
        return
      }
      await loadData()
      setStatus('todo deleted')
    } catch {
      setStatus('todo delete failed // backend unavailable')
    }
  }

  return (
    <TerminalUI
      data={data}
      status={status}
      onCommand={(input) => void onCommand(input)}
      weekOffset={weekOffset}
      onNavigateWeek={setWeekOffset}
      onSaveCalendarNote={(dateKey, payload) => void saveCalendarNote(dateKey, payload)}
      onAddTodo={(description, dueDate, recurrence) => void addTodo(description, dueDate, recurrence)}
      onUpdateTodo={(id, payload) => void updateTodo(id, payload)}
      onDeleteTodo={(id) => void deleteTodo(id)}
    />
  )
}

export default App
