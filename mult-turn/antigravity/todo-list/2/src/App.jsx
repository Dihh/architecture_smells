import React, { useState, useEffect, useRef } from 'react';
import './index.css';

function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [filter, setFilter] = useState('all');
  const [log, setLog] = useState([]);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [pastActions, setPastActions] = useState([]);
  const [futureActions, setFutureActions] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const inputRef = useRef(null);
  const editInputRef = useRef(null);

  const addLogEntry = (type, description, payload) => {
    const entry = {
      type,
      description,
      timestamp: new Date().toISOString(),
      payload
    };
    setLog(prevLog => [entry, ...prevLog]);
  };

  const pushToHistory = (actionDesc) => {
    setPast(prev => [...prev, tasks]);
    setPastActions(prev => [...prev, actionDesc]);
    setFuture([]);
    setFutureActions([]);
  };

  const handleUndo = () => {
    if (past.length === 0) return;

    const previousTasks = past[past.length - 1];
    const undoneAction = pastActions[pastActions.length - 1];

    setFuture(prev => [...prev, tasks]);
    setFutureActions(prev => [...prev, undoneAction]);
    
    setPast(prev => prev.slice(0, -1));
    setPastActions(prev => prev.slice(0, -1));

    setTasks(previousTasks);
    addLogEntry('UNDO', `Undo: ${undoneAction}`, null);
  };

  const handleRedo = () => {
    if (future.length === 0) return;

    const nextTasks = future[future.length - 1];
    const redoneAction = futureActions[futureActions.length - 1];

    setPast(prev => [...prev, tasks]);
    setPastActions(prev => [...prev, redoneAction]);

    setFuture(prev => prev.slice(0, -1));
    setFutureActions(prev => prev.slice(0, -1));

    setTasks(nextTasks);
    addLogEntry('REDO', `Redo: ${redoneAction}`, null);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [past, future, tasks, pastActions, futureActions]);

  // Load tasks from localStorage
  useEffect(() => {
    const savedTasks = localStorage.getItem('tasks');
    if (savedTasks) {
      try {
        setTasks(JSON.parse(savedTasks));
      } catch (e) {
        console.error('Invalid JSON in localStorage');
        setTasks([]);
      }
    }
  }, []);

  // Save tasks to localStorage
  useEffect(() => {
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }, [tasks]);

  // Focus main input on load
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Focus edit input when opening editor
  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
    }
  }, [editingId]);

  const addTask = (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    const newTask = {
      id: crypto.randomUUID(),
      title: title.trim(),
      completed: false,
      date: date,
      createdAt: new Date().toISOString(),
    };

    const actionDesc = `Added task: ${newTask.title}`;
    pushToHistory(actionDesc);
    setTasks([newTask, ...tasks]);
    addLogEntry('ADD_TASK', actionDesc, newTask);
    setTitle('');
    setDate('');
    inputRef.current?.focus();
  };

  const toggleTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const nextValue = !task.completed;
    
    const actionDesc = `Toggled task: ${task.title} to ${nextValue ? 'completed' : 'pending'}`;
    pushToHistory(actionDesc);
    setTasks(tasks.map(t => 
      t.id === id ? { ...t, completed: nextValue } : t
    ));
    addLogEntry('TOGGLE_TASK', actionDesc, { id, completed: nextValue });
  };

  const deleteTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const actionDesc = `Deleted task: ${task.title}`;
    pushToHistory(actionDesc);
    setTasks(tasks.filter(t => t.id !== id));
    addLogEntry('DELETE_TASK', actionDesc, { id, title: task.title });
    if (editingId === id) setEditingId(null);
  };

  const startEditing = (task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
  };

  const saveEdit = (id) => {
    if (!editTitle.trim()) return;
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const oldTitle = task.title;
    const newTitle = editTitle.trim();

    const actionDesc = `Edited task title from "${oldTitle}" to "${newTitle}"`;
    pushToHistory(actionDesc);
    setTasks(tasks.map(t => 
      t.id === id ? { ...t, title: newTitle } : t
    ));
    addLogEntry('EDIT_TASK', actionDesc, { id, oldTitle, newTitle });
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleEditKeyDown = (e, id) => {
    if (e.key === 'Enter') saveEdit(id);
    if (e.key === 'Escape') cancelEdit();
  };

  const handleSetFilter = (newFilter) => {
    setFilter(newFilter);
    addLogEntry('SET_FILTER', `Changed filter to: ${newFilter}`, { filter: newFilter });
  };

  const isLate = (task) => {
    if (!task.date || task.completed) return false;
    const dueDate = new Date(task.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today;
  };

  const counts = {
    all: tasks.length,
    pending: tasks.filter(t => !t.completed && !isLate(t)).length,
    completed: tasks.filter(t => t.completed).length,
    late: tasks.filter(t => !t.completed && isLate(t)).length
  };

  const filteredTasks = tasks.filter(t => {
    if (filter === 'pending') return !t.completed && !isLate(t);
    if (filter === 'completed') return t.completed;
    if (filter === 'late') return !t.completed && isLate(t);
    return true;
  });

  const onDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  const onDrop = (e, dropIndex) => {
    if (draggedIndex === null || draggedIndex === dropIndex) return;

    const actionDesc = "Reordered tasks";
    pushToHistory(actionDesc);

    const newFilteredTasks = [...filteredTasks];
    const [movedTask] = newFilteredTasks.splice(draggedIndex, 1);
    newFilteredTasks.splice(dropIndex, 0, movedTask);

    // Merge back into original tasks array
    let filteredPtr = 0;
    const nextTasks = tasks.map(t => {
      // Check if this task is part of the current filtered set
      const isFiltered = filteredTasks.some(ft => ft.id === t.id);
      if (isFiltered) {
        return newFilteredTasks[filteredPtr++];
      }
      return t;
    });

    setTasks(nextTasks);
    addLogEntry('REORDER', actionDesc, { fromIndex: draggedIndex, toIndex: dropIndex });
    setDraggedIndex(null);
  };

  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [touchStartTime, setTouchStartTime] = useState(0);

  const handleTouchStart = (e) => {
    // Ignore if touching interactive elements
    if (e.target.closest('button') || e.target.closest('.drag-handle') || e.target.closest('.inline-edit-form')) {
      return;
    }
    const touch = e.touches[0];
    setTouchStart({ x: touch.clientX, y: touch.clientY });
    setTouchStartTime(Date.now());
  };

  const handleTouchMove = (e) => {
    if (!touchStart) return;
    const touch = e.touches[0];
    setTouchEnd({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchEnd = (task) => {
    if (!touchStart || !touchEnd) {
      // Potentially a tap if only touchStart and touchEnd fired without move
      const duration = Date.now() - touchStartTime;
      if (duration < 200) {
        toggleTask(task.id);
      }
      resetTouch();
      return;
    }

    const deltaX = touchEnd.x - touchStart.x;
    const deltaY = touchEnd.y - touchStart.y;
    const duration = Date.now() - touchStartTime;

    // Check if it's a scroll or a swipe
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      resetTouch();
      return;
    }

    // Swipe to delete
    if (Math.abs(deltaX) > 100) {
      setTimeout(() => {
        deleteTask(task.id);
      }, 100);
    } 
    // Tap to complete
    else if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10 && duration < 200) {
      toggleTask(task.id);
    }

    resetTouch();
  };

  const resetTouch = () => {
    setTouchStart(null);
    setTouchEnd(null);
    setTouchStartTime(0);
  };

  return (
    <div className="container">
      <h1>Task Master</h1>
      
      <form data-testid="task-form" className="task-form" onSubmit={addTask}>
        <div className="input-group">
          <input
            type="text"
            data-testid="task-input"
            ref={inputRef}
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="input-row">
          <input
            type="date"
            data-testid="task-date-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button type="submit" data-testid="task-submit" className="btn-primary">
            Add Task
          </button>
        </div>
      </form>

      <div className="filter-bar">
        <button
          data-testid="filter-all"
          aria-pressed={filter === 'all'}
          className={filter === 'all' ? 'active' : ''}
          onClick={() => handleSetFilter('all')}
        >
          All <span data-testid="filter-count-all" className="count">{counts.all}</span>
        </button>
        <button
          data-testid="filter-pending"
          aria-pressed={filter === 'pending'}
          className={filter === 'pending' ? 'active' : ''}
          onClick={() => handleSetFilter('pending')}
        >
          Pending <span data-testid="filter-count-pending" className="count">{counts.pending}</span>
        </button>
        <button
          data-testid="filter-completed"
          aria-pressed={filter === 'completed'}
          className={filter === 'completed' ? 'active' : ''}
          onClick={() => handleSetFilter('completed')}
        >
          Completed <span data-testid="filter-count-completed" className="count">{counts.completed}</span>
        </button>
        <button
          data-testid="filter-late"
          aria-pressed={filter === 'late'}
          className={filter === 'late' ? 'active' : ''}
          onClick={() => handleSetFilter('late')}
        >
          Late <span data-testid="filter-count-late" className="count">{counts.late}</span>
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
            className={`task-item ${draggedIndex === index ? 'dragging' : ''}`}
            draggable={draggedIndex !== null}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, index)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => handleTouchEnd(task)}
          >
            <div
              className="drag-handle"
              data-testid="task-drag-handle"
              aria-label="Drag to reorder"
              onMouseDown={() => setDraggedIndex(index)}
              onMouseUp={() => setDraggedIndex(null)}
              onDragStart={(e) => onDragStart(e, index)}
              onDragEnd={() => setDraggedIndex(null)}
              draggable
            >
              ⋮⋮
            </div>

            <button
              className="checkbox"
              data-testid="task-checkbox"
              aria-checked={task.completed}
              aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
              onClick={() => toggleTask(task.id)}
            />
            
            <div className="task-content">
              {editingId === task.id ? (
                <div className="inline-edit-form">
                  <input
                    type="text"
                    data-testid="inline-edit-input"
                    ref={editInputRef}
                    className="inline-edit-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => handleEditKeyDown(e, task.id)}
                  />
                  <div className="actions">
                    <button
                      className="btn-primary btn-save"
                      data-testid="inline-edit-save"
                      onClick={() => saveEdit(task.id)}
                    >
                      Save
                    </button>
                    <button
                      className="btn-icon btn-cancel"
                      data-testid="inline-edit-cancel"
                      onClick={cancelEdit}
                      aria-label="Cancel editing"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span data-testid="task-title" className="task-title">
                    {task.title}
                  </span>
                  {task.date && (
                    <span className="task-date">Due: {task.date}</span>
                  )}
                </>
              )}
            </div>

            <div className="actions">
              {editingId !== task.id && (
                <button
                  className="btn-icon btn-edit"
                  data-testid="task-edit-btn"
                  onClick={() => startEditing(task)}
                  aria-label="Edit task"
                >
                  ✎
                </button>
              )}
              <button
                className="btn-icon btn-delete"
                data-testid="task-delete-btn"
                onClick={() => deleteTask(task.id)}
                aria-label="Delete task"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <div data-testid="action-log" className="action-log">
        <h3>Action Log</h3>
        <div className="log-container">
          {log.map((entry, idx) => (
            <div key={idx} data-testid="log-entry" className="log-entry">
              <span data-testid="log-type" className={`log-type type-${entry.type.toLowerCase()}`}>
                {entry.type}
              </span>
              <span className="log-desc">{entry.description}</span>
              <span data-testid="log-timestamp" className="log-time">
                {entry.timestamp}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
