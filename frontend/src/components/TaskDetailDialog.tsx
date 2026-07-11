import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { completeTask, uncompleteTask, updateTask } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import type { TaskResponse } from '../api/generated-schemas';
import { Dialog } from './Dialog';

interface TaskDetailDialogProps {
  task: TaskResponse;
  onClose: () => void;
}

/**
 * The popup "view" opened by clicking a task row. Replaces the old inline Edit form: title and
 * description are shown as plain text and become an input only when clicked (see `EditableField`),
 * saving on blur. Field-validation failures render inline; anything else surfaces in the app-level
 * toast, matching the rest of the app.
 *
 * A single `updateTask` mutation backs both fields. Because `updateTask` replaces the whole task,
 * each save sends the current title *and* description together -- so we hold both locally and keep
 * them in sync as saves land, seeding from the (possibly refetched) `task` on each render is not
 * done deliberately: the dialog owns the edit buffer for its lifetime.
 *
 * Complete/uncomplete is a separate, un-buffered mutation (mirroring `TaskItem`'s own checkbox):
 * it reads/writes `task.isComplete` directly rather than through the local edit buffer, since it's
 * an immediate toggle, not a draft the user composes.
 */
export function TaskDetailDialog({ task, onClose }: TaskDetailDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');

  function invalidateTasks() {
    queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
  }

  const mutation = useMutation({
    mutationFn: (next: { title: string; description: string }) =>
      updateTask(task.id, {
        title: next.title,
        ...(next.description.trim() ? { description: next.description } : {}),
      }),
    onSuccess: invalidateTasks,
    onError: (error: unknown) => {
      if (!extractFieldErrors(error)) {
        showErrorToast(toToastMessage(error));
      }
    },
  });

  const toggleCompleteMutation = useMutation({
    mutationFn: () => (task.isComplete ? uncompleteTask(task.id) : completeTask(task.id)),
    onSuccess: invalidateTasks,
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  function saveTitle(next: string) {
    const trimmed = next.trim();
    // Title is required; ignore an empty or unchanged value and keep the last good title.
    if (!trimmed || trimmed === title) {
      setTitle(title);
      return;
    }
    setTitle(trimmed);
    mutation.mutate({ title: trimmed, description });
  }

  function saveDescription(next: string) {
    if (next === description) {
      return;
    }
    setDescription(next);
    mutation.mutate({ title, description: next });
  }

  const inlineError = extractFieldErrors(mutation.error);

  return (
    <Dialog ariaLabel={`Task: ${title}`} onClose={onClose}>
      <div className="task-detail">
        <div className="task-detail__header">
          <input
            type="checkbox"
            className="task-detail__checkbox"
            checked={task.isComplete}
            onChange={() => toggleCompleteMutation.mutate()}
            disabled={toggleCompleteMutation.isPending}
            aria-label={task.isComplete ? `Mark "${title}" incomplete` : `Mark "${title}" complete`}
          />
          <EditableField
            value={title}
            onSave={saveTitle}
            ariaLabel="Task title"
            className={
              task.isComplete
                ? 'task-detail__title task-detail__title--complete'
                : 'task-detail__title'
            }
          />
        </div>
        <EditableField
          value={description}
          onSave={saveDescription}
          ariaLabel="Task description"
          className={
            // Only strike through actual content, not the "Add a description…" placeholder prompt.
            task.isComplete && description.trim()
              ? 'task-detail__description task-detail__description--complete'
              : 'task-detail__description'
          }
          multiline
          placeholder="Add a description…"
        />
        {inlineError && <p className="task-detail__error">{inlineError}</p>}
        <div className="task-detail__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface EditableFieldProps {
  value: string;
  onSave: (next: string) => void;
  ariaLabel: string;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
}

/** Click-to-edit text: renders `value` as a button that looks like text; clicking (or Enter/Space)
 * swaps in an input/textarea seeded with the value. Blur commits via `onSave`; Escape cancels;
 * Enter commits for the single-line variant (Shift+Enter still adds a newline in the textarea). */
function EditableField({
  value,
  onSave,
  ariaLabel,
  className,
  multiline,
  placeholder,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function startEditing() {
    setDraft(value);
    setIsEditing(true);
  }

  function commit() {
    setIsEditing(false);
    onSave(draft);
  }

  function cancel() {
    setIsEditing(false);
    setDraft(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter' && !multiline) {
      event.preventDefault();
      commit();
    }
  }

  if (isEditing) {
    const editClass = className
      ? `editable-field__input ${className}`
      : 'editable-field__input';
    return multiline ? (
      <textarea
        className={editClass}
        aria-label={ariaLabel}
        autoFocus
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    ) : (
      <input
        type="text"
        className={editClass}
        aria-label={ariaLabel}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  const displayClass = className
    ? `editable-field__display ${className}`
    : 'editable-field__display';
  const isEmpty = value.trim().length === 0;
  return (
    <button
      type="button"
      className={isEmpty ? `${displayClass} editable-field__display--empty` : displayClass}
      aria-label={`Edit ${ariaLabel}`}
      onClick={startEditing}
    >
      {isEmpty ? placeholder : value}
    </button>
  );
}
