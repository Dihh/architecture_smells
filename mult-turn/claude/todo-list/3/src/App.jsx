import { useState, useEffect } from 'react';
import { useTasks } from './useTasks';
import { useLog } from './useLog';
import { TaskForm } from './TaskForm';
import { TaskList } from './TaskList';
import { TaskFilters } from './TaskFilters';
import { ActionLog } from './ActionLog';
import './App.css';

function computeCounts(tasks) {
  return {
    all:       tasks.length,
    pending:   tasks.filter(t => !t.completed && !t.late).length,
    completed: tasks.filter(t => t.completed).length,
    late:      tasks.filter(t => t.late).length,
  };
}

function applyFilter(tasks, filter) {
  if (filter === 'pending')   return tasks.filter(t => !t.completed && !t.late);
  if (filter === 'completed') return tasks.filter(t => t.completed);
  if (filter === 'late')      return tasks.filter(t => t.late);
  return tasks;
}

export default function App() {
  const { entries, log } = useLog();
  const { tasks, addTask, toggleTask, deleteTask, updateTitle, reorderTasks, undo, redo } = useTasks(log);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    function handleKeyDown(e) {
      const isZ = e.key === 'z' || e.key === 'Z';
      if (!e.ctrlKey || !isZ) return;
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  function handleSetFilter(next) {
    setFilter(next);
    log('SET_FILTER', `Filter changed to: ${next}`, { filter: next });
  }

  const counts = computeCounts(tasks);
  const visibleTasks = applyFilter(tasks, filter);

  return (
    <main className="app">
      <h1 className="app-title">Todo List</h1>
      <TaskForm onAdd={addTask} />
      <TaskFilters active={filter} counts={counts} onSelect={handleSetFilter} />
      <TaskList
        tasks={visibleTasks}
        onToggle={toggleTask}
        onDelete={deleteTask}
        onUpdateTitle={updateTitle}
        onReorder={reorderTasks}
      />
      <ActionLog entries={entries} />
    </main>
  );
}
