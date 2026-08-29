// Command entities/actions and a lightweight tokenizer/parser for the terminal-style prompt.
export type TerminalCommand =
  | 'overview'
  | 'work'
  | 'grades'
  | 'schedule'
  | 'day'
  | 'money'
  | 'sync'
  | 'help'
  | 'clear'
  | 'clock in'
  | 'clock out'
export type CommandEntity = 'shift' | 'assignment' | 'task' | 'exam' | 'class' | 'account' | 'course' | 'grades' | 'money' | 'work' | 'schedule' | 'day' | 'canvas' | 'plaid' | 'all' | 'theme'
export type CommandAction = 'add' | 'delete' | 'edit' | 'done' | 'reopen' | 'list' | 'show' | 'reset' | 'sync' | 'clock-in' | 'clock-out' | 'theme' | 'help' | 'clear'

export type ParsedCommand = { entity: CommandEntity | null; action: CommandAction | null; args: string[]; flags: Record<string, string>; raw: string }
export type Suggestion = { value: string; detail: string; insert?: string }

const entities: Record<string, CommandEntity> = { shift: 'shift', shifts: 'shift', work: 'work', assignment: 'assignment', assignments: 'assignment', task: 'task', tasks: 'task', exam: 'exam', exams: 'exam', class: 'class', classes: 'class', account: 'account', accounts: 'account', course: 'course', courses: 'course', grades: 'grades', money: 'money', schedule: 'schedule', canvas: 'canvas', plaid: 'plaid', all: 'all', theme: 'theme' }
const actions: Record<string, CommandAction> = { add: 'add', create: 'add', delete: 'delete', remove: 'delete', edit: 'edit', update: 'edit', done: 'done', complete: 'done', reopen: 'reopen', undone: 'reopen', list: 'list', show: 'show', view: 'show', reset: 'reset', sync: 'sync', help: 'help', clear: 'clear' }

export const registry: Suggestion[] = [
  { value: 'add shift', detail: 'record hours worked' }, { value: 'add assignment', detail: 'create a manual assignment' }, { value: 'add exam', detail: 'create a manual exam' }, { value: 'add class', detail: 'add a recurring class meeting' }, { value: 'add account', detail: 'add a financial account' }, { value: 'add account plaid', detail: 'link a bank/credit account via Plaid' },
  { value: 'delete shift', detail: 'remove a shift (confirmation required)' }, { value: 'delete assignment', detail: 'remove an assignment (confirmation required)' }, { value: 'delete exam', detail: 'remove an exam (confirmation required)' }, { value: 'delete class', detail: 'remove a class meeting (confirmation required)' }, { value: 'delete account', detail: 'remove an account (confirmation required)' }, { value: 'delete account plaid', detail: 'revoke a Plaid item and remove its accounts' },
  { value: 'assignment done', detail: 'mark an assignment complete' }, { value: 'assignment reopen', detail: 'reopen an assignment' }, { value: 'show courses', detail: 'list active Canvas courses' }, { value: 'show grades', detail: 'list current grades' }, { value: 'show schedule', detail: 'open the Mon-Sun block calendar' }, { value: 'show accounts', detail: 'list accounts and balances' },
  { value: 'sync canvas', detail: 'sync Canvas courses, grades, and assignments' }, { value: 'sync plaid', detail: 'sync connected Plaid balances' }, { value: 'sync all', detail: 'sync Canvas and Plaid' }, { value: 'work reset', detail: 'clear this week’s shifts (confirmation required)' }, { value: 'help', detail: 'show command help' }, { value: 'clear', detail: 'return to overview' },
  { value: 'clock in', detail: 'start tracking a shift now' }, { value: 'clock out', detail: 'end tracking and save the shift' },
  { value: 'theme default', detail: 'charcoal and reddish pink' }, { value: 'theme matrix', detail: 'black and terminal green' }, { value: 'theme amber', detail: 'black and warm amber' }, { value: 'theme ice', detail: 'navy and electric cyan' }, { value: 'theme piranesi', detail: 'deep blue and gold' },
]

const dateCommandPattern = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})$/

function tokenize(input: string): string[] {
  return input.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((item) => item.replaceAll('"', '')) ?? []
}

export function parseCommand(input: string): ParsedCommand {
  const tokens = tokenize(input.trim())
  const normalizedTokens = tokens.map((token) => token.toLowerCase())
  if (!tokens.length) return { entity: null, action: null, args: [], flags: {}, raw: input }
  if (tokens.length === 1 && dateCommandPattern.test(tokens[0])) return { entity: 'day', action: 'show', args: tokens, flags: {}, raw: input }
  if (normalizedTokens[0] === 'clock' && (normalizedTokens[1] === 'in' || normalizedTokens[1] === 'out')) return { entity: 'work', action: normalizedTokens[1] === 'in' ? 'clock-in' : 'clock-out', args: tokens.slice(2), flags: {}, raw: input }
  if (normalizedTokens[0] === 'theme') return { entity: 'theme', action: 'theme', args: tokens.slice(1), flags: {}, raw: input }
  const firstAction = actions[normalizedTokens[0]]
  const secondAction = actions[normalizedTokens[1] ?? '']
  const entity = entities[firstAction ? normalizedTokens[1] : normalizedTokens[0]] ?? null
  const action = firstAction ?? secondAction ?? (entity ? 'show' : null)
  const remainder = firstAction || secondAction ? tokens.slice(2) : tokens.slice(1)
  const args: string[] = []
  const flags: Record<string, string> = {}
  for (const token of remainder) {
    if (token.startsWith('--')) {
      const [key, ...value] = token.slice(2).split('=')
      flags[key] = value.join('=') || 'true'
    } else args.push(token)
  }
  return { entity, action, args, flags, raw: input }
}

export function getSuggestions(input: string, dynamic: { tasks: { id: number; title: string }[]; exams: { id: number; title: string }[]; classMeetings: { id: number; name: string }[]; accounts: { id: number; account_name: string }[]; plaidItems: { id: number; institution: string | null; item_id: string }[] }): Suggestion[] {
  const normalized = input.toLowerCase()
  const trimmed = normalized.trimEnd()
  const fieldGuides: Suggestion[] = [
    { value: 'add shift [hours] [month/day]', detail: 'example: add shift 8 08/23', insert: 'add shift ' },
    { value: 'add assignment [course] [title] [month/day]', detail: 'example: add assignment CS Lab 08/25', insert: 'add assignment ' },
    { value: 'add exam [name] [month/day]', detail: 'example: add exam Midterm 09/15', insert: 'add exam ' },
    { value: 'add class --name="Course" --days=mon,wed,fri --start=09:00 --end=09:50', detail: 'optional: --room="Room 101"', insert: 'add class ' },
    { value: 'add account [name] [balance]', detail: 'example: add account Checking 500', insert: 'add account ' },
    { value: 'add account plaid', detail: 'opens Plaid Link to connect a real account', insert: 'add account plaid' },
  ]
  const matchingGuide = fieldGuides.find((guide) => trimmed === guide.value.split(' [')[0])
  if (matchingGuide) return [matchingGuide]

  const base = registry.filter((item) => item.value.startsWith(normalized))
  const tokens = normalized.trim().split(/\s+/)
  const dynamicItems: Suggestion[] = []
  if (tokens[0] === 'delete' && (tokens[1] === 'task' || tokens[1] === 'assignment')) dynamicItems.push(...dynamic.tasks.map((task) => ({ value: `delete assignment ${task.id}`, detail: task.title })))
  if (tokens[0] === 'delete' && tokens[1] === 'exam') dynamicItems.push(...dynamic.exams.map((exam) => ({ value: `delete exam ${exam.id}`, detail: exam.title })))
  if (tokens[0] === 'delete' && tokens[1] === 'class') dynamicItems.push(...dynamic.classMeetings.map((meeting) => ({ value: `delete class ${meeting.id}`, detail: meeting.name })))
  if (tokens[0] === 'delete' && tokens[1] === 'account' && tokens[2] === 'plaid') dynamicItems.push(...dynamic.plaidItems.map((item) => ({ value: `delete account plaid ${item.id}`, detail: item.institution || item.item_id })))
  if (tokens[0] === 'delete' && tokens[1] === 'account') dynamicItems.push(...dynamic.accounts.map((account) => ({ value: `delete account ${account.id}`, detail: account.account_name })))
  const guides = fieldGuides.filter((guide) => guide.value.startsWith(normalized))
  return [...guides, ...base, ...dynamicItems.filter((item) => item.value.startsWith(normalized))].slice(0, 8)
}

export function parseViewCommand(input: string): TerminalCommand {
  const trimmed = input.trim()
  if (dateCommandPattern.test(trimmed)) return 'day'
  const command = trimmed.toLowerCase().split(/\s+/)[0]
  if (command === 'work') return 'work'
  if (command === 'grades') return 'grades'
  if (command === 'schedule') return 'schedule'
  if (command === 'money') return 'money'
  if (command === 'sync') return 'sync'
  if (command === 'help') return 'help'
  if (command === 'clear') return 'clear'
  return 'overview'
}

export const terminalCommands: TerminalCommand[] = [
  'clock in',
  'clock out',
  'work',
  'grades',
  'schedule',
  'money',
  'sync',
  'help',
  'clear',
]
