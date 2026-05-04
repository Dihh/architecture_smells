import { useState, useRef } from 'react';

const STORAGE_KEY = 'tasks';

function isLate(task) {
  if (!task.date || task.completed) return false;
  const due = new Date(task.date);
  due.setHours(23, 59, 59, 999);
  return due < new Date();
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export function useTasks(onLog) {
  const [tasks, setTasks] = useState(loadFromStorage);

  // Each frame: { snapshot: tasks[], description: string }
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  // tasksRef mirrors state so history callbacks always see current value
  // without stale closure issues when called from useEffect in App.
  const tasksRef = useRef(tasks);

  function update(next) {
    persist(next);
    tasksRef.current = next;
    setTasks(next);
  }

  function commit(next, description) {
    undoStack.current = [...undoStack.current, { snapshot: tasksRef.current, description }];
    redoStack.current = [];
    update(next);
  }

  function addTask(title, date) {
    const trimmed = title.trim();
    if (!trimmed) return false;
    const task = {
      id: crypto.randomUUID(),
      title: trimmed,
      completed: false,
      date: date || '',
      createdAt: new Date().toISOString(),
    };
    const description = `Added task: ${trimmed}`;
    commit([...tasksRef.current, task], description);
    onLog('ADD_TASK', description, task);
    return true;
  }

  function toggleTask(id) {
    const task = tasksRef.current.find(t => t.id === id);
    const newCompleted = !task.completed;
    const description = `Marked "${task.title}" ${newCompleted ? 'complete' : 'incomplete'}`;
    commit(tasksRef.current.map(t => (t.id === id ? { ...t, completed: newCompleted } : t)), description);
    onLog('TOGGLE_TASK', description, { id, completed: newCompleted });
  }

  function deleteTask(id) {
    const task = tasksRef.current.find(t => t.id === id);
    const description = `Deleted task: ${task.title}`;
    commit(tasksRef.current.filter(t => t.id !== id), description);
    onLog('DELETE_TASK', description, { id, title: task.title });
  }

  function updateTitle(id, title) {
    const trimmed = title.trim();
    if (!trimmed) return false;
    const task = tasksRef.current.find(t => t.id === id);
    const description = `Edited task: "${task.title}" → "${trimmed}"`;
    commit(tasksRef.current.map(t => (t.id === id ? { ...t, title: trimmed } : t)), description);
    onLog('EDIT_TASK', description, { id, oldTitle: task.title, newTitle: trimmed });
    return true;
  }

  // visibleTasks may include the derived 'late' field — strip it before storing.
  function reorderTasks(visibleTasks, fromIndex, toIndex) {
    if (fromIndex === toIndex) return;

    // Build the desired visible order after the move.
    const newVisible = [...visibleTasks];
    const [moved] = newVisible.splice(fromIndex, 1);
    newVisible.splice(toIndex, 0, moved);

    // Find which slots in the full array are occupied by visible tasks (in order).
    const visibleIds = new Set(visibleTasks.map(t => t.id));
    const full = tasksRef.current;
    const slots = full.reduce((acc, _, i) => {
      if (visibleIds.has(full[i].id)) acc.push(i);
      return acc;
    }, []);

    // Write the new visible order back into those slots, stripping 'late'.
    const next = [...full];
    slots.forEach((slotIdx, i) => {
      const { late, ...task } = newVisible[i];
      next[slotIdx] = task;
    });

    const description = 'Reordered tasks';
    commit(next, description);
    onLog('REORDER', description, { fromIndex, toIndex });
  }

  function undo() {
    if (undoStack.current.length === 0) return;
    const stack = undoStack.current;
    const { snapshot, description } = stack[stack.length - 1];
    undoStack.current = stack.slice(0, -1);
    redoStack.current = [...redoStack.current, { snapshot: tasksRef.current, description }];
    update(snapshot);
    onLog('UNDO', `Undo: ${description}`, null);
  }

  function redo() {
    if (redoStack.current.length === 0) return;
    const stack = redoStack.current;
    const { snapshot, description } = stack[stack.length - 1];
    redoStack.current = stack.slice(0, -1);
    undoStack.current = [...undoStack.current, { snapshot: tasksRef.current, description }];
    update(snapshot);
    onLog('REDO', `Redo: ${description}`, null);
  }

  const tasksWithMeta = tasks.map(t => ({ ...t, late: isLate(t) }));

  return { tasks: tasksWithMeta, addTask, toggleTask, deleteTask, updateTitle, reorderTasks, undo, redo };
}
