import { useEffect, useRef, useState } from 'react'

const TASKS_STORAGE_KEY = 'tasks'
const FILTERS = {
  all: 'all',
  pending: 'pending',
  completed: 'completed',
  late: 'late',
}
const ACTION_TYPES = {
  addTask: 'ADD_TASK',
  editTask: 'EDIT_TASK',
  deleteTask: 'DELETE_TASK',
  toggleTask: 'TOGGLE_TASK',
  setFilter: 'SET_FILTER',
  undo: 'UNDO',
  redo: 'REDO',
  reorder: 'REORDER',
}
const SWIPE_DELETE_DISTANCE = 100
const TAP_DISTANCE = 10
const TAP_DURATION = 200

function createTask(title, date) {
  return {
    id: crypto.randomUUID(),
    title,
    completed: false,
    date,
    createdAt: new Date().toISOString(),
  }
}

function isTaskLate(task) {
  if (!task.date || task.completed) {
    return false
  }

  const dueDate = new Date(`${task.date}T23:59:59`)
  return dueDate.getTime() < Date.now()
}

function loadStoredTasks() {
  const storedTasks = localStorage.getItem(TASKS_STORAGE_KEY)

  if (!storedTasks) {
    return []
  }

  try {
    const parsedTasks = JSON.parse(storedTasks)
    return Array.isArray(parsedTasks) ? parsedTasks : []
  } catch {
    return []
  }
}

function matchesFilter(task, activeFilter) {
  const late = isTaskLate(task)

  if (activeFilter === FILTERS.pending) {
    return !task.completed && !late
  }

  if (activeFilter === FILTERS.completed) {
    return task.completed
  }

  if (activeFilter === FILTERS.late) {
    return late
  }

  return true
}

function createLogEntry(type, description, payload) {
  return {
    type,
    description,
    timestamp: new Date().toISOString(),
    payload,
  }
}

function isInteractiveElement(target) {
  const element = target instanceof Element ? target : target.parentElement

  return Boolean(
    element?.closest('button, input, textarea, select, a, form'),
  )
}

function App() {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [tasks, setTasks] = useState(loadStoredTasks)
  const [activeFilter, setActiveFilter] = useState(FILTERS.all)
  const [actionLog, setActionLog] = useState([])
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')
  const titleInputRef = useRef(null)
  const inlineEditInputRef = useRef(null)
  const draggedTaskIdRef = useRef(null)
  const touchGestureRef = useRef(null)

  const filterCounts = tasks.reduce(
    (counts, task) => {
      const late = isTaskLate(task)

      counts.all += 1
      if (task.completed) {
        counts.completed += 1
      } else if (late) {
        counts.late += 1
      } else {
        counts.pending += 1
      }

      return counts
    },
    { all: 0, pending: 0, completed: 0, late: 0 },
  )
  const visibleTasks = tasks.filter((task) => matchesFilter(task, activeFilter))

  useEffect(() => {
    titleInputRef.current?.focus()
  }, [])

  useEffect(() => {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    if (editingTaskId) {
      inlineEditInputRef.current?.focus()
      inlineEditInputRef.current?.select()
    }
  }, [editingTaskId])

  function handleSubmit(event) {
    event.preventDefault()

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      titleInputRef.current?.focus()
      return
    }

    const newTask = createTask(trimmedTitle, date)
    const description = `Added task: ${newTask.title}`
    applyUndoableTaskChange(
      ACTION_TYPES.addTask,
      description,
      newTask,
      [...tasks, newTask],
    )
    setTitle('')
    setDate('')
    requestAnimationFrame(() => titleInputRef.current?.focus())
  }

  function toggleTask(taskId) {
    const taskToToggle = tasks.find((task) => task.id === taskId)
    if (!taskToToggle) {
      return
    }

    const completed = !taskToToggle.completed
    const nextTasks = tasks.map((task) =>
      task.id === taskId ? { ...task, completed } : task,
    )
    const description = `${completed ? 'Completed' : 'Reopened'} task: ${
      taskToToggle.title
    }`
    applyUndoableTaskChange(
      ACTION_TYPES.toggleTask,
      description,
      { id: taskId, completed },
      nextTasks,
    )
  }

  function deleteTask(taskId) {
    const taskToDelete = tasks.find((task) => task.id === taskId)
    if (!taskToDelete) {
      return
    }

    const description = `Deleted task: ${taskToDelete.title}`
    applyUndoableTaskChange(
      ACTION_TYPES.deleteTask,
      description,
      { id: taskToDelete.id, title: taskToDelete.title },
      tasks.filter((task) => task.id !== taskId),
    )
    if (editingTaskId === taskId) {
      cancelEditing()
    }
  }

  function startEditing(task) {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
  }

  function cancelEditing() {
    setEditingTaskId(null)
    setEditingTitle('')
  }

  function saveEditing() {
    const trimmedTitle = editingTitle.trim()

    if (!trimmedTitle) {
      inlineEditInputRef.current?.focus()
      return
    }

    const taskToEdit = tasks.find((task) => task.id === editingTaskId)
    if (!taskToEdit) {
      cancelEditing()
      return
    }

    const nextTasks = tasks.map((task) =>
      task.id === editingTaskId ? { ...task, title: trimmedTitle } : task,
    )
    const description = `Edited task: ${taskToEdit.title} to ${trimmedTitle}`
    applyUndoableTaskChange(
      ACTION_TYPES.editTask,
      description,
      { id: editingTaskId, oldTitle: taskToEdit.title, newTitle: trimmedTitle },
      nextTasks,
    )
    cancelEditing()
  }

  function changeFilter(filter) {
    setActiveFilter(filter)
    logAction(
      ACTION_TYPES.setFilter,
      `Set filter: ${filter}`,
      { filter },
    )
  }

  function logAction(type, description, payload) {
    const entry = createLogEntry(type, description, payload)

    setActionLog((currentLog) => [entry, ...currentLog])
  }

  function applyUndoableTaskChange(type, description, payload, nextTasks) {
    setUndoStack((currentStack) => [...currentStack, { tasks, description }])
    setRedoStack([])
    setTasks(nextTasks)
    logAction(type, description, payload)
  }

  function handleDragStart(event, taskId) {
    draggedTaskIdRef.current = taskId
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
  }

  function handleDragOver(event) {
    if (draggedTaskIdRef.current) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }

  function handleDrop(event, targetTaskId) {
    event.preventDefault()

    const draggedTaskId =
      draggedTaskIdRef.current || event.dataTransfer.getData('text/plain')
    draggedTaskIdRef.current = null

    if (!draggedTaskId || draggedTaskId === targetTaskId) {
      return
    }

    const visibleTaskIds = visibleTasks.map((task) => task.id)
    const fromIndex = visibleTaskIds.indexOf(draggedTaskId)
    const toIndex = visibleTaskIds.indexOf(targetTaskId)

    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      return
    }

    const reorderedVisibleTasks = [...visibleTasks]
    const [movedTask] = reorderedVisibleTasks.splice(fromIndex, 1)
    reorderedVisibleTasks.splice(toIndex, 0, movedTask)

    const visibleSlots = new Set(visibleTaskIds)
    let replacementIndex = 0
    const nextTasks = tasks.map((task) => {
      if (!visibleSlots.has(task.id)) {
        return task
      }

      const replacementTask = reorderedVisibleTasks[replacementIndex]
      replacementIndex += 1
      return replacementTask
    })

    applyUndoableTaskChange(
      ACTION_TYPES.reorder,
      'Reordered tasks',
      { fromIndex, toIndex },
      nextTasks,
    )
  }

  function handleDragEnd() {
    draggedTaskIdRef.current = null
  }

  function handleTaskTouchStart(event, taskId) {
    if (event.touches.length !== 1 || isInteractiveElement(event.target)) {
      touchGestureRef.current = null
      return
    }

    const touch = event.touches[0]
    touchGestureRef.current = {
      taskId,
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: event.timeStamp,
      isScroll: false,
      swiped: false,
    }
  }

  function handleTaskTouchMove(event) {
    const gesture = touchGestureRef.current
    if (!gesture || gesture.swiped || event.touches.length !== 1) {
      return
    }

    const touch = event.touches[0]
    const deltaX = touch.clientX - gesture.startX
    const deltaY = touch.clientY - gesture.startY
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (absY > absX && absY >= TAP_DISTANCE) {
      gesture.isScroll = true
      return
    }

    if (gesture.isScroll) {
      return
    }

    if (absX > SWIPE_DELETE_DISTANCE) {
      event.preventDefault()
      gesture.swiped = true
      deleteTask(gesture.taskId)
    }
  }

  function handleTaskTouchEnd(event, taskId) {
    const gesture = touchGestureRef.current
    touchGestureRef.current = null

    if (
      !gesture ||
      gesture.taskId !== taskId ||
      gesture.isScroll ||
      gesture.swiped ||
      isInteractiveElement(event.target)
    ) {
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - gesture.startX
    const deltaY = touch.clientY - gesture.startY
    const elapsed = event.timeStamp - gesture.startTime

    if (
      Math.abs(deltaX) < TAP_DISTANCE &&
      Math.abs(deltaY) < TAP_DISTANCE &&
      elapsed < TAP_DURATION
    ) {
      toggleTask(taskId)
    }
  }

  useEffect(() => {
    function handleHistoryShortcut(event) {
      if (!event.ctrlKey || event.key.toLowerCase() !== 'z') {
        return
      }

      if (event.shiftKey) {
        const historyEntry = redoStack.at(-1)
        if (!historyEntry) {
          return
        }

        event.preventDefault()
        setRedoStack((currentStack) => currentStack.slice(0, -1))
        setUndoStack((currentStack) => [
          ...currentStack,
          { tasks, description: historyEntry.description },
        ])
        setTasks(historyEntry.tasks)
        setEditingTaskId(null)
        setEditingTitle('')
        setActionLog((currentLog) => [
          createLogEntry(
            ACTION_TYPES.redo,
            `Redo: ${historyEntry.description}`,
            null,
          ),
          ...currentLog,
        ])
        return
      }

      const historyEntry = undoStack.at(-1)
      if (!historyEntry) {
        return
      }

      event.preventDefault()
      setUndoStack((currentStack) => currentStack.slice(0, -1))
      setRedoStack((currentStack) => [
        ...currentStack,
        { tasks, description: historyEntry.description },
      ])
      setTasks(historyEntry.tasks)
      setEditingTaskId(null)
      setEditingTitle('')
      setActionLog((currentLog) => [
        createLogEntry(
          ACTION_TYPES.undo,
          `Undo: ${historyEntry.description}`,
          null,
        ),
        ...currentLog,
      ])
    }

    window.addEventListener('keydown', handleHistoryShortcut)
    return () => window.removeEventListener('keydown', handleHistoryShortcut)
  }, [redoStack, tasks, undoStack])

  function handleInlineEditSubmit(event) {
    event.preventDefault()
    saveEditing()
  }

  function handleInlineEditKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
    }
  }

  return (
    <main className="app-shell">
      <section className="task-panel" aria-labelledby="app-title">
        <div className="task-header">
          <p className="eyebrow">Daily Tasks</p>
          <h1 id="app-title">Todo List</h1>
        </div>

        <form
          className="task-form"
          data-testid="task-form"
          onSubmit={handleSubmit}
        >
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

          <button
            className="submit-button"
            data-testid="task-submit"
            type="submit"
          >
            Add
          </button>
        </form>

        <div className="filter-bar" aria-label="Task filters">
          <button
            className="filter-button"
            data-testid="filter-all"
            type="button"
            aria-pressed={String(activeFilter === FILTERS.all)}
            onClick={() => changeFilter(FILTERS.all)}
          >
            All
            <span className="filter-count" data-testid="filter-count-all">
              {filterCounts.all}
            </span>
          </button>
          <button
            className="filter-button"
            data-testid="filter-pending"
            type="button"
            aria-pressed={String(activeFilter === FILTERS.pending)}
            onClick={() => changeFilter(FILTERS.pending)}
          >
            Pending
            <span className="filter-count" data-testid="filter-count-pending">
              {filterCounts.pending}
            </span>
          </button>
          <button
            className="filter-button"
            data-testid="filter-completed"
            type="button"
            aria-pressed={String(activeFilter === FILTERS.completed)}
            onClick={() => changeFilter(FILTERS.completed)}
          >
            Completed
            <span className="filter-count" data-testid="filter-count-completed">
              {filterCounts.completed}
            </span>
          </button>
          <button
            className="filter-button"
            data-testid="filter-late"
            type="button"
            aria-pressed={String(activeFilter === FILTERS.late)}
            onClick={() => changeFilter(FILTERS.late)}
          >
            Late
            <span className="filter-count" data-testid="filter-count-late">
              {filterCounts.late}
            </span>
          </button>
        </div>

        <div className="task-list" data-testid="task-list" aria-live="polite">
          {visibleTasks.length === 0 ? (
            <p className="empty-state">
              {tasks.length === 0 ? 'No tasks yet.' : 'No tasks match.'}
            </p>
          ) : (
            visibleTasks.map((task) => {
              const late = isTaskLate(task)
              const isEditing = editingTaskId === task.id

              return (
                <article
                  className="task-item"
                  data-testid="task-item"
                  data-task-id={task.id}
                  data-completed={String(task.completed)}
                  data-late={String(late)}
                  key={task.id}
                  onDragOver={handleDragOver}
                  onDrop={(event) => handleDrop(event, task.id)}
                  onTouchStart={(event) => handleTaskTouchStart(event, task.id)}
                  onTouchMove={handleTaskTouchMove}
                  onTouchEnd={(event) => handleTaskTouchEnd(event, task.id)}
                >
                  <button
                    className="drag-handle"
                    data-testid="task-drag-handle"
                    type="button"
                    draggable={true}
                    aria-label={`Drag ${task.title}`}
                    onDragStart={(event) => handleDragStart(event, task.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <span aria-hidden="true">::</span>
                  </button>

                  <button
                    className="status-toggle"
                    data-testid="task-checkbox"
                    type="button"
                    role="checkbox"
                    aria-checked={String(task.completed)}
                    aria-label={
                      task.completed ? 'Mark incomplete' : 'Mark complete'
                    }
                    onClick={() => toggleTask(task.id)}
                  >
                    <span aria-hidden="true">{task.completed ? '✓' : ''}</span>
                  </button>

                  <div className="task-content">
                    {isEditing ? (
                      <form
                        className="inline-edit-form"
                        onSubmit={handleInlineEditSubmit}
                      >
                        <input
                          ref={inlineEditInputRef}
                          data-testid="inline-edit-input"
                          type="text"
                          value={editingTitle}
                          onChange={(event) =>
                            setEditingTitle(event.target.value)
                          }
                          onKeyDown={handleInlineEditKeyDown}
                        />
                        <button
                          className="save-button"
                          data-testid="inline-edit-save"
                          type="submit"
                        >
                          Save
                        </button>
                        <button
                          className="cancel-button"
                          data-testid="inline-edit-cancel"
                          type="button"
                          onClick={cancelEditing}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <h2 data-testid="task-title">{task.title}</h2>
                    )}
                    <div className="task-meta">
                      {task.date ? (
                        <time dateTime={task.date}>Due {task.date}</time>
                      ) : (
                        <span>No due date</span>
                      )}
                      {late && <span className="late-label">Late</span>}
                    </div>
                  </div>

                  <div className="task-actions">
                    {!isEditing && (
                      <button
                        className="edit-button"
                        data-testid="task-edit-btn"
                        type="button"
                        aria-label={`Edit ${task.title}`}
                        onClick={() => startEditing(task)}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      className="delete-button"
                      data-testid="task-delete-btn"
                      type="button"
                      aria-label={`Delete ${task.title}`}
                      onClick={() => deleteTask(task.id)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              )
            })
          )}
        </div>

        <section
          className="action-log"
          data-testid="action-log"
          aria-label="Action log"
        >
          <h2>Action Log</h2>
          {actionLog.length === 0 ? (
            <p className="log-empty">No actions yet.</p>
          ) : (
            <div className="log-list">
              {actionLog.map((entry, index) => (
                <article
                  className="log-entry"
                  data-testid="log-entry"
                  key={`${entry.timestamp}-${index}`}
                >
                  <div className="log-entry-header">
                    <span className="log-type" data-testid="log-type">
                      {entry.type}
                    </span>
                    <time
                      className="log-timestamp"
                      data-testid="log-timestamp"
                      dateTime={entry.timestamp}
                    >
                      {entry.timestamp}
                    </time>
                  </div>
                  <p>{entry.description}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
