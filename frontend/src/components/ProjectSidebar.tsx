import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteProject, extractErrorMessage, listProjects, updateProject } from '../api/client';
import type { ProjectResponse } from '../api/types';
import { ConfirmDialog } from './ConfirmDialog';
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
  const {
    data: projects,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<ProjectResponse | null>(null);

  return (
    <nav aria-label="Projects" className="project-sidebar">
      <h2 className="project-sidebar__heading">Projects</h2>

      {isLoading && <p className="project-sidebar__status">Loading projects…</p>}
      {isError && (
        <p className="project-sidebar__status project-sidebar__status--error">
          Failed to load projects{error instanceof Error ? `: ${error.message}` : ''}
        </p>
      )}

      {projects && (
        <ul className="project-sidebar__list">
          {projects.map((project) =>
            editingProjectId === project.id ? (
              <li key={project.id}>
                <EditProjectForm project={project} onDone={() => setEditingProjectId(null)} />
              </li>
            ) : (
              <li key={project.id} className="project-sidebar__row">
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
                <div className="project-sidebar__actions">
                  <button
                    type="button"
                    className="project-sidebar__action"
                    aria-label={`Edit ${project.name}`}
                    onClick={() => setEditingProjectId(project.id)}
                  >
                    Edit
                  </button>
                  {!project.isDefault && (
                    <button
                      type="button"
                      className="project-sidebar__action project-sidebar__action--danger"
                      aria-label={`Delete ${project.name}`}
                      onClick={() => setPendingDeleteProject(project)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <NewProjectForm />

      {pendingDeleteProject && (
        <DeleteProjectDialog
          project={pendingDeleteProject}
          onClose={() => setPendingDeleteProject(null)}
        />
      )}
    </nav>
  );
}

interface EditProjectFormProps {
  project: ProjectResponse;
  onDone: () => void;
}

/** Small inline form (name + description) shown in place of the sidebar row while editing.
 * Chosen over a modal/separate form to keep editing lightweight and in-context; the plan leaves
 * this choice to the implementer. */
function EditProjectForm({ project, onDone }: EditProjectFormProps) {
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
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  const errorMessage = mutation.error
    ? extractErrorMessage(mutation.error, 'Failed to update project.')
    : null;

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

/** Confirmation dialog + delete mutation for a single project. Deliberately does not fetch the
 * project's task count for the confirmation message -- `listTasks` would add another
 * loading/error state to coordinate with the dialog's own pending state for comparatively little
 * value in this unit, so the message just names the project and states that its tasks will also
 * be removed. */
function DeleteProjectDialog({ project, onClose }: DeleteProjectDialogProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });

  const errorMessage = mutation.error
    ? extractErrorMessage(mutation.error, 'Failed to delete project.')
    : null;

  return (
    <ConfirmDialog
      title={`Delete "${project.name}"?`}
      message={`This will permanently delete "${project.name}" and all of its tasks. This cannot be undone.`}
      confirmLabel="Delete"
      isConfirming={mutation.isPending}
      errorMessage={errorMessage}
      onConfirm={() => mutation.mutate()}
      onCancel={onClose}
    />
  );
}
