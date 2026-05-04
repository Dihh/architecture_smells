import { useEffect, useRef, useState } from 'react';

function App() {
  const titleRef = useRef(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [tasks, setTasks] = useState([]);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [inlineEditTitle, setInlineEditTitle] = useState('');
  const [filter, setFilter] = useState('all');
  const [actionLog, setActionLog] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const touchStateRef = useRef({
    active: false,
    taskId: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    swipeDetected: false,
    verticalScroll: false,
    timerId: null
  });

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      const savedTasks = JSON.parse(localStorage.getItem('tasks') ?? 'null');
      if (Array.isArray(savedTasks)) {
        setTasks(savedTasks);
      }
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }, [tasks]);

  const getLateStatus = (task) => {
    if (!task.date || task.completed) {
      return false;
    }
    const due = new Date(`${task.date}T23:59:59`);
    return due < new Date();
  };

  const cloneTasks = (tasksToClone) => tasksToClone.map((task) => ({ ...task }));

  const logAction = (type, description, payload) => {
    setActionLog((prev) => [
      {
        type,
        description,
        timestamp: new Date().toISOString(),
        payload
      },
      ...prev
    ]);
  };

  const updateHistoryForAction = (description) => {
    setUndoStack((prevUndo) => [...prevUndo, { tasks: cloneTasks(tasks), description }]);
    setRedoStack([]);
  };

  const reorderTasks = (fromVisibleIndex, toVisibleIndex) => {
    if (fromVisibleIndex === toVisibleIndex) {
      return;
    }

    const visibleTaskIds = filteredTasks.map((task) => task.id);
    const visibleTaskIndices = tasks
      .map((task, index) => ({ task, index }))
      .filter(({ task }) => visibleTaskIds.includes(task.id))
      .map(({ index }) => index);

    const fromActualIndex = visibleTaskIndices[fromVisibleIndex];
    let toActualIndex = visibleTaskIndices[toVisibleIndex];
    if (fromActualIndex < toActualIndex) {
      toActualIndex -= 1;
    }

    const updated = cloneTasks(tasks);
    const [moved] = updated.splice(fromActualIndex, 1);
    updated.splice(toActualIndex, 0, moved);
    updateHistoryForAction('Reordered tasks');
    setTasks(updated);
    logAction('REORDER', 'Reordered tasks', {
      fromIndex: fromVisibleIndex,
      toIndex: toVisibleIndex
    });
  };

  const handleDragStart = (event, taskId) => {
    setDraggedTaskId(taskId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);
  };

  const handleDrop = (event, targetTaskId) => {
    event.preventDefault();
    const sourceTaskId = draggedTaskId ?? event.dataTransfer.getData('text/plain');
    if (!sourceTaskId || sourceTaskId === targetTaskId) {
      setDraggedTaskId(null);
      return;
    }

    const visibleTaskIds = filteredTasks.map((task) => task.id);
    const fromVisibleIndex = visibleTaskIds.indexOf(sourceTaskId);
    const toVisibleIndex = visibleTaskIds.indexOf(targetTaskId);
    if (fromVisibleIndex === -1 || toVisibleIndex === -1) {
      setDraggedTaskId(null);
      return;
    }

    reorderTasks(fromVisibleIndex, toVisibleIndex);
    setDraggedTaskId(null);
  };

  const shouldIgnoreTouchTarget = (target) => {
    return Boolean(
      target.closest('button, input, textarea, [data-testid="task-drag-handle"], [data-testid="task-checkbox"], [data-testid="task-edit-btn"], [data-testid="task-delete-btn"]')
    );
  };

  const handleTouchStart = (event, taskId) => {
    if (event.touches.length !== 1) {
      touchStateRef.current.active = false;
      return;
    }
    if (shouldIgnoreTouchTarget(event.target)) {
      touchStateRef.current.active = false;
      return;
    }

    const touch = event.touches[0];
    touchStateRef.current = {
      active: true,
      taskId,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      swipeDetected: false,
      verticalScroll: false
    };
  };

  const handleTouchMove = (event, taskId) => {
    const state = touchStateRef.current;
    if (!state.active || state.taskId !== taskId) {
      return;
    }

    const touch = event.touches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;

    if (state.swipeDetected || state.verticalScroll) {
      return;
    }

    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      state.verticalScroll = true;
      return;
    }

    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      event.preventDefault();
    }

    if (Math.abs(dx) > 100 && Math.abs(dx) > Math.abs(dy)) {
      state.swipeDetected = true;
      state.active = false;
      state.timerId = window.setTimeout(() => {
        deleteTask(taskId);
      }, 300);
    }
  };

  const handleTouchEnd = (event, taskId) => {
    const state = touchStateRef.current;
    if (!state.active || state.taskId !== taskId) {
      touchStateRef.current.active = false;
      return;
    }

    const touch = event.changedTouches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    const duration = Date.now() - state.startTime;

    if (state.timerId && !state.swipeDetected) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    touchStateRef.current.active = false;

    if (state.swipeDetected || state.verticalScroll) {
      return;
    }

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && duration < 200) {
      toggleTaskCompletion(taskId);
    }
  };

  const undo = () => {
    if (undoStack.length === 0) {
      return;
    }
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prevUndo) => prevUndo.slice(0, -1));
    setRedoStack((prevRedo) => [...prevRedo, { tasks: cloneTasks(tasks), description: previous.description }]);
    setTasks(previous.tasks);
    logAction('UNDO', `Undo: ${previous.description}`, null);
  };

  const redo = () => {
    if (redoStack.length === 0) {
      return;
    }
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prevRedo) => prevRedo.slice(0, -1));
    setUndoStack((prevUndo) => [...prevUndo, { tasks: cloneTasks(tasks), description: next.description }]);
    setTasks(next.tasks);
    logAction('REDO', `Redo: ${next.description}`, null);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, tasks]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }

    const newTask = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      completed: false,
      date,
      createdAt: new Date().toISOString()
    };

    updateHistoryForAction(`Added task: ${trimmedTitle}`);
    setTasks((prevTasks) => [newTask, ...prevTasks]);
    logAction('ADD_TASK', `Added task: ${trimmedTitle}`, newTask);
    setTitle('');
    setDate('');
    titleRef.current?.focus();
  };

  const toggleTaskCompletion = (taskId) => {
    const taskToToggle = tasks.find((task) => task.id === taskId);
    if (!taskToToggle) {
      return;
    }
    updateHistoryForAction(`Toggled task: ${taskToToggle.title}`);
    setTasks((prevTasks) =>
      prevTasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        const updated = { ...task, completed: !task.completed };
        logAction('TOGGLE_TASK', `Toggled task: ${task.title}`, {
          id: task.id,
          completed: updated.completed
        });
        return updated;
      })
    );
  };

  const deleteTask = (taskId) => {
    const taskToDelete = tasks.find((task) => task.id === taskId);
    if (taskToDelete) {
      updateHistoryForAction(`Deleted task: ${taskToDelete.title}`);
    }
    setTasks((prevTasks) => {
      const taskToDeleteFromPrev = prevTasks.find((task) => task.id === taskId);
      if (taskToDeleteFromPrev) {
        logAction('DELETE_TASK', `Deleted task: ${taskToDeleteFromPrev.title}`, {
          id: taskToDeleteFromPrev.id,
          title: taskToDeleteFromPrev.title
        });
      }
      return prevTasks.filter((task) => task.id !== taskId);
    });
    if (editingTaskId === taskId) {
      cancelEdit();
    }
  };

  const openEditor = (task) => {
    setEditingTaskId(task.id);
    setInlineEditTitle(task.title);
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
    setInlineEditTitle('');
  };

  const saveEdit = () => {
    const trimmedTitle = inlineEditTitle.trim();
    if (!trimmedTitle || editingTaskId === null) {
      return;
    }

    const taskToUpdate = tasks.find((task) => task.id === editingTaskId);
    if (!taskToUpdate || taskToUpdate.title === trimmedTitle) {
      cancelEdit();
      return;
    }

    updateHistoryForAction(`Edited task: ${taskToUpdate.title} → ${trimmedTitle}`);
    setTasks((prevTasks) =>
      prevTasks.map((task) => {
        if (task.id !== editingTaskId) {
          return task;
        }
        logAction('EDIT_TASK', `Edited task: ${task.title} → ${trimmedTitle}`, {
          id: task.id,
          oldTitle: task.title,
          newTitle: trimmedTitle
        });
        return { ...task, title: trimmedTitle };
      })
    );
    cancelEdit();
  };

  const handleInlineKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveEdit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  const totalCount = tasks.length;
  const completedCount = tasks.filter((task) => task.completed).length;
  const lateCount = tasks.filter((task) => getLateStatus(task)).length;
  const pendingCount = tasks.filter((task) => !task.completed && !getLateStatus(task)).length;

  const filteredTasks = tasks.filter((task) => {
    const isLate = getLateStatus(task);
    if (filter === 'pending') {
      return !task.completed && !isLate;
    }
    if (filter === 'completed') {
      return task.completed;
    }
    if (filter === 'late') {
      return isLate;
    }
    return true;
  });

  const setActiveFilter = (newFilter) => {
    if (newFilter === filter) {
      return;
    }
    setFilter(newFilter);
    logAction('SET_FILTER', `Set filter: ${newFilter}`, { filter: newFilter });
  };

  return (
    <div className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Task manager</p>
          <h1>Todo list</h1>
          <p className="subtitle">Create tasks with due dates, then track them below.</p>
        </div>
      </header>

      <main>
        <form className="task-form" data-testid="task-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label htmlFor="task-title" className="sr-only">
              Task title
            </label>
            <input
              id="task-title"
              name="task-title"
              type="text"
              placeholder="New task title"
              aria-label="Task title"
              data-testid="task-input"
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="form-row">
            <label htmlFor="task-date" className="sr-only">
              Due date
            </label>
            <input
              id="task-date"
              name="task-date"
              type="date"
              data-testid="task-date-input"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>

          <button type="submit" className="submit-button" data-testid="task-submit">
            Add task
          </button>
        </form>

        <section className="task-list-container">
          <h2 className="visually-hidden">Tasks</h2>
          <div className="filter-group" role="group" aria-label="Task filters">
            <button
              type="button"
              className={`filter-button ${filter === 'all' ? 'filter-button--active' : ''}`}
              data-testid="filter-all"
              aria-pressed={filter === 'all'}
              onClick={() => setActiveFilter('all')}
            >
              All <span data-testid="filter-count-all" className="filter-badge">{totalCount}</span>
            </button>
            <button
              type="button"
              className={`filter-button ${filter === 'pending' ? 'filter-button--active' : ''}`}
              data-testid="filter-pending"
              aria-pressed={filter === 'pending'}
              onClick={() => setActiveFilter('pending')}
            >
              Pending <span data-testid="filter-count-pending" className="filter-badge">{pendingCount}</span>
            </button>
            <button
              type="button"
              className={`filter-button ${filter === 'completed' ? 'filter-button--active' : ''}`}
              data-testid="filter-completed"
              aria-pressed={filter === 'completed'}
              onClick={() => setActiveFilter('completed')}
            >
              Completed <span data-testid="filter-count-completed" className="filter-badge">{completedCount}</span>
            </button>
            <button
              type="button"
              className={`filter-button ${filter === 'late' ? 'filter-button--active' : ''}`}
              data-testid="filter-late"
              aria-pressed={filter === 'late'}
              onClick={() => setActiveFilter('late')}
            >
              Late <span data-testid="filter-count-late" className="filter-badge">{lateCount}</span>
            </button>
          </div>

          <section className="action-log-panel" data-testid="action-log">
            <h2 className="action-log-heading">Action log</h2>
            {actionLog.length === 0 ? (
              <div className="empty-state">
                <p>No actions yet.</p>
              </div>
            ) : (
              <div className="action-log-entries">
                {actionLog.map((entry, index) => (
                  <div key={`${entry.timestamp}-${index}`} data-testid="log-entry" className="log-entry">
                    <div className="log-entry-top">
                      <span data-testid="log-type" className="log-type">
                        {entry.type}
                      </span>
                      <span data-testid="log-timestamp" className="log-timestamp">
                        {entry.timestamp}
                      </span>
                    </div>
                    <p className="log-description">{entry.description}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div data-testid="task-list" className="task-list">
            {filteredTasks.length === 0 ? (
              <div className="empty-state">
                {tasks.length === 0 ? (
                  <p>No tasks yet. Add a task to get started.</p>
                ) : (
                  <p>No tasks match this filter.</p>
                )}
              </div>
            ) : (
              filteredTasks.map((task) => {
                const isLate = getLateStatus(task);
                return (
                  <article
                    key={task.id}
                    className={`task-card ${isLate ? 'task-card--late' : ''}`}
                    data-testid="task-item"
                    data-task-id={task.id}
                    data-completed={task.completed.toString()}
                    data-late={isLate.toString()}
                    draggable={false}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(event, task.id)}
                    onTouchStart={(event) => handleTouchStart(event, task.id)}
                    onTouchMove={(event) => handleTouchMove(event, task.id)}
                    onTouchEnd={(event) => handleTouchEnd(event, task.id)}
                  >
                    <div className="task-card-main">
                      <button
                        type="button"
                        className="task-drag-handle"
                        data-testid="task-drag-handle"
                        draggable={true}
                        onDragStart={(event) => handleDragStart(event, task.id)}
                        onDragEnd={() => setDraggedTaskId(null)}
                        aria-label="Drag task"
                      >
                        ≡
                      </button>
                      <button
                        type="button"
                        data-testid="task-checkbox"
                        role="checkbox"
                        aria-checked={task.completed}
                        aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
                        className={`task-checkbox ${task.completed ? 'task-checkbox--checked' : ''}`}
                        onClick={() => toggleTaskCompletion(task.id)}
                      >
                        {task.completed ? '✓' : ''}
                      </button>

                      <div className="task-card-content">
                        {editingTaskId === task.id ? (
                          <form
                            className="inline-edit-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              saveEdit();
                            }}
                          >
                            <input
                              type="text"
                              className="inline-edit-input"
                              data-testid="inline-edit-input"
                              value={inlineEditTitle}
                              onChange={(event) => setInlineEditTitle(event.target.value)}
                              onKeyDown={handleInlineKeyDown}
                              autoFocus
                            />

                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="inline-edit-button inline-edit-button--save"
                                data-testid="inline-edit-save"
                                onClick={saveEdit}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="inline-edit-button inline-edit-button--cancel"
                                data-testid="inline-edit-cancel"
                                onClick={cancelEdit}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <p data-testid="task-title" className={`task-title ${task.completed ? 'task-title--completed' : ''}`}>
                              {task.title}
                            </p>
                            {task.date && (
                              <p className="task-meta">
                                Due <time dateTime={task.date}>{task.date}</time>
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="task-card-actions">
                      {editingTaskId !== task.id && (
                        <button
                          type="button"
                          className="task-edit-button"
                          data-testid="task-edit-btn"
                          onClick={() => openEditor(task)}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="task-delete-button"
                        data-testid="task-delete-btn"
                        onClick={() => deleteTask(task.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
