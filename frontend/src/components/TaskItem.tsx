import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { completeTask, deleteTask, moveTask, uncompleteTask, updateTask } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import type { ProjectResponse, TaskResponse } from '../api/generated-schemas';
import { ConfirmDialog } from './ConfirmDialog';

interface TaskItemProps {
  task: TaskResponse;
  /** All projects other than the task's own, for the "move to project" dropdown. */
  otherProjects: ProjectResponse[];
  /** Only incomplete tasks participate in drag-to-reorder; completed ones render without a
   * drag handle since they're pinned to the bottom regardless of order. */
  isDraggable: boolean;
}

/**
 * A single task row: drag handle (via `useSortable`), complete/uncomplete checkbox, inline
 * edit form (mirrors `ProjectSidebar`'s `EditProjectForm` pattern), a "move to project" select,
 * and a delete action backed by the shared `ConfirmDialog`. Every mutation here is pessimistic:
 * on success it invalidates the project's task list so `TaskList` refetches from the server; on
 * failure the list is left exactly as it was. Failures surface in the app-level toast (via
 * `showErrorToast`); the delete dialog additionally stays open so the user can retry in place.
 */
export function TaskItem({ task, otherProjects, isDraggable }: TaskItemProps) {
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
      showErrorToast(toToastMessage(error));
    },
  });

  const moveMutation = useMutation({
    mutationFn: (targetProjectId: number) => moveTask(task.id, { targetProjectId }),
    onSuccess: (_movedTask, targetProjectId) => {
      invalidateTasks();
      // Also refresh the destination project's list. Without this, if the user has already
      // viewed that project, its cached list still omits the moved task until something else
      // invalidates it -- so switching to it would briefly show the task missing.
      // Note: having to remember to do two invalidations here wouldn't really be solved by
      // Apollo/GraphQL either -- it has the same issue with collection membership. It would
      // only help if there were per-task cache entries elsewhere referencing this task.
      queryClient.invalidateQueries({ queryKey: ['tasks', targetProjectId] });
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  // On failure the dialog stays open (we don't clear isConfirmingDelete) so the user can retry in
  // place; the error itself is surfaced in the app-level toast.
  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      invalidateTasks();
      setIsConfirmingDelete(false);
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
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
        <EditTaskForm task={task} onDone={() => setIsEditing(false)} />
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
}

/** Inline edit form (title + description) shown in place of the task row while editing, mirroring
 * `ProjectSidebar`'s `EditProjectForm`. Field-validation failures render inline in this form, next
 * to the fields they describe; any other failure (500, connectivity) surfaces in the app-level
 * toast (via `showErrorToast`). */
function EditTaskForm({ task, onDone }: EditTaskFormProps) {
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
      if (!extractFieldErrors(error)) {
        showErrorToast(toToastMessage(error));
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  const inlineErrorMessage = extractFieldErrors(mutation.error);

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
