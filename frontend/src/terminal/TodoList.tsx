// Manual, always-editable checklist shown on the homepage and schedule view; due dates surface on the calendar.
import { useState } from 'react'
import type { TodoItem, TodoRecurrence } from './TerminalUI'

type TodoListProps = {
  todos: TodoItem[]
  onAdd: (description: string, dueDate: string | null, recurrence: TodoRecurrence) => void
  onUpdateTodo: (id: number, payload: { description?: string; due_date?: string | null; is_completed?: boolean; recurrence?: TodoRecurrence }) => void
  onDeleteTodo: (id: number) => void
}

export function TodoList({ todos, onAdd, onUpdateTodo, onDeleteTodo }: TodoListProps) {
  const [newDescription, setNewDescription] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [newRecurrence, setNewRecurrence] = useState<TodoRecurrence>('none')
  // Tracks in-progress description edits so the input isn't reset before the blur-save lands.
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<number, string>>({})

  function descriptionFor(todo: TodoItem): string {
    return todo.id in descriptionDrafts ? descriptionDrafts[todo.id] : todo.description
  }

  function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    const description = newDescription.trim()
    if (!description) return
    onAdd(description, newDueDate || null, newRecurrence)
    setNewDescription('')
    setNewDueDate('')
    setNewRecurrence('none')
  }

  const sorted = [...todos].sort((a, b) => {
    if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })

  return (
    <div className="todo-list">
      <div className="block-title">TODO</div>
      <form className="todo-add" onSubmit={handleAdd}>
        <input
          className="todo-add-input"
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
          placeholder="add a task..."
        />
        <input
          type="date"
          className="todo-add-date"
          value={newDueDate}
          onChange={(event) => setNewDueDate(event.target.value)}
        />
        <select
          className="todo-recurrence"
          value={newRecurrence}
          onChange={(event) => setNewRecurrence(event.target.value as TodoRecurrence)}
          aria-label="todo recurrence"
        >
          <option value="none">once</option>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>
        <button type="submit">add</button>
      </form>
      {sorted.length === 0 && <p className="muted">nothing on the list</p>}
      <ul className="todo-items">
        {sorted.map((todo) => (
          <li key={todo.id} className={todo.is_completed ? 'todo-done' : ''}>
            <input
              type="checkbox"
              checked={todo.is_completed}
              onChange={(event) => onUpdateTodo(todo.id, { is_completed: event.target.checked })}
            />
            <input
              className="todo-desc"
              value={descriptionFor(todo)}
              onChange={(event) => setDescriptionDrafts((prev) => ({ ...prev, [todo.id]: event.target.value }))}
              onBlur={(event) => onUpdateTodo(todo.id, { description: event.target.value })}
            />
            <input
              type="date"
              className="todo-date"
              value={todo.due_date?.slice(0, 10) ?? ''}
              onChange={(event) => onUpdateTodo(todo.id, { due_date: event.target.value || null })}
            />
            <select
              className="todo-recurrence"
              value={todo.recurrence}
              onChange={(event) => onUpdateTodo(todo.id, { recurrence: event.target.value as TodoRecurrence })}
              aria-label={`recurrence for ${todo.description}`}
            >
              <option value="none">once</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
            </select>
            <button type="button" className="todo-delete" onClick={() => onDeleteTodo(todo.id)} aria-label="delete task">&times;</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
