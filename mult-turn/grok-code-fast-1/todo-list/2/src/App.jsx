import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

/* eslint-disable react-hooks/purity */

function App() {
  const [tasks, setTasks] = useState(() => {
    const saved = localStorage.getItem('tasks')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        console.error('Invalid tasks in localStorage', e)
        return []
      }
    }
    return []
  })
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [log, setLog] = useState([])
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [touchData, setTouchData] = useState(null)
  const titleInputRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('tasks', JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    titleInputRef.current.focus()
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setUndoStack(prev => [...prev, tasks])
    setRedoStack([])
    const newTask = {
      id: crypto.randomUUID(),
      title: title.trim(),
      completed: false,
      date: date,
      createdAt: new Date().toISOString()
    }
    setTasks([...tasks, newTask])
    addLogEntry('ADD_TASK', `Added task: ${newTask.title}`, newTask)
    setTitle('')
    setDate('')
    titleInputRef.current.focus()
  }

  const toggleCompleted = (id) => {
    setUndoStack(prev => [...prev, tasks])
    setRedoStack([])
    const task = tasks.find(t => t.id === id)
    const newCompleted = !task.completed
    setTasks(tasks.map(t => 
      t.id === id ? { ...t, completed: newCompleted } : t
    ))
    addLogEntry('TOGGLE_TASK', `Marked task as ${newCompleted ? 'completed' : 'incomplete'}: ${task.title}`, { id, completed: newCompleted })
  }

  const deleteTask = (id) => {
    setUndoStack(prev => [...prev, tasks])
    setRedoStack([])
    const task = tasks.find(t => t.id === id)
    setTasks(tasks.filter(t => t.id !== id))
    addLogEntry('DELETE_TASK', `Deleted task: ${task.title}`, { id, title: task.title })
  }

  const startEdit = (task) => {
    setEditingId(task.id)
    setEditTitle(task.title)
  }

  const saveEdit = () => {
    if (editTitle.trim()) {
      setUndoStack(prev => [...prev, tasks])
      setRedoStack([])
      const task = tasks.find(t => t.id === editingId)
      setTasks(tasks.map(t => 
        t.id === editingId ? { ...t, title: editTitle.trim() } : t
      ))
      addLogEntry('EDIT_TASK', `Edited task: '${task.title}' → '${editTitle.trim()}'`, { id: editingId, oldTitle: task.title, newTitle: editTitle.trim() })
      setEditingId(null)
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const isLate = (task) => {
    return task.date && new Date(task.date) < new Date() && !task.completed
  }

  const addLogEntry = useCallback((type, description, payload = null) => {
    const entry = {
      type,
      description,
      timestamp: new Date().toISOString(),
      payload
    }
    setLog(prev => [entry, ...prev])
  }, [])

  const undo = () => {
    if (undoStack.length === 0) return
    const previousTasks = undoStack[undoStack.length - 1]
    setRedoStack(prev => [...prev, tasks])
    setTasks(previousTasks)
    setUndoStack(prev => prev.slice(0, -1))
    localStorage.setItem('tasks', JSON.stringify(previousTasks))
    const undoneAction = log[0]
    addLogEntry('UNDO', `Undo: ${undoneAction.description}`)
  }

  const redo = () => {
    if (redoStack.length === 0) return
    const nextTasks = redoStack[redoStack.length - 1]
    setUndoStack(prev => [...prev, tasks])
    setTasks(nextTasks)
    setRedoStack(prev => prev.slice(0, -1))
    localStorage.setItem('tasks', JSON.stringify(nextTasks))
    const redoneAction = log[1] // the action that was undone
    addLogEntry('REDO', `Redo: ${redoneAction.description}`)
  }

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  const counts = {
    all: tasks.length,
    pending: tasks.filter(task => !task.completed && !isLate(task)).length,
    completed: tasks.filter(task => task.completed).length,
    late: tasks.filter(task => isLate(task)).length
  }

  const filteredTasks = tasks.filter(task => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'pending') return !task.completed && !isLate(task)
    if (activeFilter === 'completed') return task.completed
    if (activeFilter === 'late') return isLate(task)
    return true
  })

  const visibleIds = filteredTasks.map(task => task.id)

  const handleDragStart = (e, task) => {
    if (!e.target.closest('.drag-handle')) {
      e.preventDefault()
      return
    }
    const index = visibleIds.indexOf(task.id)
    e.dataTransfer.setData('text/plain', index.toString())
  }

  const handleDragOver = (e) => {
    e.preventDefault()
  }

  const handleDrop = (e, task) => {
    e.preventDefault()
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'))
    const toIndex = visibleIds.indexOf(task.id)
    if (fromIndex === toIndex) return
    const newVisibleIds = [...visibleIds]
    newVisibleIds.splice(fromIndex, 1)
    newVisibleIds.splice(toIndex, 0, visibleIds[fromIndex])
    const newTasks = newVisibleIds.map(id => tasks.find(t => t.id === id))
    setUndoStack(prev => [...prev, tasks])
    setRedoStack([])
    setTasks(newTasks)
    addLogEntry('REORDER', 'Reordered tasks', { fromIndex, toIndex })
  }

  const handleTouchStart = (e, task) => {
    if (e.target.closest('.drag-handle, input, button')) return
    setTouchData({
      taskId: task.id,
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: Date.now()
    })
  }

  const handleTouchMove = (e) => {
    if (!touchData) return
    const deltaX = Math.abs(e.touches[0].clientX - touchData.startX)
    const deltaY = Math.abs(e.touches[0].clientY - touchData.startY)
    if (deltaY <= deltaX) {
      e.preventDefault()
    }
  }

  const handleTouchEnd = (e, task) => {
    if (!touchData || touchData.taskId !== task.id) return
    const endX = e.changedTouches[0].clientX
    const endY = e.changedTouches[0].clientY
    const deltaX = endX - touchData.startX
    const deltaY = endY - touchData.startY
    const duration = Date.now() - touchData.startTime
    const displacement = Math.sqrt(deltaX ** 2 + deltaY ** 2)
    setTouchData(null)
    if (Math.abs(deltaY) > Math.abs(deltaX) || Math.abs(deltaX) < 100) {
      // check tap
      if (displacement < 10 && duration < 200) {
        toggleCompleted(task.id)
      }
    } else {
      // swipe
      setTimeout(() => deleteTask(task.id), 300)
    }
  }

  return (
    <div className="app">
      <h1>Todo List</h1>
      <form data-testid="task-form" onSubmit={handleSubmit} className="task-form">
        <input
          data-testid="task-input"
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter task title"
          required
        />
        <input
          data-testid="task-date-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button data-testid="task-submit" type="submit">Add Task</button>
      </form>
      <div className="filters">
        <button
          data-testid="filter-all"
          aria-pressed={activeFilter === 'all'}
          onClick={() => { setActiveFilter('all'); addLogEntry('SET_FILTER', 'Set filter to all', { filter: 'all' }) }}
        >
          All <span data-testid="filter-count-all">{counts.all}</span>
        </button>
        <button
          data-testid="filter-pending"
          aria-pressed={activeFilter === 'pending'}
          onClick={() => { setActiveFilter('pending'); addLogEntry('SET_FILTER', 'Set filter to pending', { filter: 'pending' }) }}
        >
          Pending <span data-testid="filter-count-pending">{counts.pending}</span>
        </button>
        <button
          data-testid="filter-completed"
          aria-pressed={activeFilter === 'completed'}
          onClick={() => { setActiveFilter('completed'); addLogEntry('SET_FILTER', 'Set filter to completed', { filter: 'completed' }) }}
        >
          Completed <span data-testid="filter-count-completed">{counts.completed}</span>
        </button>
        <button
          data-testid="filter-late"
          aria-pressed={activeFilter === 'late'}
          onClick={() => { setActiveFilter('late'); addLogEntry('SET_FILTER', 'Set filter to late', { filter: 'late' }) }}
        >
          Late <span data-testid="filter-count-late">{counts.late}</span>
        </button>
      </div>
      <div data-testid="task-list" className="task-list">
        {filteredTasks.map(task => (
          <div
            key={task.id}
            data-testid="task-item"
            data-task-id={task.id}
            data-completed={task.completed.toString()}
            data-late={isLate(task).toString()}
            className={`task-item ${task.completed ? 'completed' : ''} ${isLate(task) ? 'late' : ''}`}
            draggable="true"
            onDragStart={(e) => handleDragStart(e, task)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, task)}
            onTouchStart={(e) => handleTouchStart(e, task)}
            onTouchMove={handleTouchMove}
            onTouchEnd={(e) => handleTouchEnd(e, task)}
          >
            <div data-testid="task-drag-handle" className="drag-handle">⋮⋮</div>
            <input
              data-testid="task-checkbox"
              type="checkbox"
              checked={task.completed}
              onChange={() => toggleCompleted(task.id)}
              aria-checked={task.completed.toString()}
              aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
            />
            <div className="task-content">
              {editingId === task.id ? (
                <div className="inline-edit">
                  <input
                    data-testid="inline-edit-input"
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit()
                      if (e.key === 'Escape') cancelEdit()
                    }}
                  />
                  <button data-testid="inline-edit-save" onClick={saveEdit}>Save</button>
                  <button data-testid="inline-edit-cancel" onClick={cancelEdit}>Cancel</button>
                </div>
              ) : (
                <span data-testid="task-title">{task.title}</span>
              )}
              {task.date && <span className="date">{task.date}</span>}
            </div>
            <div className="task-actions">
              {editingId !== task.id && (
                <button data-testid="task-edit-btn" onClick={() => startEdit(task)}>Edit</button>
              )}
              <button data-testid="task-delete-btn" onClick={() => deleteTask(task.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      <div data-testid="action-log" className="action-log">
        <h3>Action Log</h3>
        {log.map((entry, index) => (
          <div key={index} data-testid="log-entry" className="log-entry">
            <span data-testid="log-type" className="log-type">{entry.type}</span>
            <span data-testid="log-timestamp" className="log-timestamp">{new Date(entry.timestamp).toLocaleString()}</span>
            <div className="log-description">{entry.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
