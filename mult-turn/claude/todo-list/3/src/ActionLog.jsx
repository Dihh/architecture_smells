const TYPE_LABELS = {
  ADD_TASK:    'Added',
  EDIT_TASK:   'Edited',
  DELETE_TASK: 'Deleted',
  TOGGLE_TASK: 'Toggled',
  SET_FILTER:  'Filter',
  UNDO:        'Undo',
  REDO:        'Redo',
  REORDER:     'Reorder',
};

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ActionLog({ entries }) {
  return (
    <section className="action-log" data-testid="action-log" aria-label="Action log">
      <h2 className="log-heading">Action Log</h2>
      {entries.length === 0 ? (
        <p className="log-empty">No actions yet.</p>
      ) : (
        <ol className="log-list">
          {entries.map((entry, i) => (
            <li key={i} data-testid="log-entry" className="log-entry">
              <span data-testid="log-type" className={`log-type log-type--${entry.type.toLowerCase()}`}>
                {TYPE_LABELS[entry.type] ?? entry.type}
              </span>
              <span className="log-description">{entry.description}</span>
              <time data-testid="log-timestamp" className="log-timestamp" dateTime={entry.timestamp}>
                {formatTime(entry.timestamp)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
