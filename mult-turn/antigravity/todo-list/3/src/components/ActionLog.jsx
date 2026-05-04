import React from 'react';

const ActionLog = ({ logs }) => {
  return (
    <section className="card action-log-container" data-testid="action-log">
      <h2>Action Log</h2>
      <div className="log-list">
        {logs.length === 0 ? (
          <p className="empty-state">No actions recorded yet.</p>
        ) : (
          logs.map((log, index) => (
            <div key={log.timestamp + index} className="log-entry" data-testid="log-entry">
              <div className="log-header">
                <span className={`log-type type-${log.type.toLowerCase()}`} data-testid="log-type">
                  {log.type}
                </span>
                <span className="log-timestamp" data-testid="log-timestamp">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="log-description">{log.description}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

export default ActionLog;
