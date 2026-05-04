import { useEffect, useRef, useState } from 'react'
import './TaskItem.css'

function isLate(task) {
  if (!task.date || task.completed) return false
  const today = new Date().toISOString().slice(0, 10)
  return task.date < today
}

// Keeps a ref always pointing at the latest value of fn without re-running effects.
function useLatestRef(fn) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  return ref
}

export default function TaskItem({
  task, index, isEditing, isDragOver,
  onToggle, onDelete, onEditStart, onEditSave, onEditCancel,
  onDragStart, onDragOver, onDrop, onDragEnd,
}) {
  const late = isLate(task)
  const [draft, setDraft] = useState(task.title)
  const inputRef = useRef(null)
  const liRef = useRef(null)
  const dragAllowed = useRef(false)

  // Stable refs so touch handlers never capture stale callbacks.
  const onToggleRef = useLatestRef(onToggle)
  const onDeleteRef = useLatestRef(onDelete)
  const taskRef = useLatestRef(task)

  useEffect(() => {
    if (isEditing) {
      setDraft(task.title)
      inputRef.current?.focus()
    }
  }, [isEditing, task.title])

  // Touch gesture handling via addEventListener so touchmove can be non-passive.
  useEffect(() => {
    const li = liRef.current
    if (!li) return

    // Avoid triggering gestures on interactive elements.
    function isInteractive(el) {
      return el.closest('button, input, [data-testid="task-drag-handle"]')
    }

    const touch = { x: 0, y: 0, time: 0, active: false, scrolling: false }

    function onTouchStart(e) {
      if (isInteractive(e.target)) return
      const t = e.touches[0]
      touch.x = t.clientX
      touch.y = t.clientY
      touch.time = Date.now()
      touch.active = true
      touch.scrolling = false
    }

    function onTouchMove(e) {
      if (!touch.active) return
      const t = e.touches[0]
      const dx = Math.abs(t.clientX - touch.x)
      const dy = Math.abs(t.clientY - touch.y)

      if (!touch.scrolling && dy > dx) {
        // Vertical movement wins — treat as scroll, lock out swipe.
        touch.scrolling = true
      }

      if (!touch.scrolling && dx > dy && dx > 10) {
        // Clearly horizontal — prevent page scroll so the swipe works.
        e.preventDefault()
      }
    }

    function onTouchEnd(e) {
      if (!touch.active) return
      touch.active = false

      const t = e.changedTouches[0]
      const dx = t.clientX - touch.x
      const dy = t.clientY - touch.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const dt = Date.now() - touch.time

      // Swipe-to-delete: horizontal displacement > 100px and dominant axis is horizontal.
      if (!touch.scrolling && absDx > 100 && absDx > absDy) {
        onDeleteRef.current(taskRef.current.id)
        return
      }

      // Tap-to-complete: near-zero displacement within 200ms.
      if (absDx < 10 && absDy < 10 && dt < 200) {
        onToggleRef.current(taskRef.current.id)
      }
    }

    li.addEventListener('touchstart', onTouchStart, { passive: true })
    li.addEventListener('touchmove', onTouchMove, { passive: false })
    li.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      li.removeEventListener('touchstart', onTouchStart)
      li.removeEventListener('touchmove', onTouchMove)
      li.removeEventListener('touchend', onTouchEnd)
    }
  }, []) // empty — stable via refs

  function handleSave() {
    onEditSave(task.id, draft)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave()
    else if (e.key === 'Escape') onEditCancel()
  }

  return (
    <li
      ref={liRef}
      data-testid="task-item"
      data-task-id={task.id}
      data-completed={String(task.completed)}
      data-late={String(late)}
      draggable
      className={[
        'task-item',
        task.completed && 'task-item--completed',
        late && 'task-item--late',
        isDragOver && 'task-item--drag-over',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragStart={e => {
        if (!dragAllowed.current) { e.preventDefault(); return }
        onDragStart(index)
      }}
      onDragOver={e => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onDragEnd={() => { dragAllowed.current = false; onDragEnd() }}
    >
      <span
        data-testid="task-drag-handle"
        className="task-item__drag-handle"
        aria-hidden="true"
        onMouseDown={() => { dragAllowed.current = true }}
        onMouseUp={() => { dragAllowed.current = false }}
      >
        ⠿
      </span>

      <label className="task-item__check-label">
        <input
          data-testid="task-checkbox"
          type="checkbox"
          className="task-item__checkbox"
          checked={task.completed}
          onChange={() => onToggle(task.id)}
          aria-checked={String(task.completed)}
          aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
        />
        <span className="task-item__checkmark" aria-hidden="true" />
      </label>

      <div className="task-item__body">
        {isEditing ? (
          <div className="task-item__inline-edit">
            <input
              ref={inputRef}
              data-testid="inline-edit-input"
              type="text"
              className="task-item__inline-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              data-testid="inline-edit-save"
              type="button"
              className="task-item__inline-save"
              onClick={handleSave}
            >
              Save
            </button>
            <button
              data-testid="inline-edit-cancel"
              type="button"
              className="task-item__inline-cancel"
              onClick={onEditCancel}
            >
              Cancel
            </button>
          </div>
        ) : (
          <span data-testid="task-title" className="task-item__title">
            {task.title}
          </span>
        )}
        {task.date && (
          <span className={`task-item__date${late ? ' task-item__date--late' : ''}`}>
            {late ? '⚠ ' : ''}Due {task.date}
          </span>
        )}
      </div>

      {!isEditing && (
        <button
          data-testid="task-edit-btn"
          type="button"
          className="task-item__edit"
          onClick={() => onEditStart(task.id)}
          aria-label={`Edit "${task.title}"`}
        >
          ✎
        </button>
      )}

      <button
        data-testid="task-delete-btn"
        type="button"
        className="task-item__delete"
        onClick={() => onDelete(task.id)}
        aria-label={`Delete "${task.title}"`}
      >
        ✕
      </button>
    </li>
  )
}
