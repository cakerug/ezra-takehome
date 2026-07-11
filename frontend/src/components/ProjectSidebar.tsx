import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteProject, listProjects, updateProject } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import type { ProjectResponse } from '../api/generated-schemas';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { NewProjectForm } from './NewProjectForm';

/** `null` means no project is currently selected. The seeded default project (`isDefault: true`)
 * is named "Inbox" by the backend and returned from `/api/projects` like any other project, so
 * it needs no special-casing here -- selecting it just selects that project's id. */
export type SelectedProjectId = number | null;

interface ProjectSidebarProps {
  selectedProjectId: SelectedProjectId;
  onSelectProject: (projectId: SelectedProjectId) => void;
}

export function ProjectSidebar({ selectedProjectId, onSelectProject }: ProjectSidebarProps) {
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <nav aria-label="Projects" className="project-sidebar">
      <h2 className="project-sidebar__heading">Projects</h2>

      {isLoading && <p className="project-sidebar__status">Loading projects…</p>}

      {projects && (
        <ul className="project-sidebar__list">
          {/* Rows are select-only; all project actions (edit + delete) live in the content-area
              header's "…" menu, not here. */}
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className={
                  project.id === selectedProjectId
                    ? 'project-sidebar__item project-sidebar__item--selected'
                    : 'project-sidebar__item'
                }
                onClick={() => onSelectProject(project.id)}
                aria-current={project.id === selectedProjectId ? 'true' : undefined}
              >
                {project.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="btn btn--secondary project-sidebar__create-button"
        onClick={() => setIsCreateDialogOpen(true)}
      >
        + Create new project
      </button>

      {isCreateDialogOpen && (
        <Dialog title="New project" onClose={() => setIsCreateDialogOpen(false)}>
          <NewProjectForm
            onCreated={() => setIsCreateDialogOpen(false)}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </Dialog>
      )}
    </nav>
  );
}

interface EditProjectFormProps {
  project: ProjectResponse;
  onDone: () => void;
}

/** Name + description edit form. Opened from the content-area header's "…" menu (next to the
 * project title), rendered inside a `Dialog`. Field-validation failures render inline; any other
 * failure surfaces in the app-level toast (via `showErrorToast`). */
export function EditProjectForm({ project, onDone }: EditProjectFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');

  const mutation = useMutation({
    mutationFn: () =>
      updateProject(project.id, {
        name,
        ...(description.trim() ? { description } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
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

  const errorMessage = extractFieldErrors(mutation.error);

  return (
    <form
      className="edit-project-form"
      onSubmit={handleSubmit}
      aria-label={`Edit ${project.name}`}
    >
      <label className="edit-project-form__field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label className="edit-project-form__field">
        <span>Description</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
      </label>
      {errorMessage && <p className="edit-project-form__error">{errorMessage}</p>}
      <div className="edit-project-form__actions">
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
          disabled={mutation.isPending || name.trim().length === 0}
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

interface DeleteProjectDialogProps {
  project: ProjectResponse;
  onClose: () => void;
}

/** Confirmation dialog + delete mutation for a single project. Opened from the content-area
 * header's "…" menu. Deliberately does not fetch the project's task count for the confirmation
 * message -- `listTasks` would add another loading/error state to coordinate with the dialog's own
 * pending state for comparatively little value in this unit, so the message just names the project
 * and states that its tasks will also be removed.
 *
 * On failure the dialog stays open (we don't call `onClose`) so the user can retry in place; the
 * error is surfaced in the app-level toast (via `showErrorToast`). */
export function DeleteProjectDialog({ project, onClose }: DeleteProjectDialogProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  return (
    <ConfirmDialog
      title={`Delete "${project.name}"?`}
      message={`This will permanently delete "${project.name}" and all of its tasks. This cannot be undone.`}
      confirmLabel="Delete"
      isConfirming={mutation.isPending}
      onConfirm={() => mutation.mutate()}
      onCancel={onClose}
    />
  );
}
