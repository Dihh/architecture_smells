import { useState } from 'react';

export default function MessageInput({ onSendMessage }) {
  const [content, setContent] = useState('');

  function handleSubmit(event) {
    event.preventDefault();

    if (content.length === 0) {
      return;
    }

    onSendMessage(content);
    setContent('');
  }

  return (
    <form className="message-input-form" onSubmit={handleSubmit}>
      <input
        data-testid="input-message"
        type="text"
        value={content}
        onChange={(event) => setContent(event.target.value)}
      />
      <button data-testid="btn-send" type="submit" disabled={content.length === 0}>
        Send
      </button>
    </form>
  );
}
