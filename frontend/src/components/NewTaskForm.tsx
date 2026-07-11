import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';

interface NewTaskFormProps {
  projectId: number;
  /** Called after the task is successfully created. The form stays mounted (it clears its fields
   * and refocuses the title) so the caller can leave it open for rapid entry of several tasks. */
  onCreated?: () => void;
  onCancel?: () => void;
}

/**
 * "New task" form (title + description) for the currently selected project. Mirrors
 * `NewProjectForm`'s shape: posts via a React Query mutation and, on success, invalidates the
 * project's task list query so `TaskList` refetches from the server -- per the plan's
 * pessimistic-update rule, the new task only appears once the server has confirmed it.
 *
 * Field-validation failures (`ApiError` with a `problem.errors` map) render inline in this form,
 * next to the fields they describe -- a "title too long" message belongs next to the title field.
 * Any other failure (network error, 500) surfaces in the app-level toast (via `showErrorToast`).
 */
export function NewTaskForm({ projectId, onCreated, onCancel }: NewTaskFormProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Focus the title on open so the user can start typing immediately -- and, since the form stays
  // open after a successful create, this keeps focus ready for the next task in a rapid-entry run.
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const mutation = useMutation({
    mutationFn: () =>
      createTask(projectId, {
        title,
        ...(description.trim() ? { description } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
      setTitle('');
      setDescription('');
      titleInputRef.current?.focus();
      onCreated?.();
    },
    onError: (error: unknown) => {
      // Field-validation errors render inline (below); anything else goes to the app-level toast.
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
    <form className="new-task-form" onSubmit={handleSubmit}>
      <label className="new-task-form__field">
        <span>Title</span>
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <label className="new-task-form__field">
        <span>Description</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
      </label>
      {inlineErrorMessage && <p className="new-task-form__error">{inlineErrorMessage}</p>}
      <div className="new-task-form__actions">
        {onCancel && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onCancel}
            disabled={mutation.isPending}
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          className="btn btn--primary"
          disabled={mutation.isPending || title.trim().length === 0}
        >
          {mutation.isPending ? 'Adding…' : 'Add task'}
        </button>
      </div>
    </form>
  );
}
