import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask } from '../api/client';
import { extractErrorMessage } from '../api/errors';

interface NewTaskFormProps {
  projectId: number;
  onError: (message: string) => void;
}

/**
 * "New task" form (title + description) for the currently selected project. Mirrors
 * `NewProjectForm`'s shape: posts via a React Query mutation and, on success, invalidates the
 * project's task list query so `TaskList` refetches from the server -- per the plan's
 * pessimistic-update rule, the new task only appears once the server has confirmed it.
 * On failure, reports the error message up via `onError` so `TaskList` can surface it in the
 * shared `Toast`, rather than rendering an inline error itself.
 */
export function NewTaskForm({ projectId, onError }: NewTaskFormProps) {
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
      onError(extractErrorMessage(error, 'Failed to create task.'));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

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
      <button type="submit" disabled={mutation.isPending || title.trim().length === 0}>
        {mutation.isPending ? 'Adding…' : 'Add task'}
      </button>
    </form>
  );
}
