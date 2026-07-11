import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';

interface NewTaskFormProps {
  projectId: number;
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
export function NewTaskForm({ projectId }: NewTaskFormProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

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
      <h3 className="new-task-form__heading">New task</h3>
      <label className="new-task-form__field">
        <span>Title</span>
        <input
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
      <button
        type="submit"
        className="btn btn--primary"
        disabled={mutation.isPending || title.trim().length === 0}
      >
        {mutation.isPending ? 'Adding…' : 'Add task'}
      </button>
    </form>
  );
}
