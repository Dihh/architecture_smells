import { useEffect, useRef, useState } from 'react'
import './TaskForm.css'

export default function TaskForm({ onAdd }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    onAdd({ title: trimmed, date })
    setTitle('')
    setDate('')
    inputRef.current?.focus()
  }

  return (
    <form
      data-testid="task-form"
      className="task-form"
      onSubmit={handleSubmit}
    >
      <div className="task-form__row">
        <input
          ref={inputRef}
          data-testid="task-input"
          className="task-form__input"
          type="text"
          placeholder="Add a new task…"
          value={title}
          onChange={e => setTitle(e.target.value)}
          aria-label="Task title"
        />
        <input
          data-testid="task-date-input"
          className="task-form__date"
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          aria-label="Due date"
        />
        <button
          data-testid="task-submit"
          type="submit"
          className="task-form__btn"
        >
          Add
        </button>
      </div>
    </form>
  )
}
