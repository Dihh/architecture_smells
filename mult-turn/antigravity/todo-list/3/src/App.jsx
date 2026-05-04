import React, { useState, useEffect } from 'react';
import TaskForm from './components/TaskForm';
import TaskList from './components/TaskList';
import TaskFilters from './components/TaskFilters';
import ActionLog from './components/ActionLog';
import { isLate } from './utils';

function App() {
  const [tasks, setTasks] = useState(() => {
    try {
      const saved = localStorage.getItem('tasks');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Failed to parse tasks from localStorage', e);
      return [];
    }
  });

  const [editingTaskId, setEditingTaskId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [logs, setLogs] = useState([]);

  // History state
  const [past, setPast] = useState([]); // [{ tasks, description }]
  const [future, setFuture] = useState([]); // [{ tasks, description }]

  useEffect(() => {
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }, [tasks]);

  const addLog = (type, description, payload = null) => {
    const newEntry = {
      type,
      description,
      timestamp: new Date().toISOString(),
      payload,
    };
    setLogs((prev) => [newEntry, ...prev]);
  };

  const executeAction = (newTasks, type, description, payload) => {
    setPast((prev) => [...prev, { tasks, description }]);
    setFuture([]);
    setTasks(newTasks);
    addLog(type, description, payload);
  };

  const undo = () => {
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    setFuture((prev) => [{ tasks, description: previous.description }, ...prev]);
    setPast(newPast);
    setTasks(previous.tasks);
    addLog('UNDO', `Undo: ${previous.description}`, null);
  };

  const redo = () => {
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);

    setPast((prev) => [...prev, { tasks, description: next.description }]);
    setFuture(newFuture);
    setTasks(next.tasks);
    addLog('REDO', `Redo: ${next.description}`, null);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.shiftKey && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          redo();
        } else if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [past, future, tasks]);

  const addTask = (task) => {
    const newTasks = [task, ...tasks];
    executeAction(newTasks, 'ADD_TASK', `Added task: ${task.title}`, task);
  };

  const toggleComplete = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    const newCompleted = !task.completed;
    const newTasks = tasks.map((t) =>
      t.id === id ? { ...t, completed: newCompleted } : t
    );
    executeAction(newTasks, 'TOGGLE_TASK', `Toggled task: ${task.title} to ${newCompleted ? 'completed' : 'pending'}`, { id, completed: newCompleted });
  };

  const deleteTask = (id) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const newTasks = tasks.filter((t) => t.id !== id);
    if (editingTaskId === id) setEditingTaskId(null);
    executeAction(newTasks, 'DELETE_TASK', `Deleted task: ${task.title}`, { id, title: task.title });
  };

  const updateTaskTitle = (id, newTitle) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const oldTitle = task.title;
    const newTasks = tasks.map((t) =>
      t.id === id ? { ...t, title: newTitle } : t
    );
    setEditingTaskId(null);
    executeAction(newTasks, 'EDIT_TASK', `Edited task: "${oldTitle}" to "${newTitle}"`, { id, oldTitle, newTitle });
  };

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
    addLog('SET_FILTER', `Changed filter to: ${newFilter}`, { filter: newFilter });
  };

  const reorderTasks = (fromVisibleIndex, toVisibleIndex) => {
    if (fromVisibleIndex === toVisibleIndex) return;

    const newTasks = [...tasks];
    
    // Find the original indices in the tasks array
    const visibleTasks = tasks.filter((task) => {
      const late = isLate(task.date, task.completed);
      if (filter === 'pending') return !task.completed && !late;
      if (filter === 'completed') return task.completed;
      if (filter === 'late') return late;
      return true;
    });

    const taskToMove = visibleTasks[fromVisibleIndex];
    const taskTarget = visibleTasks[toVisibleIndex];

    const actualFromIndex = newTasks.findIndex(t => t.id === taskToMove.id);
    const actualToIndex = newTasks.findIndex(t => t.id === taskTarget.id);

    newTasks.splice(actualFromIndex, 1);
    newTasks.splice(actualToIndex, 0, taskToMove);

    executeAction(newTasks, 'REORDER', 'Reordered tasks', { fromIndex: fromVisibleIndex, toIndex: toVisibleIndex });
  };


  // Filtering logic
  const filteredTasks = tasks.filter((task) => {
    const late = isLate(task.date, task.completed);
    if (filter === 'pending') return !task.completed && !late;
    if (filter === 'completed') return task.completed;
    if (filter === 'late') return late;
    return true; // all
  });

  // Counts for filters (always reflect full array)
  const counts = {
    all: tasks.length,
    pending: tasks.filter(t => !t.completed && !isLate(t.date, t.completed)).length,
    completed: tasks.filter(t => t.completed).length,
    late: tasks.filter(t => isLate(t.date, t.completed)).length,
  };

  return (
    <main>
      <h1>Task Manager</h1>
      <TaskForm onAddTask={addTask} />
      
      <TaskFilters 
        activeFilter={filter} 
        onFilterChange={handleFilterChange} 
        counts={counts} 
      />

      <TaskList
        tasks={filteredTasks}
        onToggleComplete={toggleComplete}
        onDelete={deleteTask}
        editingTaskId={editingTaskId}
        onSetEditingTask={setEditingTaskId}
        onSaveEdit={updateTaskTitle}
        onReorder={reorderTasks}
      />

      <ActionLog logs={logs} />
    </main>
  );
}

export default App;

