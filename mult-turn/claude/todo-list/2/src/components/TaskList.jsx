import { useRef, useState } from 'react'
import TaskItem from './TaskItem'
import './TaskList.css'

export default function TaskList({ tasks, editingId, onToggle, onDelete, onEditStart, onEditSave, onEditCancel, onReorder }) {
  const dragSrcIndex = useRef(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  function handleDragStart(index) {
    dragSrcIndex.current = index
  }

  function handleDragOver(e, index) {
    e.preventDefault()
    if (index !== dragOverIndex) setDragOverIndex(index)
  }

  function handleDrop(index) {
    const src = dragSrcIndex.current
    dragSrcIndex.current = null
    setDragOverIndex(null)
    if (src === null || src === index) return
    onReorder(src, index)
  }

  function handleDragEnd() {
    dragSrcIndex.current = null
    setDragOverIndex(null)
  }

  return (
    <ul data-testid="task-list" className="task-list">
      {tasks.length === 0 && (
        <li className="task-list__empty">No tasks yet. Add one above!</li>
      )}
      {tasks.map((task, index) => (
        <TaskItem
          key={task.id}
          task={task}
          index={index}
          isEditing={editingId === task.id}
          isDragOver={dragOverIndex === index}
          onToggle={onToggle}
          onDelete={onDelete}
          onEditStart={onEditStart}
          onEditSave={onEditSave}
          onEditCancel={onEditCancel}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
    </ul>
  )
}
