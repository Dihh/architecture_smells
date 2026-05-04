import './TaskFilters.css'

const FILTERS = [
  { key: 'all',       label: 'All' },
  { key: 'pending',   label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'late',      label: 'Late' },
]

export default function TaskFilters({ counts, active, onSelect }) {
  return (
    <div className="task-filters" role="group" aria-label="Filter tasks">
      {FILTERS.map(({ key, label }) => (
        <button
          key={key}
          data-testid={`filter-${key}`}
          type="button"
          className={`task-filters__btn${active === key ? ' task-filters__btn--active' : ''}`}
          aria-pressed={String(active === key)}
          onClick={() => onSelect(key)}
        >
          {label}
          <span
            data-testid={`filter-count-${key}`}
            className="task-filters__count"
          >
            {counts[key]}
          </span>
        </button>
      ))}
    </div>
  )
}
