import { useState } from 'react';

export function useLog() {
  const [entries, setEntries] = useState([]);

  function log(type, description, payload = null) {
    setEntries(prev => [
      { type, description, timestamp: new Date().toISOString(), payload },
      ...prev,
    ]);
  }

  return { entries, log };
}
