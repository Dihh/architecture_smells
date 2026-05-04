import { useEffect, useRef } from 'react';

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
}

export default function MessageList({ messages, currentUserId }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="message-list" data-testid="message-list" ref={listRef}>
      {messages.length === 0 ? (
        <p className="message-empty" data-testid="message-empty">
          No messages yet.
        </p>
      ) : (
        messages.map((message) => {
          const isOwnMessage = message.userId === currentUserId;

          return (
            <article
              className={isOwnMessage ? 'message-item own' : 'message-item'}
              data-testid="message-item"
              data-own={isOwnMessage ? 'true' : 'false'}
              data-message-id={message.id}
              key={message.id}
            >
              <div className="message-meta">
                <span data-testid="message-username">
                  {isOwnMessage ? 'You' : message.username}
                </span>
                <time data-testid="message-timestamp" dateTime={message.timestamp}>
                  {formatTimestamp(message.timestamp)}
                </time>
              </div>
              <p data-testid="message-content">{message.content}</p>
            </article>
          );
        })
      )}
    </div>
  );
}
