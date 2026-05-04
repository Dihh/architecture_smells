import React from 'react';

const TaskFilters = ({ activeFilter, onFilterChange, counts }) => {
  const filters = [
    { id: 'all', label: 'All', testId: 'filter-all', countTestId: 'filter-count-all' },
    { id: 'pending', label: 'Pending', testId: 'filter-pending', countTestId: 'filter-count-pending' },
    { id: 'completed', label: 'Completed', testId: 'filter-completed', countTestId: 'filter-count-completed' },
    { id: 'late', label: 'Late', testId: 'filter-late', countTestId: 'filter-count-late' },
  ];

  return (
    <div className="task-filters card" data-testid="task-filters">
      {filters.map((f) => (
        <button
          key={f.id}
          data-testid={f.testId}
          aria-pressed={activeFilter === f.id ? "true" : "false"}
          onClick={() => onFilterChange(f.id)}
          className={`filter-btn ${activeFilter === f.id ? 'active' : ''}`}
        >
          {f.label}
          <span className="count-badge" data-testid={f.countTestId}>
            {counts[f.id] || 0}
          </span>
        </button>
      ))}
    </div>
  );
};

export default TaskFilters;

