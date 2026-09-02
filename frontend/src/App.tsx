import { useEffect, useEffectEvent, useState } from 'react'
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

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function mondayFor(date = new Date()) {
  const monday = new Date(date)
  const weekday = monday.getDay()
  monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday))
  return localDateKey(monday)
}

function shiftDate(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T12:00:00`)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
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

const emptyData: TerminalData = {
  workSummary: null,
  clockStatus: null,
  shifts: [],
  tasks: [],
  exams: [],
  courses: [],
  grades: [],
  accounts: [],
  financeSummary: null,
  plaidStatus: null,
  calendarWeek: null,
}

function App() {
  const [data, setData] = useState<TerminalData>(emptyData)
  const [status, setStatus] = useState('booting...')
  const [weekStart, setWeekStart] = useState(() => mondayFor())
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null)

  useEffect(() => {
    const savedTheme = localStorage.getItem('piranesi-theme')
    const needsThemeRestore = savedTheme === 'default' && !localStorage.getItem('piranesi-theme-restored')
    applyTheme(needsThemeRestore ? 'piranesi' : savedTheme || 'piranesi')
    localStorage.setItem('piranesi-theme-restored', '1')
  }, [])

  const { open: openPlaidLink, ready: plaidLinkReady } = usePlaidLink({
    token: plaidLinkToken,
    onSuccess: (publicToken) => void handlePlaidSuccess(publicToken),
    onExit: () => setPlaidLinkToken(null),
  })

  useEffect(() => {
    if (plaidLinkReady && plaidLinkToken) openPlaidLink()
  }, [plaidLinkReady, plaidLinkToken, openPlaidLink])

  async function startPlaidLink() {
    setStatus('creating plaid link...')
    try {
      const response = await fetch(`${API_BASE}/integrations/plaid/link-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = await response.json() as { link_token?: string; detail?: string }
      if (!response.ok || !result.link_token) {
        setStatus(result.detail || 'plaid link request failed')
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
      const result = await response.json() as { accounts_synced?: number; detail?: string }
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
        fetch(`${API_BASE}/integrations/canvas/courses`),
        fetch(`${API_BASE}/integrations/canvas/grades`),
        fetch(`${API_BASE}/finance/accounts/`),
        fetch(`${API_BASE}/finance/summary`),
        fetch(`${API_BASE}/integrations/plaid/status`),
        fetch(`${API_BASE}/calendar/week?start=${weekStart}`),
      ])

      if (responses.some((response) => !response.ok)) {
        throw new Error('one or more API requests failed')
      }

      const [shifts, workSummary, clockStatus, tasks, exams, courses, grades, accounts, financeSummary, plaidStatus, calendarWeek] =
        await Promise.all(responses.map((response) => response.json()))
      setData({ workSummary, clockStatus, shifts, tasks, exams, courses, grades, accounts, financeSummary, plaidStatus, calendarWeek })
      setStatus('online')
    } catch {
      setStatus('backend unavailable // run ./start-piranesi.sh')
      if (attempt < 3) {
        window.setTimeout(() => void loadData(attempt + 1), 1000)
      }
    }
  }

  const loadDataForWeek = useEffectEvent(loadData)

  useEffect(() => {
    void loadDataForWeek()
  }, [weekStart])

  function navigateWeek(direction: -1 | 0 | 1) {
    setWeekStart((current) => direction === 0 ? mondayFor() : shiftDate(current, direction * 7))
  }

  async function toggleTodo(id: number, completed: boolean) {
    const response = await fetch(`${API_BASE}/todos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_completed: completed }),
    })
    setStatus(response.ok ? 'todo updated' : 'todo update failed')
    if (response.ok) await loadData()
  }

  async function saveCalendarNote(noteDate: string, content: string) {
    const response = await fetch(`${API_BASE}/calendar-notes/${noteDate}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    setStatus(response.ok ? `note saved // ${noteDate}` : 'note save failed')
    if (response.ok) await loadData()
  }

  async function onCommand(input: string) {
    const command = parseCommand(input)
    if (command.action === 'theme') {
      const name = (command.args[0] || 'piranesi').toLowerCase()
      setStatus(applyTheme(name) ? `theme ${name} applied` : 'unknown theme // try theme piranesi, matrix, amber, ice, or default')
      return
    }
    if (command.action === 'clear') {
      setStatus('online // cleared')
      return
    }
    if (command.action === 'help') {
      setStatus('clock in|out | add shift|assignment|exam|account | delete <entity> <id> | sync canvas|plaid|all')
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
      const target = command.entity ?? command.args[0] ?? 'all'
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
      let method = 'POST'
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
      } else if (command.entity === 'account' && command.args[0]?.toLowerCase() === 'plaid') {
        await startPlaidLink()
        return
      } else if (command.entity === 'account') {
        path = '/finance/accounts/'
        body = { plaid_item_id: flags.item || `manual-${Date.now()}`, account_name: flags.name || command.args[0], current_balance: Number(flags.balance || command.args[1]), account_type: flags.type || 'checking' }
      } else if (command.entity === 'class') {
        const weekdays: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
        path = '/class-meetings/'
        body = {
          name: flags.name || command.args[0],
          days: (flags.days || '').split(',').map((day) => weekdays[day.trim().slice(0, 3).toLowerCase()]).filter((day) => day !== undefined),
          start: flags.start,
          end: flags.end,
          room: flags.room || null,
        }
      } else if (command.entity === 'todo') {
        path = '/todos/'
        body = {
          description: flags.description || flags.title || command.args.join(' '),
          due_date: flags.due ? parseCommandDate(flags.due) : null,
          recurrence: flags.recurrence || 'none',
        }
      } else if (command.entity === 'note') {
        const noteDate = flags.date || command.args[0]
        path = `/calendar-notes/${noteDate}`
        method = 'PUT'
        body = { content: flags.content || command.args.slice(1).join(' ') }
      }
      if (!path || Object.values(body).some((value) => value === undefined || (typeof value === 'number' && Number.isNaN(value)))) {
        setStatus('usage: add shift --hours=8 [--date=YYYY-MM-DD] | add assignment --course="CS" --title="Lab" --due=ISO')
        return
      }
      const requiredFieldMissing =
        (path === '/shifts/' && (body.date === null || body.hours_worked === undefined || Number.isNaN(body.hours_worked))) ||
        (path === '/tasks/' && (!body.course_name || !body.title || body.due_date === null)) ||
        (path === '/exams/' && (!body.title || body.exam_date === null)) ||
        (path === '/finance/accounts/' && (!body.account_name || body.current_balance === undefined || Number.isNaN(body.current_balance))) ||
        (path === '/class-meetings/' && (!body.name || !(body.days as number[]).length || !body.start || !body.end)) ||
        (path === '/todos/' && !body.description) ||
        (command.entity === 'note' && (!flags.date && !command.args[0]))
      if (requiredFieldMissing) {
        setStatus('usage: add exam [name] [month/day] // or use --date=YYYY-MM-DD')
        return
      }
      try {
        const response = await fetch(`${API_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
      const id = Number(command.args[0])
      const entity = command.entity
      if (!entity || !Number.isInteger(id)) {
        setStatus('usage: delete shift|assignment|exam|account <id>')
        return
      }
      const label = entity === 'assignment' || entity === 'task' ? 'task' : entity
      const path = label === 'shift' ? `/shifts/${id}` : label === 'task' ? `/tasks/${id}` : label === 'exam' ? `/exams/${id}` : label === 'class' ? `/class-meetings/${id}` : label === 'todo' ? `/todos/${id}` : `/finance/accounts/${id}`
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
      const resource = command.entity === 'todo' ? 'todos' : 'tasks'
      const response = await fetch(`${API_BASE}/${resource}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_completed: command.action === 'done' }) })
      setStatus(response.ok ? `${command.entity || 'assignment'} #${id} ${command.action === 'done' ? 'completed' : 'reopened'}` : 'item update failed')
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

  return (
    <TerminalUI
      data={data}
      status={status}
      onCommand={(input) => void onCommand(input)}
      onNavigateWeek={navigateWeek}
      onToggleTodo={(id, completed) => void toggleTodo(id, completed)}
      onSaveCalendarNote={(noteDate, content) => void saveCalendarNote(noteDate, content)}
    />
  )
}

export default App
