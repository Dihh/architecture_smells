import React, { useState, useRef, useEffect } from 'react';

const TaskForm = ({ onAddTask }) => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    onAddTask({
      id: crypto.randomUUID(),
      title: title.trim(),
      completed: false,
      date: date,
      createdAt: new Date().toISOString(),
    });

    setTitle('');
    setDate('');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  return (
    <form className="card fade-in" data-testid="task-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="task-input">Task Title</label>
        <input
          id="task-input"
          type="text"
          placeholder="What needs to be done?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="task-input"
          ref={inputRef}
          autoComplete="off"
        />
      </div>
      <div className="form-group">
        <label htmlFor="task-date-input">Due Date (Optional)</label>
        <input
          id="task-date-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          data-testid="task-date-input"
        />
      </div>
      <button type="submit" data-testid="task-submit" className="btn-primary">
        Add Task
      </button>
    </form>
  );
};

export default TaskForm;
