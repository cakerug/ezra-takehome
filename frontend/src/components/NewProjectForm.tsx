import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';

/**
 * "New project" form (name + description). Posts via a React Query mutation; on success,
 * invalidates the `['projects']` query so `ProjectSidebar` refetches from the server -- per the
 * plan's pessimistic-update rule, the new project only appears once the server has confirmed it,
 * not optimistically.
 *
 * Field-validation failures render inline below; any other failure surfaces in the app-level
 * toast (via `showErrorToast`).
 */
export function NewProjectForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createProject({
        name,
        ...(description.trim() ? { description } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setName('');
      setDescription('');
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

  const errorMessage = extractFieldErrors(mutation.error);

  return (
    <form className="new-project-form" onSubmit={handleSubmit}>
      <h3 className="new-project-form__heading">New project</h3>
      <label className="new-project-form__field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label className="new-project-form__field">
        <span>Description</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
      </label>
      {errorMessage && <p className="new-project-form__error">{errorMessage}</p>}
      <button
        type="submit"
        className="btn btn--primary"
        disabled={mutation.isPending || name.trim().length === 0}
      >
        {mutation.isPending ? 'Creating…' : 'Add project'}
      </button>
    </form>
  );
}
