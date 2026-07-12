import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';

interface NewProjectFormProps {
  /** Called after the project is successfully created, e.g. so the caller can close its dialog. */
  onCreated?: () => void;
  onCancel?: () => void;
}

/**
 * "New project" form (name only -- description isn't collected at creation time; it can still be
 * set later via `EditProjectForm`). Posts via a React Query mutation; on success, invalidates the
 * `['projects']` query so `ProjectSidebar` refetches from the server -- per the plan's
 * pessimistic-update rule, the new project only appears once the server has confirmed it, not
 * optimistically.
 *
 * Field-validation failures render inline below; any other failure surfaces in the app-level
 * toast (via `showErrorToast`).
 */
export function NewProjectForm({ onCreated, onCancel }: NewProjectFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => createProject({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setName('');
      onCreated?.();
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
      <label className="new-project-form__field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      {errorMessage && <p className="new-project-form__error">{errorMessage}</p>}
      <div className="new-project-form__actions">
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
          disabled={mutation.isPending || name.trim().length === 0}
        >
          {mutation.isPending ? 'Creating…' : 'Add project'}
        </button>
      </div>
    </form>
  );
}
