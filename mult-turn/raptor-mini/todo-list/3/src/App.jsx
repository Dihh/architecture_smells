import { useEffect, useMemo, useRef, useState } from 'react';

function App() {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [tasks, setTasks] = useState([]);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [actionLog, setActionLog] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [dragSourceId, setDragSourceId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const touchStateRef = useRef({});
  const inputRef = useRef(null);

  const cloneTasks = (sourceTasks) => sourceTasks.map((task) => ({ ...task }));

  const pushUndoSnapshot = (description) => {
    setUndoStack((current) => [...current, { tasks: cloneTasks(tasks), description }]);
  };

  const clearRedoStack = () => {
    setRedoStack([]);
  };

  const pushLogEntry = (entry) => {
    setActionLog((current) => [entry, ...current]);
  };

  const logAction = (type, description, payload = null) => {
    pushLogEntry({ type, description, payload, timestamp: new Date().toISOString() });
  };

  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
    logAction('SET_FILTER', `Changed filter: ${filter}`, { filter });
  };

  const handleDragStart = (event, taskId) => {
    setDragSourceId(taskId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);
  };

  const handleDragEnd = () => {
    setDragSourceId(null);
    setDragOverId(null);
  };

  const handleDragOverTask = (event, taskId) => {
    event.preventDefault();
    if (taskId !== dragSourceId) {
      setDragOverId(taskId);
    }
  };

  const reorderVisibleTasks = (sourceId, targetId) => {
    const visibleIds = filteredTasks.map((task) => task.id);
    const fromIndex = visibleIds.indexOf(sourceId);
    const toIndex = visibleIds.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      return;
    }

    pushUndoSnapshot('Reordered tasks');
    clearRedoStack();

    const nextVisibleIds = [...visibleIds];
    nextVisibleIds.splice(fromIndex, 1);
    nextVisibleIds.splice(toIndex, 0, sourceId);

    const taskById = Object.fromEntries(tasks.map((task) => [task.id, task]));
    setTasks((current) => {
      const visibleSet = new Set(visibleIds);
      let nextIndex = 0;
      return current.map((task) => {
        if (!visibleSet.has(task.id)) {
          return task;
        }
        const reorderedTask = taskById[nextVisibleIds[nextIndex]];
        nextIndex += 1;
        return reorderedTask;
      });
    });

    logAction('REORDER', 'Reordered tasks', { fromIndex, toIndex });
  };

  const handleDropTask = (event, taskId) => {
    event.preventDefault();
    const sourceId = dragSourceId || event.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === taskId) {
      setDragOverId(null);
      return;
    }

    reorderVisibleTasks(sourceId, taskId);
    setDragOverId(null);
  };

  const isInteractiveTouchTarget = (target) =>
    Boolean(
      target.closest(
        '[data-testid="task-checkbox"], [data-testid="task-edit-btn"], [data-testid="task-delete-btn"], [data-testid="task-drag-handle"], button, input, textarea, select'
      )
    );

  const cleanupTouchState = (clearTimer = true) => {
    const state = touchStateRef.current;
    if (clearTimer && state && state.swipeTimeoutId) {
      window.clearTimeout(state.swipeTimeoutId);
    }
    touchStateRef.current = {};
  };

  const handleTouchStart = (event, taskId) => {
    if (isInteractiveTouchTarget(event.target)) {
      touchStateRef.current = { ignore: true };
      return;
    }

    const touch = event.touches[0];
    touchStateRef.current = {
      taskId,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      ignore: false,
      swipeTriggered: false,
      swipeTimeoutId: null,
      canceled: false,
    };
  };

  const handleTouchMove = (event, taskId) => {
    const state = touchStateRef.current;
    if (!state || state.ignore || state.taskId !== taskId || state.canceled) {
      return;
    }

    const touch = event.touches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!state.swipeTriggered) {
      if (absY > absX && absY > 10) {
        state.canceled = true;
        return;
      }

      if (absX > 100 && absX > absY) {
        state.swipeTriggered = true;
        state.swipeTimeoutId = window.setTimeout(() => {
          handleDeleteTask(taskId);
          cleanupTouchState();
        }, 300);
      }
    }
  };

  const handleTouchEnd = (event, taskId) => {
    const state = touchStateRef.current;
    if (!state || state.ignore || state.taskId !== taskId) {
      cleanupTouchState();
      return;
    }

    const touch = event.changedTouches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const duration = Date.now() - state.startTime;

    if (state.swipeTriggered) {
      cleanupTouchState(false);
      return;
    }

    if (!state.canceled && absX < 10 && absY < 10 && duration < 200) {
      handleToggleCompleted(taskId);
    }

    cleanupTouchState();
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem('tasks');
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setTasks(parsed);
      }
    } catch (error) {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('tasks', JSON.stringify(tasks));
  }, [tasks]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }

    const task = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      completed: false,
      date: date || '',
      createdAt: new Date().toISOString(),
    };

    pushUndoSnapshot(`Added task: ${task.title}`);
    clearRedoStack();
    setTasks((current) => [task, ...current]);
    logAction('ADD_TASK', `Added task: ${task.title}`, task);
    setTitle('');
    setDate('');
    inputRef.current?.focus();
  };

  const handleToggleCompleted = (taskId) => {
    const taskToToggle = tasks.find((task) => task.id === taskId);
    if (!taskToToggle) {
      return;
    }
    const updatedCompleted = !taskToToggle.completed;
    pushUndoSnapshot(`Toggled task: ${taskToToggle.title} -> ${updatedCompleted ? 'completed' : 'pending'}`);
    clearRedoStack();
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, completed: updatedCompleted } : task
      )
    );
    logAction(
      'TOGGLE_TASK',
      `Toggled task: ${taskToToggle.title} -> ${updatedCompleted ? 'completed' : 'pending'}`,
      { id: taskToToggle.id, completed: updatedCompleted }
    );
  };

  const handleDeleteTask = (taskId) => {
    const taskToDelete = tasks.find((task) => task.id === taskId);
    if (!taskToDelete) {
      return;
    }
    pushUndoSnapshot(`Deleted task: ${taskToDelete.title}`);
    clearRedoStack();
    logAction(
      'DELETE_TASK',
      `Deleted task: ${taskToDelete.title}`,
      { id: taskToDelete.id, title: taskToDelete.title }
    );
    setTasks((current) => current.filter((task) => task.id !== taskId));
    if (editingTaskId === taskId) {
      setEditingTaskId(null);
      setEditingTitle('');
    }
  };

  const openInlineEdit = (task) => {
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
  };

  const closeInlineEdit = () => {
    setEditingTaskId(null);
    setEditingTitle('');
  };

  const handleSaveInlineEdit = (taskId) => {
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle) {
      return;
    }

    const taskToUpdate = tasks.find((task) => task.id === taskId);
    if (!taskToUpdate || taskToUpdate.title === trimmedTitle) {
      closeInlineEdit();
      return;
    }

    pushUndoSnapshot(`Edited task: ${taskToUpdate.title} -> ${trimmedTitle}`);
    clearRedoStack();
    logAction(
      'EDIT_TASK',
      `Edited task: ${taskToUpdate.title} -> ${trimmedTitle}`,
      { id: taskId, oldTitle: taskToUpdate.title, newTitle: trimmedTitle }
    );
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, title: trimmedTitle } : task
      )
    );
    closeInlineEdit();
  };

  const handleInlineEditKeyDown = (event, taskId) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSaveInlineEdit(taskId);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeInlineEdit();
    }
  };

  const undo = () => {
    if (undoStack.length === 0) {
      return;
    }
    const lastEntry = undoStack[undoStack.length - 1];
    const currentSnapshot = cloneTasks(tasks);
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, { tasks: currentSnapshot, description: lastEntry.description }]);
    setTasks(lastEntry.tasks);
    logAction('UNDO', `Undo: ${lastEntry.description}`, null);
  };

  const redo = () => {
    if (redoStack.length === 0) {
      return;
    }
    const lastEntry = redoStack[redoStack.length - 1];
    const currentSnapshot = cloneTasks(tasks);
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, { tasks: currentSnapshot, description: lastEntry.description }]);
    setTasks(lastEntry.tasks);
    logAction('REDO', `Redo: ${lastEntry.description}`, null);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.ctrlKey || event.key.toLowerCase() !== 'z') {
        return;
      }

      if (event.shiftKey) {
        event.preventDefault();
        redo();
      } else {
        event.preventDefault();
        undo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, tasks]);

  const tasksWithLate = useMemo(
    () =>
      tasks.map((task) => {
        const isLate = Boolean(
          task.date &&
            !task.completed &&
            new Date(task.date + 'T23:59:59').getTime() < Date.now()
        );
        return { ...task, late: isLate };
      }),
    [tasks]
  );

  const taskCounts = useMemo(() => {
    const allCount = tasksWithLate.length;
    const completedCount = tasksWithLate.filter((task) => task.completed).length;
    const lateCount = tasksWithLate.filter((task) => task.late).length;
    const pendingCount = tasksWithLate.filter(
      (task) => !task.completed && !task.late
    ).length;

    return {
      all: allCount,
      pending: pendingCount,
      completed: completedCount,
      late: lateCount,
    };
  }, [tasksWithLate]);

  const filteredTasks = useMemo(() => {
    switch (activeFilter) {
      case 'pending':
        return tasksWithLate.filter((task) => !task.completed && !task.late);
      case 'completed':
        return tasksWithLate.filter((task) => task.completed);
      case 'late':
        return tasksWithLate.filter((task) => task.late);
      default:
        return tasksWithLate;
    }
  }, [activeFilter, tasksWithLate]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Todo List</h1>
        <p>Create tasks with due dates and track late items at a glance.</p>
      </header>

      <main>
        <form data-testid="task-form" className="task-form" onSubmit={handleSubmit}>
          <div className="field-row">
            <label className="sr-only" htmlFor="task-title-input">
              Task title
            </label>
            <input
              id="task-title-input"
              data-testid="task-input"
              className="text-input"
              ref={inputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add a new task"
              aria-label="Task title"
            />

            <label className="sr-only" htmlFor="task-date-input">
              Due date
            </label>
            <input
              id="task-date-input"
              data-testid="task-date-input"
              className="date-input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Due date"
            />
          </div>

          <button data-testid="task-submit" className="submit-button" type="submit">
            Add task
          </button>
        </form>

        <div className="filter-group" role="tablist" aria-label="Task filters">
          <button
            data-testid="filter-all"
            type="button"
            className={`filter-button ${activeFilter === 'all' ? 'active' : ''}`}
            aria-pressed={activeFilter === 'all' ? 'true' : 'false'}
            onClick={() => handleFilterChange('all')}
          >
            All
            <span data-testid="filter-count-all" className="filter-count">
              {taskCounts.all}
            </span>
          </button>
          <button
            data-testid="filter-pending"
            type="button"
            className={`filter-button ${activeFilter === 'pending' ? 'active' : ''}`}
            aria-pressed={activeFilter === 'pending' ? 'true' : 'false'}
            onClick={() => handleFilterChange('pending')}
          >
            Pending
            <span data-testid="filter-count-pending" className="filter-count">
              {taskCounts.pending}
            </span>
          </button>
          <button
            data-testid="filter-completed"
            type="button"
            className={`filter-button ${activeFilter === 'completed' ? 'active' : ''}`}
            aria-pressed={activeFilter === 'completed' ? 'true' : 'false'}
            onClick={() => handleFilterChange('completed')}
          >
            Completed
            <span data-testid="filter-count-completed" className="filter-count">
              {taskCounts.completed}
            </span>
          </button>
          <button
            data-testid="filter-late"
            type="button"
            className={`filter-button ${activeFilter === 'late' ? 'active' : ''}`}
            aria-pressed={activeFilter === 'late' ? 'true' : 'false'}
            onClick={() => handleFilterChange('late')}
          >
            Late
            <span data-testid="filter-count-late" className="filter-count">
              {taskCounts.late}
            </span>
          </button>
        </div>

        <section data-testid="action-log" className="action-log">
          {actionLog.length > 0 ? (
            actionLog.map((entry, index) => (
              <div data-testid="log-entry" key={`${entry.timestamp}-${index}`} className="log-entry">
                <div data-testid="log-type" className="log-type">
                  {entry.type}
                </div>
                <div className="log-description">{entry.description}</div>
                <div data-testid="log-timestamp" className="log-timestamp">
                  {new Date(entry.timestamp).toLocaleString()}
                </div>
              </div>
            ))
          ) : (
            <div className="log-empty">No actions yet.</div>
          )}
        </section>

        <section data-testid="task-list" className="task-list">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <article
                key={task.id}
                data-testid="task-item"
                data-task-id={task.id}
                data-completed={task.completed ? 'true' : 'false'}
                data-late={task.late ? 'true' : 'false'}
                className={`task-card ${task.late ? 'late' : ''} ${dragOverId === task.id ? 'drag-over' : ''}`}
                onDragOver={(event) => handleDragOverTask(event, task.id)}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(event) => handleDropTask(event, task.id)}
                onTouchStart={(event) => handleTouchStart(event, task.id)}
                onTouchMove={(event) => handleTouchMove(event, task.id)}
                onTouchEnd={(event) => handleTouchEnd(event, task.id)}
              >
                <div className="task-card-main">
                  <button
                    type="button"
                    data-testid="task-drag-handle"
                    className="drag-handle"
                    draggable
                    onDragStart={(event) => handleDragStart(event, task.id)}
                    onDragEnd={handleDragEnd}
                    aria-label="Drag to reorder"
                  >
                    ☰
                  </button>
                  {editingTaskId === task.id ? (
                    <form
                      className="inline-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleSaveInlineEdit(task.id);
                      }}
                    >
                      <label className="sr-only" htmlFor={`inline-edit-title-${task.id}`}>
                        Edit task title
                      </label>
                      <input
                        id={`inline-edit-title-${task.id}`}
                        data-testid="inline-edit-input"
                        className="inline-edit-input"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onKeyDown={(event) => handleInlineEditKeyDown(event, task.id)}
                        autoFocus
                      />
                      <div className="inline-edit-actions">
                        <button
                          type="submit"
                          data-testid="inline-edit-save"
                          className="icon-button save-button"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          data-testid="inline-edit-cancel"
                          className="icon-button cancel-button"
                          onClick={closeInlineEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <h2 data-testid="task-title" className="task-title">
                        {task.title}
                      </h2>
                      <div className="task-meta">
                        <span>{task.date ? `Due ${task.date}` : 'No due date'}</span>
                        <span>Created {new Date(task.createdAt).toLocaleString()}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="task-card-actions">
                  <button
                    type="button"
                    data-testid="task-checkbox"
                    className="icon-button checkbox-button"
                    aria-checked={task.completed ? 'true' : 'false'}
                    aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
                    onClick={() => handleToggleCompleted(task.id)}
                  >
                    {task.completed ? '✓ Completed' : 'Mark complete'}
                  </button>
                  {editingTaskId !== task.id && (
                    <button
                      type="button"
                      data-testid="task-edit-btn"
                      className="icon-button edit-button"
                      onClick={() => openInlineEdit(task)}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="task-delete-btn"
                    className="icon-button delete-button"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    Delete
                  </button>
                </div>
                <div className="task-badge-row">
                  <span className={`badge ${task.late ? 'badge-late' : 'badge-normal'}`}>
                    {task.late ? 'Late' : 'On time'}
                  </span>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">No tasks yet. Add one above to get started.</div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
