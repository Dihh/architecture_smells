const FILTERS = [
  { key: 'all',       label: 'All',       testId: 'filter-all',       countTestId: 'filter-count-all' },
  { key: 'pending',   label: 'Pending',   testId: 'filter-pending',   countTestId: 'filter-count-pending' },
  { key: 'completed', label: 'Completed', testId: 'filter-completed', countTestId: 'filter-count-completed' },
  { key: 'late',      label: 'Late',      testId: 'filter-late',      countTestId: 'filter-count-late' },
];

export function TaskFilters({ active, counts, onSelect }) {
  return (
    <div className="task-filters" role="group" aria-label="Filter tasks">
      {FILTERS.map(({ key, label, testId, countTestId }) => (
        <button
          key={key}
          type="button"
          data-testid={testId}
          aria-pressed={String(active === key)}
          onClick={() => onSelect(key)}
          className={['btn-filter', active === key ? 'btn-filter--active' : ''].filter(Boolean).join(' ')}
        >
          {label}
          <span data-testid={countTestId} className="filter-count">
            {counts[key]}
          </span>
        </button>
      ))}
    </div>
  );
}
