import { useRef, useEffect, useState } from 'react';

export function TaskForm({ onAdd }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    const ok = onAdd(title, date);
    if (ok) {
      setTitle('');
      setDate('');
      inputRef.current?.focus();
    }
  }

  return (
    <form data-testid="task-form" onSubmit={handleSubmit} className="task-form">
      <label htmlFor="task-input" className="sr-only">Task title</label>
      <input
        ref={inputRef}
        id="task-input"
        data-testid="task-input"
        type="text"
        placeholder="Task title…"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="input"
        aria-label="Task title"
        aria-required="true"
      />
      <label htmlFor="task-date-input" className="sr-only">Due date</label>
      <input
        id="task-date-input"
        data-testid="task-date-input"
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="input"
        aria-label="Due date (optional)"
      />
      <button data-testid="task-submit" type="submit" className="btn-add">
        Add task
      </button>
    </form>
  );
}
