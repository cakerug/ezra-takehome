import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ApiError,
  completeTask,
  deleteTask,
  moveTask,
  uncompleteTask,
  updateTask,
} from '../api/client';
import type { ProjectResponse, TaskResponse } from '../api/types';
import { extractErrorMessage } from '../api/errors';
import { ConfirmDialog } from './ConfirmDialog';

interface TaskItemProps {
  task: TaskResponse;
  /** All projects other than the task's own, for the "move to project" dropdown. */
  otherProjects: ProjectResponse[];
  onError: (message: string) => void;
  /** Only incomplete tasks participate in drag-to-reorder; completed ones render without a
   * drag handle since they're pinned to the bottom regardless of order. */
  isDraggable: boolean;
}

/**
 * A single task row: drag handle (via `useSortable`), complete/uncomplete checkbox, inline
 * edit form (mirrors `ProjectSidebar`'s `EditProjectForm` pattern), a "move to project" select,
 * and a delete action backed by the shared `ConfirmDialog`. Every mutation here is pessimistic:
 * on success it invalidates the project's task list so `TaskList` refetches from the server; on
 * failure it reports the error up via `onError` so `TaskList` can show the shared `Toast` while
 * leaving the list exactly as it was before the attempt.
 */
export function TaskItem({ task, otherProjects, onError, isDraggable }: TaskItemProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function invalidateTasks() {
    queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
  }

  const toggleCompleteMutation = useMutation({
    mutationFn: () => (task.isComplete ? uncompleteTask(task.id) : completeTask(task.id)),
    onSuccess: () => {
      invalidateTasks();
    },
    onError: (error: unknown) => {
      onError(
        extractErrorMessage(
          error,
          task.isComplete ? 'Failed to reopen task.' : 'Failed to complete task.',
        ),
      );
    },
  });

  const moveMutation = useMutation({
    mutationFn: (targetProjectId: number) => moveTask(task.id, { targetProjectId }),
    onSuccess: (_movedTask, targetProjectId) => {
      invalidateTasks();
      // Also refresh the destination project's list. Without this, if the user has already
      // viewed that project, its cached list still omits the moved task until something else
      // invalidates it -- so switching to it would briefly show the task missing.
      queryClient.invalidateQueries({ queryKey: ['tasks', targetProjectId] });
    },
    onError: (error: unknown) => {
      onError(extractErrorMessage(error, 'Failed to move task.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      invalidateTasks();
      setIsConfirmingDelete(false);
    },
    onError: (error: unknown) => {
      onError(extractErrorMessage(error, 'Failed to delete task.'));
      setIsConfirmingDelete(false);
    },
  });

  function handleMoveChange(event: ChangeEvent<HTMLSelectElement>) {
    const targetProjectId = Number(event.target.value);
    if (!Number.isNaN(targetProjectId)) {
      moveMutation.mutate(targetProjectId);
    }
  }

  if (isEditing) {
    return (
      <li ref={setNodeRef} style={style} className="task-item">
        <EditTaskForm task={task} onDone={() => setIsEditing(false)} onError={onError} />
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        isDragging ? 'task-item task-item--dragging' : 'task-item'
      }
    >
      {isDraggable && (
        <button
          type="button"
          className="task-item__drag-handle"
          aria-label={`Reorder ${task.title}`}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      )}
      <input
        type="checkbox"
        className="task-item__checkbox"
        checked={task.isComplete}
        onChange={() => toggleCompleteMutation.mutate()}
        disabled={toggleCompleteMutation.isPending}
        aria-label={task.isComplete ? `Mark "${task.title}" incomplete` : `Mark "${task.title}" complete`}
      />
      <div className="task-item__body">
        <p
          className={
            task.isComplete
              ? 'task-item__title task-item__title--complete'
              : 'task-item__title'
          }
        >
          {task.title}
        </p>
        {task.description && (
          <p
            className={
              task.isComplete
                ? 'task-item__description task-item__description--complete'
                : 'task-item__description'
            }
          >
            {task.description}
          </p>
        )}
      </div>
      <select
        className="task-item__move"
        aria-label={`Move ${task.title} to project`}
        value=""
        onChange={handleMoveChange}
        disabled={moveMutation.isPending}
      >
        <option value="" disabled>
          Move to…
        </option>
        {otherProjects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <button type="button" className="task-item__action" onClick={() => setIsEditing(true)}>
        Edit
      </button>
      <button
        type="button"
        className="task-item__action task-item__action--danger"
        onClick={() => setIsConfirmingDelete(true)}
      >
        Delete
      </button>

      {isConfirmingDelete && (
        <ConfirmDialog
          title={`Delete "${task.title}"?`}
          message="This will permanently delete this task. This cannot be undone."
          confirmLabel="Delete"
          isConfirming={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setIsConfirmingDelete(false)}
        />
      )}
    </li>
  );
}

interface EditTaskFormProps {
  task: TaskResponse;
  onDone: () => void;
  onError: (message: string) => void;
}

/** Inline edit form (title + description) shown in place of the task row while editing, mirroring
 * `ProjectSidebar`'s `EditProjectForm`. Validation failures (an `ApiError` carrying a non-empty
 * `problem.errors` map) render inline in this form, next to the fields they describe, rather than
 * routed through `onError`/`Toast` -- mirroring `EditProjectForm`'s existing inline-error pattern.
 * Any other failure (network error, 500, or an `ApiError` with no `errors` map) still goes through
 * `onError` so `TaskList` can show it in the shared `Toast`, exactly as before. */
function EditTaskForm({ task, onDone, onError }: EditTaskFormProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      updateTask(task.id, {
        title,
        ...(description.trim() ? { description } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
      onDone();
    },
    onError: (error: unknown) => {
      const isValidationError = error instanceof ApiError && !!error.problem?.errors;
      if (!isValidationError) {
        onError(extractErrorMessage(error, 'Failed to update task.'));
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  const inlineErrorMessage =
    mutation.error instanceof ApiError && mutation.error.problem?.errors
      ? Object.values(mutation.error.problem.errors).flat().join(' ')
      : null;

  return (
    <form className="edit-task-form" onSubmit={handleSubmit} aria-label={`Edit ${task.title}`}>
      <label className="edit-task-form__field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <label className="edit-task-form__field">
        <span>Description</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
      </label>
      {inlineErrorMessage && <p className="edit-task-form__error">{inlineErrorMessage}</p>}
      <div className="edit-task-form__actions">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onDone}
          disabled={mutation.isPending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={mutation.isPending || title.trim().length === 0}
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
