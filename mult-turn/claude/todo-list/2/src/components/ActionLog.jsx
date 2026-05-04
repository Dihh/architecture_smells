import './ActionLog.css'

export default function ActionLog({ entries }) {
  return (
    <div data-testid="action-log" className="action-log">
      <h2 className="action-log__heading">Action Log</h2>
      {entries.length === 0 && (
        <p className="action-log__empty">No actions yet.</p>
      )}
      {entries.map(entry => (
        <div key={entry.id} data-testid="log-entry" className="action-log__entry">
          <span data-testid="log-type" className="action-log__type">{entry.type}</span>
          <span className="action-log__description">{entry.description}</span>
          <time data-testid="log-timestamp" className="action-log__timestamp" dateTime={entry.timestamp}>
            {new Date(entry.timestamp).toLocaleTimeString()}
          </time>
        </div>
      ))}
    </div>
  )
}
