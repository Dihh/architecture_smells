import { useState, useEffect, useRef } from 'react';

const INTERACTIVE_SELECTOR = [
  '[data-testid="task-checkbox"]',
  '[data-testid="task-edit-btn"]',
  '[data-testid="task-delete-btn"]',
  '[data-testid="task-drag-handle"]',
].join(', ');

const SWIPE_THRESHOLD = 100;  // px
const TAP_MOVE_LIMIT  = 10;   // px
const TAP_TIME_LIMIT  = 200;  // ms

function TaskItem({
  task, index, editingId, onSetEditing,
  onToggle, onDelete, onUpdateTitle,
  onDragStart, onDragEnter, onDragEnd, onDrop,
  isDragOver, isDragging,
}) {
  const isEditing = editingId === task.id;
  const [draft, setDraft] = useState(task.title);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const inputRef   = useRef(null);
  const liRef      = useRef(null);
  const fromHandle = useRef(false);   // DnD gate
  const gesture    = useRef(null);    // { x, y, time } for active touch
  const isEditingRef = useRef(isEditing);

  // Keep a stable ref to callbacks so the passive-false listener can call them.
  const cb = useRef({ onToggle, onDelete });
  useEffect(() => { cb.current = { onToggle, onDelete }; });
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  // ── inline-edit focus ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isEditing) {
      setDraft(task.title);
      inputRef.current?.focus();
    }
  }, [isEditing, task.title]);

  // ── touch: passive:false touchmove must be added imperatively ─────────────
  useEffect(() => {
    const el = liRef.current;
    if (!el) return;

    function handleTouchMove(e) {
      if (!gesture.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - gesture.current.x;
      const dy = touch.clientY - gesture.current.y;
      // Only intercept horizontal-dominant movement.
      if (Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
        setSwipeX(dx);
        setSwiping(true);
      }
    }

    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', handleTouchMove);
  }, []); // registers once; uses refs for live values

  // ── touch start ───────────────────────────────────────────────────────────
  function handleTouchStart(e) {
    // Ignore touches on interactive children and during editing.
    if (isEditingRef.current) return;
    if (e.target.closest(INTERACTIVE_SELECTOR)) return;
    const t = e.touches[0];
    gesture.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  }

  // ── touch end ─────────────────────────────────────────────────────────────
  function handleTouchEnd(e) {
    if (!gesture.current) return;
    const t = e.changedTouches[0];
    const dx  = t.clientX - gesture.current.x;
    const dy  = t.clientY - gesture.current.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const dt  = Date.now() - gesture.current.time;
    gesture.current = null;

    // Reset swipe visual immediately.
    setSwipeX(0);
    setSwiping(false);

    if (adx >= SWIPE_THRESHOLD && adx > ady) {
      // Swipe-to-delete: schedule within 300 ms.
      const id = task.id;
      setTimeout(() => cb.current.onDelete(id), 0);
    } else if (adx < TAP_MOVE_LIMIT && ady < TAP_MOVE_LIMIT && dt < TAP_TIME_LIMIT) {
      // Short tap on card body → toggle.
      cb.current.onToggle(task.id);
    }
  }

  function handleTouchCancel() {
    gesture.current = null;
    setSwipeX(0);
    setSwiping(false);
  }

  // ── drag-and-drop (desktop) ───────────────────────────────────────────────
  function handleDragStart(e) {
    if (!fromHandle.current) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    onDragStart(index);
  }

  function handleDragEnd() {
    fromHandle.current = false;
    onDragEnd();
  }

  // ── inline edit helpers ───────────────────────────────────────────────────
  function save() {
    const ok = onUpdateTitle(task.id, draft);
    if (ok) onSetEditing(null);
  }
  function cancel() { onSetEditing(null); }
  function handleKeyDown(e) {
    if (e.key === 'Enter')  save();
    if (e.key === 'Escape') cancel();
  }

  // ── render ────────────────────────────────────────────────────────────────
  const swipeStyle = swipeX !== 0
    ? { transform: `translateX(${swipeX}px)`, transition: swiping ? 'none' : 'transform 0.2s ease' }
    : { transition: 'transform 0.2s ease' };

  return (
    <li
      ref={liRef}
      draggable
      data-testid="task-item"
      data-task-id={task.id}
      data-completed={String(task.completed)}
      data-late={String(task.late)}
      className={[
        'task-item',
        task.completed ? 'task-item--done' : '',
        task.late      ? 'task-item--late' : '',
        isDragging     ? 'task-item--dragging' : '',
        isDragOver     ? 'task-item--drag-over' : '',
      ].filter(Boolean).join(' ')}
      style={swipeStyle}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onDragStart={handleDragStart}
      onDragEnter={e => { e.preventDefault(); onDragEnter(index); }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); onDrop(index); }}
      onDragEnd={handleDragEnd}
    >
      <span
        data-testid="task-drag-handle"
        className="task-drag-handle"
        aria-hidden="true"
        onMouseDown={() => { fromHandle.current = true; }}
        onMouseUp={()   => { fromHandle.current = false; }}
      >
        ⠿
      </span>

      <input
        type="checkbox"
        role="checkbox"
        data-testid="task-checkbox"
        checked={task.completed}
        aria-checked={String(task.completed)}
        aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
        onChange={() => onToggle(task.id)}
        className="task-checkbox"
      />

      {isEditing ? (
        <span className="inline-edit">
          <input
            ref={inputRef}
            data-testid="inline-edit-input"
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            className="input inline-edit-input"
          />
          <button data-testid="inline-edit-save"   type="button" onClick={save}   className="btn-inline btn-inline--save">Save</button>
          <button data-testid="inline-edit-cancel" type="button" onClick={cancel} className="btn-inline btn-inline--cancel">Cancel</button>
        </span>
      ) : (
        <span data-testid="task-title" className="task-title">{task.title}</span>
      )}

      {task.date && !isEditing && (
        <span className="task-date">
          {task.late ? '⚠ ' : ''}{task.date}
        </span>
      )}

      {!isEditing && (
        <button
          data-testid="task-edit-btn"
          type="button"
          onClick={() => onSetEditing(task.id)}
          className="btn-icon"
          aria-label={`Edit "${task.title}"`}
        >
          ✎
        </button>
      )}

      <button
        data-testid="task-delete-btn"
        type="button"
        onClick={() => onDelete(task.id)}
        className="btn-delete"
        aria-label={`Delete "${task.title}"`}
      >
        ✕
      </button>
    </li>
  );
}

export function TaskList({ tasks, onToggle, onDelete, onUpdateTitle, onReorder }) {
  const [editingId, setEditingId]     = useState(null);
  const [dragIndex, setDragIndex]     = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  function handleDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleDrop(toIndex) {
    if (dragIndex !== null && dragIndex !== toIndex) {
      onReorder(tasks, dragIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }

  return (
    <ul data-testid="task-list" className="task-list">
      {tasks.map((task, index) => (
        <TaskItem
          key={task.id}
          task={task}
          index={index}
          editingId={editingId}
          onSetEditing={setEditingId}
          onToggle={onToggle}
          onDelete={onDelete}
          onUpdateTitle={onUpdateTitle}
          onDragStart={setDragIndex}
          onDragEnter={setDragOverIndex}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          isDragging={dragIndex === index}
          isDragOver={dragOverIndex === index && dragIndex !== index}
        />
      ))}
    </ul>
  );
}
