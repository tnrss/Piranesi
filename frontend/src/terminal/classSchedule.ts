export type ClassMeeting = {
  id: number
  name: string
  // JS Date.getDay() values: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
  days: number[]
  start: string
  end: string
  room: string | null
}

export function shiftNetPay(shift: { hours_worked: number; hourly_rate: number }, deductionRate: number): number {
  return shift.hours_worked * shift.hourly_rate * (1 - deductionRate)
}

export function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.split(':')
  const hour = Number(hStr)
  const period = hour >= 12 ? 'pm' : 'am'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${mStr}${period}`
}

export function classesForDay(meetings: ClassMeeting[], date: Date): ClassMeeting[] {
  const weekday = date.getDay()
  return meetings.filter((meeting) => meeting.days.includes(weekday)).sort((a, b) => a.start.localeCompare(b.start))
}

// Returns the Mon-Sun dates for the week `weekOffset` weeks from the current one (0 = this week).
export function getWeekDates(weekOffset: number): Date[] {
  const today = new Date()
  const day = today.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(today.getDate() + diffToMonday + weekOffset * 7)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return date
  })
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isSameDay(isoString: string, date: Date): boolean {
  const other = new Date(isoString)
  return other.getFullYear() === date.getFullYear() && other.getMonth() === date.getMonth() && other.getDate() === date.getDate()
}

export function isToday(date: Date): boolean {
  return isSameDay(new Date().toISOString(), date)
}

// Parses "08/24", "08/24/26", "08/24/2026", or "2026-08-24" into a "YYYY-MM-DD" key.
export function parseDateCommand(value: string): string | null {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const monthDay = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(trimmed)
  if (!monthDay) return null
  const [, monthStr, dayStr, yearStr] = monthDay
  const year = yearStr ? (yearStr.length === 2 ? `20${yearStr}` : yearStr) : String(new Date().getFullYear())
  return `${year}-${monthStr.padStart(2, '0')}-${dayStr.padStart(2, '0')}`
}
