import { useEffect, useRef, useState } from 'react';

const TASKS_STORAGE_KEY = 'tasks';
const FILTERS = {
  all: 'all',
  pending: 'pending',
  completed: 'completed',
  late: 'late',
};
const ACTION_TYPES = {
  addTask: 'ADD_TASK',
  editTask: 'EDIT_TASK',
  deleteTask: 'DELETE_TASK',
  toggleTask: 'TOGGLE_TASK',
  setFilter: 'SET_FILTER',
  undo: 'UNDO',
  redo: 'REDO',
  reorder: 'REORDER',
};
const SWIPE_DELETE_THRESHOLD = 100;
const TAP_MOVE_THRESHOLD = 10;
const TAP_TIME_THRESHOLD = 200;

function createTask(title, date) {
  return {
    id: crypto.randomUUID(),
    title,
    completed: false,
    date,
    createdAt: new Date().toISOString(),
  };
}

function isTaskLate(task) {
  if (!task.date || task.completed) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dueDate = new Date(`${task.date}T00:00:00`);
  return dueDate < today;
}

function loadTasks() {
  const storedTasks = localStorage.getItem(TASKS_STORAGE_KEY);
  if (!storedTasks) {
    return [];
  }

  try {
    const parsedTasks = JSON.parse(storedTasks);
    return Array.isArray(parsedTasks) ? parsedTasks : [];
  } catch {
    return [];
  }
}

function getFilterCounts(tasks) {
  return tasks.reduce(
    (counts, task) => {
      const late = isTaskLate(task);

      counts.all += 1;
      if (task.completed) {
        counts.completed += 1;
      } else if (late) {
        counts.late += 1;
      } else {
        counts.pending += 1;
      }

      return counts;
    },
    {
      all: 0,
      pending: 0,
      completed: 0,
      late: 0,
    },
  );
}

function filterTasks(tasks, activeFilter) {
  return tasks.filter((task) => {
    const late = isTaskLate(task);

    if (activeFilter === FILTERS.pending) {
      return !task.completed && !late;
    }

    if (activeFilter === FILTERS.completed) {
      return task.completed;
    }

    if (activeFilter === FILTERS.late) {
      return late;
    }

    return true;
  });
}

function cloneTasks(tasks) {
  return tasks.map((task) => ({ ...task }));
}

function moveItem(items, fromIndex, toIndex) {
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function reorderVisibleTasks(tasks, activeFilter, fromIndex, toIndex) {
  const visibleIds = filterTasks(tasks, activeFilter).map((task) => task.id);
  const visibleIdSet = new Set(visibleIds);
  const reorderedVisibleIds = moveItem(visibleIds, fromIndex, toIndex);
  let nextVisibleIndex = 0;
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  return tasks.map((task) => {
    if (!visibleIdSet.has(task.id)) {
      return task;
    }

    const nextTaskId = reorderedVisibleIds[nextVisibleIndex];
    nextVisibleIndex += 1;
    return taskById.get(nextTaskId);
  });
}

function isInteractiveTouchTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      'button, input, textarea, select, a, label, [data-ignore-touch-gesture="true"]',
    ),
  );
}

function App() {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [tasks, setTasks] = useState(loadTasks);
  const [activeFilter, setActiveFilter] = useState(FILTERS.all);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [actionLog, setActionLog] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const titleInputRef = useRef(null);
  const editInputRef = useRef(null);
  const draggedTaskIdRef = useRef(null);
  const touchGestureRef = useRef(null);
  const touchDeleteTimerRef = useRef(null);
  const filterCounts = getFilterCounts(tasks);
  const visibleTasks = filterTasks(tasks, activeFilter);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (editingTaskId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingTaskId]);

  useEffect(() => {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    return () => {
      if (touchDeleteTimerRef.current) {
        clearTimeout(touchDeleteTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function handleHistoryShortcut(event) {
      if (!event.ctrlKey || event.key.toLowerCase() !== 'z') {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        redoTasks();
      } else {
        undoTasks();
      }
    }

    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  });

  function addLogEntry(type, description, payload) {
    const logEntry = {
      type,
      description,
      timestamp: new Date().toISOString(),
      payload,
    };

    setActionLog((currentLog) => [logEntry, ...currentLog]);
  }

  function pushUndoSnapshot(description) {
    setUndoStack((currentStack) => [
      ...currentStack,
      {
        tasks: cloneTasks(tasks),
        description,
      },
    ]);
    setRedoStack([]);
  }

  function undoTasks() {
    if (undoStack.length === 0) {
      return;
    }

    const undoEntry = undoStack[undoStack.length - 1];
    setUndoStack((currentStack) => currentStack.slice(0, -1));
    setRedoStack((currentStack) => [
      ...currentStack,
      {
        tasks: cloneTasks(tasks),
        description: undoEntry.description,
      },
    ]);
    setTasks(cloneTasks(undoEntry.tasks));
    cancelEditing();
    addLogEntry(ACTION_TYPES.undo, `Undo: ${undoEntry.description}`, null);
  }

  function redoTasks() {
    if (redoStack.length === 0) {
      return;
    }

    const redoEntry = redoStack[redoStack.length - 1];
    setRedoStack((currentStack) => currentStack.slice(0, -1));
    setUndoStack((currentStack) => [
      ...currentStack,
      {
        tasks: cloneTasks(tasks),
        description: redoEntry.description,
      },
    ]);
    setTasks(cloneTasks(redoEntry.tasks));
    cancelEditing();
    addLogEntry(ACTION_TYPES.redo, `Redo: ${redoEntry.description}`, null);
  }

  function handleSubmit(event) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      titleInputRef.current?.focus();
      return;
    }

    const newTask = createTask(trimmedTitle, date);
    const description = `Added task: ${newTask.title}`;
    pushUndoSnapshot(description);
    setTasks((currentTasks) => [...currentTasks, newTask]);
    addLogEntry(ACTION_TYPES.addTask, description, newTask);
    setTitle('');
    setDate('');
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }

  function toggleTask(taskId) {
    const taskToToggle = tasks.find((task) => task.id === taskId);
    if (!taskToToggle) {
      return;
    }

    const completed = !taskToToggle.completed;
    const description = `Toggled task: ${taskToToggle.title}`;
    pushUndoSnapshot(description);
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task,
      ),
    );
    addLogEntry(ACTION_TYPES.toggleTask, description, {
      id: taskId,
      completed,
    });
  }

  function deleteTask(taskId) {
    const taskToDelete = tasks.find((task) => task.id === taskId);
    if (!taskToDelete) {
      return;
    }

    const description = `Deleted task: ${taskToDelete.title}`;
    pushUndoSnapshot(description);
    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId));
    addLogEntry(ACTION_TYPES.deleteTask, description, {
      id: taskId,
      title: taskToDelete.title,
    });
    if (editingTaskId === taskId) {
      setEditingTaskId(null);
      setEditTitle('');
    }
  }

  function scheduleSwipeDelete(taskId) {
    if (touchDeleteTimerRef.current) {
      clearTimeout(touchDeleteTimerRef.current);
    }

    touchDeleteTimerRef.current = setTimeout(() => {
      deleteTask(taskId);
      touchDeleteTimerRef.current = null;
    }, 0);
  }

  function startEditing(task) {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
  }

  function cancelEditing() {
    setEditingTaskId(null);
    setEditTitle('');
  }

  function saveEditing(taskId) {
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      editInputRef.current?.focus();
      return;
    }

    const taskToEdit = tasks.find((task) => task.id === taskId);
    if (!taskToEdit) {
      cancelEditing();
      return;
    }

    const description = `Edited task: ${taskToEdit.title}`;
    pushUndoSnapshot(description);
    setTasks((currentTasks) =>
      currentTasks.map((task) => (task.id === taskId ? { ...task, title: trimmedTitle } : task)),
    );
    addLogEntry(ACTION_TYPES.editTask, description, {
      id: taskId,
      oldTitle: taskToEdit.title,
      newTitle: trimmedTitle,
    });
    cancelEditing();
  }

  function handleEditSubmit(event, taskId) {
    event.preventDefault();
    saveEditing(taskId);
  }

  function handleEditKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  }

  function changeFilter(filter) {
    if (filter === activeFilter) {
      return;
    }

    setActiveFilter(filter);
    addLogEntry(ACTION_TYPES.setFilter, `Set filter: ${filter}`, { filter });
  }

  function handleDragStart(event, taskId) {
    draggedTaskIdRef.current = taskId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskId);
    }
  }

  function handleDragOver(event) {
    if (draggedTaskIdRef.current) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    }
  }

  function handleDrop(event, targetTaskId) {
    event.preventDefault();

    const draggedTaskId = draggedTaskIdRef.current || event.dataTransfer?.getData('text/plain');
    draggedTaskIdRef.current = null;

    if (!draggedTaskId || draggedTaskId === targetTaskId) {
      return;
    }

    const fromIndex = visibleTasks.findIndex((task) => task.id === draggedTaskId);
    const toIndex = visibleTasks.findIndex((task) => task.id === targetTaskId);

    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      return;
    }

    const description = 'Reordered tasks';
    pushUndoSnapshot(description);
    setTasks((currentTasks) => reorderVisibleTasks(currentTasks, activeFilter, fromIndex, toIndex));
    addLogEntry(ACTION_TYPES.reorder, description, { fromIndex, toIndex });
    cancelEditing();
  }

  function handleDragEnd() {
    draggedTaskIdRef.current = null;
  }

  function handleTaskTouchStart(event, taskId) {
    if (event.touches.length !== 1 || isInteractiveTouchTarget(event.target)) {
      touchGestureRef.current = null;
      return;
    }

    const touch = event.touches[0];
    touchGestureRef.current = {
      taskId,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      isScroll: false,
      swipeTriggered: false,
    };
  }

  function handleTaskTouchMove(event) {
    const gesture = touchGestureRef.current;
    if (!gesture || gesture.swipeTriggered || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absY > absX) {
      gesture.isScroll = true;
      return;
    }

    if (gesture.isScroll) {
      return;
    }

    if (absX > SWIPE_DELETE_THRESHOLD) {
      gesture.swipeTriggered = true;
      scheduleSwipeDelete(gesture.taskId);
    }
  }

  function handleTaskTouchEnd(event, taskId) {
    const gesture = touchGestureRef.current;
    touchGestureRef.current = null;

    if (!gesture || gesture.taskId !== taskId || gesture.isScroll || gesture.swipeTriggered) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const elapsed = Date.now() - gesture.startTime;
    const isShortTap =
      Math.abs(deltaX) < TAP_MOVE_THRESHOLD &&
      Math.abs(deltaY) < TAP_MOVE_THRESHOLD &&
      elapsed < TAP_TIME_THRESHOLD;

    if (isShortTap) {
      toggleTask(taskId);
    }
  }

  return (
    <main className="app-shell">
      <section className="task-panel" aria-labelledby="task-heading">
        <div className="task-header">
          <p className="eyebrow">Today</p>
          <h1 id="task-heading">Task List</h1>
        </div>

        <form className="task-form" data-testid="task-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Task</span>
            <input
              ref={titleInputRef}
              data-testid="task-input"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Add a task"
            />
          </label>

          <label className="field">
            <span>Due date</span>
            <input
              data-testid="task-date-input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>

          <button data-testid="task-submit" type="submit">
            Add
          </button>
        </form>

        <div className="task-filters" aria-label="Task filters" role="group">
          <button
            data-testid="filter-all"
            type="button"
            aria-pressed={String(activeFilter === FILTERS.all)}
            onClick={() => changeFilter(FILTERS.all)}
          >
            All
            <span data-testid="filter-count-all">{filterCounts.all}</span>
          </button>
          <button
            data-testid="filter-pending"
            type="button"
            aria-pressed={String(activeFilter === FILTERS.pending)}
            onClick={() => changeFilter(FILTERS.pending)}
          >
            Pending
            <span data-testid="filter-count-pending">{filterCounts.pending}</span>
          </button>
          <button
            data-testid="filter-completed"
            type="button"
            aria-pressed={String(activeFilter === FILTERS.completed)}
            onClick={() => changeFilter(FILTERS.completed)}
          >
            Completed
            <span data-testid="filter-count-completed">{filterCounts.completed}</span>
          </button>
          <button
            data-testid="filter-late"
            type="button"
            aria-pressed={String(activeFilter === FILTERS.late)}
            onClick={() => changeFilter(FILTERS.late)}
          >
            Late
            <span data-testid="filter-count-late">{filterCounts.late}</span>
          </button>
        </div>

        <div className="task-list" data-testid="task-list" aria-live="polite" role="list">
          {visibleTasks.length === 0 ? (
            <p className="empty-state">No tasks yet.</p>
          ) : (
            visibleTasks.map((task) => {
              const late = isTaskLate(task);
              const isEditing = editingTaskId === task.id;

              return (
                <article
                  className={`task-item${task.completed ? ' is-completed' : ''}${
                    late ? ' is-late' : ''
                  }`}
                  data-testid="task-item"
                  data-task-id={task.id}
                  data-completed={String(task.completed)}
                  data-late={String(late)}
                  key={task.id}
                  role="listitem"
                  onDragOver={handleDragOver}
                  onDrop={(event) => handleDrop(event, task.id)}
                  onTouchStart={(event) => handleTaskTouchStart(event, task.id)}
                  onTouchMove={handleTaskTouchMove}
                  onTouchEnd={(event) => handleTaskTouchEnd(event, task.id)}
                >
                  <button
                    className="task-drag-handle"
                    data-testid="task-drag-handle"
                    type="button"
                    draggable={true}
                    aria-label={`Reorder ${task.title}`}
                    onDragStart={(event) => handleDragStart(event, task.id)}
                    onDragEnd={handleDragEnd}
                  >
                    ::
                  </button>

                  <div className="task-main">
                    <div className="task-toggle">
                      <input
                        data-testid="task-checkbox"
                        type="checkbox"
                        checked={task.completed}
                        aria-checked={String(task.completed)}
                        aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
                        onChange={() => toggleTask(task.id)}
                      />
                      {isEditing ? (
                        <form
                          className="inline-edit-form"
                          onSubmit={(event) => handleEditSubmit(event, task.id)}
                        >
                          <input
                            ref={editInputRef}
                            data-testid="inline-edit-input"
                            type="text"
                            value={editTitle}
                            onChange={(event) => setEditTitle(event.target.value)}
                            onKeyDown={handleEditKeyDown}
                          />
                          <button data-testid="inline-edit-save" type="submit">
                            Save
                          </button>
                          <button
                            data-testid="inline-edit-cancel"
                            type="button"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <span data-testid="task-title">{task.title}</span>
                      )}
                    </div>

                    <div className="task-meta">
                      {task.date ? (
                        <time dateTime={task.date}>{task.date}</time>
                      ) : (
                        <span>No date</span>
                      )}
                      {late ? <strong>Late</strong> : null}
                    </div>
                  </div>

                  <div className="task-actions">
                    {!isEditing ? (
                      <button
                        className="task-edit"
                        data-testid="task-edit-btn"
                        type="button"
                        onClick={() => startEditing(task)}
                      >
                        Edit
                      </button>
                    ) : null}

                    <button
                      className="task-delete"
                      data-testid="task-delete-btn"
                      type="button"
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

        <section className="action-log" data-testid="action-log" aria-labelledby="action-log-title">
          <h2 id="action-log-title">Action Log</h2>
          {actionLog.length === 0 ? (
            <p className="log-empty">No actions yet.</p>
          ) : (
            <div className="log-entries">
              {actionLog.map((entry) => (
                <article
                  className="log-entry"
                  data-testid="log-entry"
                  key={`${entry.timestamp}-${entry.type}`}
                >
                  <div>
                    <strong data-testid="log-type">{entry.type}</strong>
                    <p>{entry.description}</p>
                  </div>
                  <time data-testid="log-timestamp" dateTime={entry.timestamp}>
                    {entry.timestamp}
                  </time>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
