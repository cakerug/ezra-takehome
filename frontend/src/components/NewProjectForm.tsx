import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import { ConfirmDialog } from './ConfirmDialog';

interface NewProjectFormProps {
  /** Called after the project is successfully created, e.g. so the caller can close its dialog. */
  onCreated?: () => void;
  onCancel?: () => void;
}

/**
 * "New project" form (name only). Posts via a React Query mutation; on success, invalidates the
 * `['projects']` query so `ProjectSidebar` refetches from the server -- per the plan's
 * pessimistic-update rule, the new project only appears once the server has confirmed it, not
 * optimistically.
 *
 * Rendered inline in the sidebar (mirrors `NewTaskForm`): it autofocuses its name field on open and
 * Escape closes it, prompting via the shared `ConfirmDialog` when there is unsaved content to lose.
 *
 * Field-validation failures render inline below; any other failure surfaces in the app-level
 * toast (via `showErrorToast`).
 */
export function NewProjectForm({ onCreated, onCancel }: NewProjectFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus the name on open so the user can start typing immediately.
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const isDirty = name.trim().length > 0;

  // Escape hides the form immediately when it's empty (same as Cancel), but -- unlike Cancel, which
  // intentionally stays a no-confirmation discard -- prompts via the shared ConfirmDialog when
  // there's content to lose. Mirrors NewTaskForm's Escape/isDirty pattern.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      if (isDirty) {
        setIsConfirmingDiscard(true);
      } else {
        onCancel?.();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, onCancel]);

  function handleDiscard() {
    setIsConfirmingDiscard(false);
    setName('');
    onCancel?.();
  }

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
        <input
          ref={nameInputRef}
          type="text"
          placeholder="Project Name"
          aria-label="Project Name"
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

      {isConfirmingDiscard && (
        <ConfirmDialog
          title="Discard new project?"
          message="You have unsaved changes. Closing now will discard them."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={handleDiscard}
          onCancel={() => setIsConfirmingDiscard(false)}
        />
      )}
    </form>
  );
}
