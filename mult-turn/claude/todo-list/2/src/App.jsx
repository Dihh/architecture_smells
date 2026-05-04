import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TaskForm from './components/TaskForm'
import TaskFilters from './components/TaskFilters'
import TaskList from './components/TaskList'
import ActionLog from './components/ActionLog'
import './App.css'

const STORAGE_KEY = 'tasks'

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isLate(task) {
  if (!task.date || task.completed) return false
  return task.date < new Date().toISOString().slice(0, 10)
}

export default function App() {
  const [tasks, setTasks] = useState(loadTasks)
  const [editingId, setEditingId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [log, setLog] = useState([])

  // Refs give keyboard handler synchronous access to latest values without stale closures.
  const tasksRef = useRef(tasks)
  const logIdRef = useRef(0)
  const undoStack = useRef([]) // { tasks: Task[], description: string }[]
  const redoStack = useRef([])

  useEffect(() => { tasksRef.current = tasks }, [tasks])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  }, [tasks])

  const record = useCallback((type, description, payload = null) => {
    const id = ++logIdRef.current
    setLog(prev => [{ id, type, description, payload, timestamp: new Date().toISOString() }, ...prev])
  }, [])

  // Applies a new tasks array as an undoable action.
  const applyUndoable = useCallback((newTasks, type, description, payload) => {
    undoStack.current = [...undoStack.current, { tasks: tasksRef.current, description }]
    redoStack.current = []
    setTasks(newTasks)
    record(type, description, payload)
  }, [record])

  useEffect(() => {
    function handleKeyDown(e) {
      if (!e.ctrlKey && !e.metaKey) return

      if (e.key === 'z' && !e.shiftKey) {
        if (undoStack.current.length === 0) return
        e.preventDefault()
        const { tasks: prevTasks, description } = undoStack.current.at(-1)
        undoStack.current = undoStack.current.slice(0, -1)
        redoStack.current = [...redoStack.current, { tasks: tasksRef.current, description }]
        setTasks(prevTasks)
        record('UNDO', `Undo: ${description}`, null)
      } else if (e.key === 'z' && e.shiftKey) {
        if (redoStack.current.length === 0) return
        e.preventDefault()
        const { tasks: nextTasks, description } = redoStack.current.at(-1)
        redoStack.current = redoStack.current.slice(0, -1)
        undoStack.current = [...undoStack.current, { tasks: tasksRef.current, description }]
        setTasks(nextTasks)
        record('REDO', `Redo: ${description}`, null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [record])

  const counts = useMemo(() => ({
    all:       tasks.length,
    pending:   tasks.filter(t => !t.completed && !isLate(t)).length,
    completed: tasks.filter(t => t.completed).length,
    late:      tasks.filter(isLate).length,
  }), [tasks])

  const visibleTasks = useMemo(() => {
    if (filter === 'all')       return tasks
    if (filter === 'pending')   return tasks.filter(t => !t.completed && !isLate(t))
    if (filter === 'completed') return tasks.filter(t => t.completed)
    if (filter === 'late')      return tasks.filter(isLate)
    return tasks
  }, [tasks, filter])

  function addTask({ title, date }) {
    const newTask = {
      id: crypto.randomUUID(),
      title,
      completed: false,
      date,
      createdAt: new Date().toISOString(),
    }
    applyUndoable([...tasksRef.current, newTask], 'ADD_TASK', `Added task: ${title}`, newTask)
  }

  function toggleTask(id) {
    const task = tasksRef.current.find(t => t.id === id)
    if (!task) return
    const newCompleted = !task.completed
    const newTasks = tasksRef.current.map(t => t.id === id ? { ...t, completed: newCompleted } : t)
    applyUndoable(newTasks, 'TOGGLE_TASK', `Toggled task: ${task.title} → ${newCompleted ? 'complete' : 'incomplete'}`, { id, completed: newCompleted })
  }

  function deleteTask(id) {
    const task = tasksRef.current.find(t => t.id === id)
    if (!task) return
    applyUndoable(tasksRef.current.filter(t => t.id !== id), 'DELETE_TASK', `Deleted task: ${task.title}`, { id, title: task.title })
    if (editingId === id) setEditingId(null)
  }

  function saveEdit(id, newTitle) {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    const task = tasksRef.current.find(t => t.id === id)
    if (!task) return
    const newTasks = tasksRef.current.map(t => t.id === id ? { ...t, title: trimmed } : t)
    applyUndoable(newTasks, 'EDIT_TASK', `Edited task: "${task.title}" → "${trimmed}"`, { id, oldTitle: task.title, newTitle: trimmed })
    setEditingId(null)
  }

  function reorderTasks(fromIndex, toIndex) {
    // visibleTasks is a subset of tasksRef.current. Find where each visible task
    // sits in the full array so hidden tasks stay untouched.
    const allTasks = tasksRef.current
    const visibleIds = new Set(visibleTasks.map(t => t.id))
    const slots = allTasks.reduce((acc, t, i) => {
      if (visibleIds.has(t.id)) acc.push(i)
      return acc
    }, [])

    const newVisible = [...visibleTasks]
    const [moved] = newVisible.splice(fromIndex, 1)
    newVisible.splice(toIndex, 0, moved)

    const newTasks = [...allTasks]
    slots.forEach((pos, i) => { newTasks[pos] = newVisible[i] })

    applyUndoable(newTasks, 'REORDER', 'Reordered tasks', { fromIndex, toIndex })
  }

  function handleSetFilter(newFilter) {
    setFilter(newFilter)
    record('SET_FILTER', `Filter changed to: ${newFilter}`, { filter: newFilter })
  }

  return (
    <div className="app">
      <h1>Todo List</h1>
      <TaskForm onAdd={addTask} />
      <TaskFilters counts={counts} active={filter} onSelect={handleSetFilter} />
      <TaskList
        tasks={visibleTasks}
        editingId={editingId}
        onToggle={toggleTask}
        onDelete={deleteTask}
        onEditStart={setEditingId}
        onEditSave={saveEdit}
        onEditCancel={() => setEditingId(null)}
        onReorder={reorderTasks}
      />
      <ActionLog entries={log} />
    </div>
  )
}
