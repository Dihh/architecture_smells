import { useState, useRef, useEffect } from 'react'
import './App.css'

interface Task {
  id: string;
  title: string;
  completed: boolean;
  date: string;
  createdAt: string;
}

function App() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    const stored = localStorage.getItem('tasks');
    if (stored) {
      try {
        return JSON.parse(stored) as Task[];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'late'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [oldTitle, setOldTitle] = useState('');
  const [actionLog, setActionLog] = useState<Array<{type: string, description: string, timestamp: string, payload: object | null}>>([]);
  const [undoStack, setUndoStack] = useState<Task[][]>([]);
  const [redoStack, setRedoStack] = useState<Task[][]>([]);
  const [lastUndoneDescription, setLastUndoneDescription] = useState<string>('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [touchStart, setTouchStart] = useState<{x: number, y: number, time: number} | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }, [tasks]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    pushToHistory();
    const newTask: Task = {
      id: crypto.randomUUID(),
      title: title.trim(),
      completed: false,
      date,
      createdAt: new Date().toISOString(),
    };
    setTasks(prev => [...prev, newTask]);
    addLogEntry('ADD_TASK', `Added task: ${newTask.title}`, newTask);
    setTitle('');
    setDate('');
    inputRef.current?.focus();
  };

  const toggleCompleted = (task: Task) => {
    pushToHistory();
    const newCompleted = !task.completed;
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed: newCompleted } : t));
    addLogEntry('TOGGLE_TASK', `Toggled task: ${task.title} (${task.completed ? 'incomplete' : 'complete'})`, { id: task.id, completed: newCompleted });
  };

  const deleteTask = (task: Task) => {
    pushToHistory();
    setTasks(prev => prev.filter(t => t.id !== task.id));
    addLogEntry('DELETE_TASK', `Deleted task: ${task.title}`, { id: task.id, title: task.title });
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setOldTitle(task.title);
  };

  const handleSave = () => {
    if (!editTitle.trim()) return;
    pushToHistory();
    setTasks(prev => prev.map(t => t.id === editingId ? { ...t, title: editTitle.trim() } : t));
    addLogEntry('EDIT_TASK', `Edited task: "${oldTitle}" → "${editTitle.trim()}"`, { id: editingId, oldTitle, newTitle: editTitle.trim() });
    setEditingId(null);
    setEditTitle('');
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
  };

  const addLogEntry = (type: string, description: string, payload: object | null) => {
    const entry = { type, description, timestamp: new Date().toISOString(), payload };
    setActionLog(prev => [entry, ...prev]);
  };

  const pushToHistory = () => {
    setUndoStack(prev => [...prev, [...tasks]]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previousTasks = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, [...tasks]]);
    setTasks(previousTasks);
    setUndoStack(prev => prev.slice(0, -1));
    const lastUndoable = actionLog.find(entry => ['ADD_TASK', 'EDIT_TASK', 'DELETE_TASK', 'TOGGLE_TASK'].includes(entry.type));
    const desc = lastUndoable ? lastUndoable.description : 'unknown action';
    addLogEntry('UNDO', `Undo: ${desc}`, null);
    setLastUndoneDescription(desc);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextTasks = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, [...tasks]]);
    setTasks(nextTasks);
    setRedoStack(prev => prev.slice(0, -1));
    addLogEntry('REDO', `Redo: ${lastUndoneDescription}`, null);
  };

  const isLate = (task: Task) => task.date && new Date(task.date) < new Date() && !task.completed;

  const totalTasks = tasks.length;
  const pendingCount = tasks.filter(t => !t.completed && !isLate(t)).length;
  const completedCount = tasks.filter(t => t.completed).length;
  const lateCount = tasks.filter(t => isLate(t)).length;

  const filteredTasks = tasks.filter(task => {
    switch (filter) {
      case 'all': return true;
      case 'pending': return !task.completed && !isLate(task);
      case 'completed': return task.completed;
      case 'late': return isLate(task);
      default: return true;
    }
  });

  const moveItem = (array: Task[], from: number, to: number): Task[] => {
    const newArray = [...array];
    const [item] = newArray.splice(from, 1);
    newArray.splice(to, 0, item);
    return newArray;
  };

  const reorder = (from: number, to: number) => {
    const visibleIndices = tasks.map((_, i) => i).filter(i => {
      const t = tasks[i];
      switch (filter) {
        case 'all': return true;
        case 'pending': return !t.completed && !isLate(t);
        case 'completed': return t.completed;
        case 'late': return isLate(t);
        default: return true;
      }
    });
    const fromArrayIndex = visibleIndices[from];
    const toArrayIndex = visibleIndices[to];
    const newTasks = moveItem(tasks, fromArrayIndex, toArrayIndex);
    pushToHistory();
    setTasks(newTasks);
    addLogEntry('REORDER', 'Reordered tasks', { fromIndex: from, toIndex: to });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.target !== e.currentTarget) return;
    const touch = e.touches[0];
    setTouchStart({ x: touch.clientX, y: touch.clientY, time: Date.now() });
  };

  const handleTouchEnd = (task: Task) => (e: React.TouchEvent) => {
    if (!touchStart || e.target !== e.currentTarget) {
      setTouchStart(null);
      return;
    }
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    const time = Date.now() - touchStart.time;
    const horizontal = Math.abs(dx);
    const vertical = Math.abs(dy);
    if (horizontal > 100 && horizontal > vertical) {
      // swipe to delete
      setTimeout(() => {
        pushToHistory();
        setTasks(prev => prev.filter(t => t.id !== task.id));
        addLogEntry('DELETE_TASK', `Deleted task: ${task.title}`, { id: task.id, title: task.title });
      }, 300);
    } else if (horizontal < 10 && vertical < 10 && time < 200) {
      // tap to complete
      pushToHistory();
      const newCompleted = !task.completed;
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed: newCompleted } : t));
      addLogEntry('TOGGLE_TASK', `Toggled task: ${task.title} (${task.completed ? 'incomplete' : 'complete'})`, { id: task.id, completed: newCompleted });
    }
    setTouchStart(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app">
      <h1>Todo List</h1>
      <form data-testid="task-form" onSubmit={handleSubmit} className="task-form">
        <input
          data-testid="task-input"
          ref={inputRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Enter task title"
          className="task-input"
        />
        <input
          data-testid="task-date-input"
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="task-date-input"
        />
        <button data-testid="task-submit" type="submit" className="task-submit">Add Task</button>
      </form>
      <div className="filters">
        <button data-testid="filter-all" aria-pressed={filter === 'all' ? "true" : "false"} onClick={() => { setFilter('all'); addLogEntry('SET_FILTER', 'Set filter to: all', { filter: 'all' }); }} className="filter-btn">
          All <span data-testid="filter-count-all">{totalTasks}</span>
        </button>
        <button data-testid="filter-pending" aria-pressed={filter === 'pending' ? "true" : "false"} onClick={() => { setFilter('pending'); addLogEntry('SET_FILTER', 'Set filter to: pending', { filter: 'pending' }); }} className="filter-btn">
          Pending <span data-testid="filter-count-pending">{pendingCount}</span>
        </button>
        <button data-testid="filter-completed" aria-pressed={filter === 'completed' ? "true" : "false"} onClick={() => { setFilter('completed'); addLogEntry('SET_FILTER', 'Set filter to: completed', { filter: 'completed' }); }} className="filter-btn">
          Completed <span data-testid="filter-count-completed">{completedCount}</span>
        </button>
        <button data-testid="filter-late" aria-pressed={filter === 'late' ? "true" : "false"} onClick={() => { setFilter('late'); addLogEntry('SET_FILTER', 'Set filter to: late', { filter: 'late' }); }} className="filter-btn">
          Late <span data-testid="filter-count-late">{lateCount}</span>
        </button>
      </div>
      <div data-testid="task-list" className="task-list">
        {filteredTasks.map((task, index) => (
          <div
            key={task.id}
            data-testid="task-item"
            data-task-id={task.id}
            data-completed={task.completed.toString()}
            data-late={isLate(task).toString()}
            className={`task-item ${task.completed ? 'completed' : ''} ${isLate(task) ? 'late' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (draggedIndex !== null && draggedIndex !== index) {
                reorder(draggedIndex, index);
              }
              setDraggedIndex(null);
            }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd(task)}
          >
            <span
              data-testid="task-drag-handle"
              className="drag-handle"
              draggable
              onDragStart={() => setDraggedIndex(index)}
              onTouchStart={(e) => e.stopPropagation()}
            >
              ⋮⋮
            </span>
            <input
              data-testid="task-checkbox"
              type="checkbox"
              checked={task.completed}
              onChange={() => toggleCompleted(task)}
              className="task-checkbox"
              aria-checked={task.completed ? "true" : "false"}
              aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
            />
            {editingId === task.id ? (
              <div className="inline-edit-form">
                <input
                  data-testid="inline-edit-input"
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onTouchStart={(e) => e.stopPropagation()}
                  className="inline-edit-input"
                />
                <button data-testid="inline-edit-save" onClick={handleSave} onTouchStart={(e) => e.stopPropagation()} className="inline-edit-save">Save</button>
                <button data-testid="inline-edit-cancel" onClick={handleCancel} onTouchStart={(e) => e.stopPropagation()} className="inline-edit-cancel">Cancel</button>
              </div>
            ) : (
              <>
                <span data-testid="task-title" className="task-title">{task.title}</span>
                <button data-testid="task-edit-btn" onClick={() => startEdit(task)} onTouchStart={(e) => e.stopPropagation()} className="task-edit-btn">Edit</button>
              </>
            )}
            {task.date && <span className="task-date">Due: {task.date}</span>}
            <button data-testid="task-delete-btn" onClick={() => deleteTask(task)} onTouchStart={(e) => e.stopPropagation()} className="task-delete-btn">Delete</button>
          </div>
        ))}
      </div>
      <div data-testid="action-log" className="action-log">
        <h2>Action Log</h2>
        {actionLog.map((entry, index) => (
          <div key={index} data-testid="log-entry" className="log-entry">
            <span data-testid="log-type" className="log-type">{entry.type}</span>
            <span className="log-description">{entry.description}</span>
            <span data-testid="log-timestamp" className="log-timestamp">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
