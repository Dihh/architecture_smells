import React, { useState, useEffect, useRef } from 'react';
import { isLate } from '../utils';

const TaskItem = ({ 
  task, 
  index,
  onToggleComplete, 
  onDelete, 
  isEditing, 
  onSetEditing, 
  onCancelEditing, 
  onSaveEdit,
  onDragStart,
  onDragOver,
  onDrop
}) => {
  const { id, title, completed, date } = task;
  const late = isLate(date, completed);
  const [editTitle, setEditTitle] = useState(title);
  const [isDraggable, setIsDraggable] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const editInputRef = useRef(null);

  // Touch gesture state
  const touchState = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    isSwipe: false,
    isScroll: false
  });

  useEffect(() => {
    if (isEditing) {
      setEditTitle(title);
      if (editInputRef.current) {
        editInputRef.current.focus();
      }
    }
  }, [isEditing, title]);

  const handleSave = () => {
    if (editTitle.trim()) {
      onSaveEdit(id, editTitle.trim());
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      onCancelEditing();
    }
  };

  // Touch Handlers
  const handleTouchStart = (e) => {
    // Ignore if touching interactive elements
    if (e.target.closest('button') || e.target.closest('.drag-handle') || e.target.closest('.inline-edit-input')) {
      return;
    }

    const touch = e.touches[0];
    touchState.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      isSwipe: false,
      isScroll: false
    };
    setSwipeOffset(0);
  };

  const handleTouchMove = (e) => {
    if (touchState.current.isScroll) return;

    const touch = e.touches[0];
    const diffX = touch.clientX - touchState.current.startX;
    const diffY = touch.clientY - touchState.current.startY;

    // Detect if this is a scroll or a potential swipe
    if (!touchState.current.isSwipe && !touchState.current.isScroll) {
      if (Math.abs(diffY) > Math.abs(diffX)) {
        touchState.current.isScroll = true;
        return;
      }
      if (Math.abs(diffX) > 10) {
        touchState.current.isSwipe = true;
      }
    }

    if (touchState.current.isSwipe) {
      setSwipeOffset(diffX);
    }
  };

  const handleTouchEnd = (e) => {
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - touchState.current.startX;
    const diffY = touch.clientY - touchState.current.startY;
    const duration = Date.now() - touchState.current.startTime;

    // Tap to complete
    if (!touchState.current.isSwipe && !touchState.current.isScroll) {
      if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10 && duration < 200) {
        onToggleComplete(id);
      }
    }

    // Swipe to delete
    if (touchState.current.isSwipe && !touchState.current.isScroll) {
      if (Math.abs(diffX) > 100) {
        // Threshold crossed - animate away and delete
        setSwipeOffset(diffX > 0 ? 500 : -500);
        setTimeout(() => {
          onDelete(id);
        }, 300);
      } else {
        // Snap back
        setSwipeOffset(0);
      }
    }

    touchState.current = { ...touchState.current, isSwipe: false, isScroll: false };
  };

  return (
    <div
      className={`card task-item fade-in ${completed ? 'completed' : ''} ${late ? 'late' : ''}`}
      style={{ 
        transform: `translateX(${swipeOffset}px)`, 
        transition: (swipeOffset !== 0 && Math.abs(swipeOffset) < 500) ? 'none' : 'transform 0.3s ease',
        touchAction: 'pan-y'
      }}
      data-testid="task-item"
      data-task-id={id}
      data-completed={completed.toString()}
      data-late={late.toString()}
      draggable={isDraggable}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={() => setIsDraggable(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div 
        className="drag-handle" 
        data-testid="task-drag-handle"
        onMouseDown={() => setIsDraggable(true)}
        onMouseUp={() => setIsDraggable(false)}
      >
        ⋮⋮
      </div>

      <div className="task-content">
        {isEditing ? (
          <div className="inline-edit-form">
            <input
              className="inline-edit-input"
              data-testid="inline-edit-input"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              ref={editInputRef}
            />
            <button
              className="btn-primary btn-small"
              data-testid="inline-edit-save"
              onClick={handleSave}
            >
              Save
            </button>
            <button
              className="btn-outline btn-small"
              data-testid="inline-edit-cancel"
              onClick={onCancelEditing}
            >
              Cancel
            </button>
          </div>
        ) : (
          <h3 data-testid="task-title" className="task-title">
            {title}
          </h3>
        )}
        {date && (
          <span className="task-date">
            Due: {new Date(date).toLocaleDateString()}
          </span>
        )}
      </div>
      <div className="task-actions">
        {!isEditing && (
          <button
            className="btn-icon btn-outline"
            onClick={onSetEditing}
            data-testid="task-edit-btn"
            title="Edit task"
          >
            ✎
          </button>
        )}
        <button
          className={`btn-icon ${completed ? 'btn-success' : 'btn-outline'}`}
          onClick={() => onToggleComplete(id)}
          data-testid="task-checkbox"
          aria-checked={completed.toString()}
          aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
          title={completed ? 'Mark as incomplete' : 'Mark as complete'}
        >
          {completed ? '✓' : '○'}
        </button>
        <button
          className="btn-icon btn-danger"
          onClick={() => onDelete(id)}
          data-testid="task-delete-btn"
          title="Delete task"
        >
          ✕
        </button>
      </div>
    </div>
  );
};


export default TaskItem;
