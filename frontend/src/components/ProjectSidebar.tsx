import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { deleteProject, listProjects, reorderProjects, updateProject } from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import type { ProjectResponse } from '../api/generated-schemas';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { NewProjectForm } from './NewProjectForm';

/** `null` means no project is currently selected. There is no longer a special "default" project:
 * every project (including the seeded "Inbox") is returned from `/api/projects` like any other, so
 * selecting one just selects that project's id. */
export type SelectedProjectId = number | null;

interface ProjectSidebarProps {
  selectedProjectId: SelectedProjectId;
  onSelectProject: (projectId: SelectedProjectId) => void;
}

interface ProjectRowProps {
  project: ProjectResponse;
  isSelected: boolean;
  onSelect: () => void;
}

/** A single draggable sidebar row. The whole row is both the click target (selects the project)
 * and the pointer drag surface; a small movement threshold on the `PointerSensor` (see
 * `ProjectSidebar`) lets a plain click still select while a deliberate drag reorders. Keyboard
 * dragging is activated from the same button via `useSortable`'s attributes/listeners. Mirrors
 * `TaskItem`'s sortable pattern, minus the separate drag handle (the row has no nested inputs to
 * protect from a row-wide keyboard listener). */
function ProjectRow({ project, isSelected, onSelect }: ProjectRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const className = [
    'project-sidebar__item',
    isSelected && 'project-sidebar__item--selected',
    isDragging && 'project-sidebar__item--dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li ref={setNodeRef} style={style}>
      <button
        type="button"
        className={className}
        onClick={onSelect}
        aria-current={isSelected ? 'true' : undefined}
        {...attributes}
        {...listeners}
      >
        {project.name}
      </button>
    </li>
  );
}

/**
 * Project list sidebar with drag-to-reorder. Reordering is pessimistic (mirrors `TaskList`): on
 * drop it sends the full reordered id list to `reorderProjects` and adopts the order only from the
 * server's authoritative response (written into the `['projects']` cache on success). If the
 * mutation fails, the cache is untouched so the list reverts to its last-known-good order, and the
 * failure is surfaced by the app-level toast.
 */
export function ProjectSidebar({ selectedProjectId, onSelectProject }: ProjectSidebarProps) {
  const queryClient = useQueryClient();

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const sensors = useSensors(
    // The whole row is the drag surface and is also a click-to-select button, so a small movement
    // threshold lets a plain click still select -- only a deliberate drag (pointer moves ≥8px
    // before release) is treated as a reorder. Matches `TaskList`'s sensor config.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderMutation = useMutation({
    mutationFn: (orderedProjectIds: number[]) => reorderProjects({ orderedProjectIds }),
    onSuccess: (updatedProjects) => {
      // Write the server-confirmed order straight into the cache instead of invalidating, to keep
      // it fully pessimistic while avoiding an extra refetch round trip (during which the list
      // would briefly snap back to the pre-drag order and read as a failed drag).
      queryClient.setQueryData(['projects'], updatedProjects);
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!projects || !over || active.id === over.id) {
      return;
    }

    const oldIndex = projects.findIndex((project) => project.id === active.id);
    const newIndex = projects.findIndex((project) => project.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const orderedIds = arrayMove(projects, oldIndex, newIndex).map((project) => project.id);
    reorderMutation.mutate(orderedIds);
  }

  return (
    <nav aria-label="Projects" className="project-sidebar">
      <h2 className="project-sidebar__heading">Projects</h2>

      {isLoading && <p className="project-sidebar__status">Loading projects…</p>}

      {projects && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={projects.map((project) => project.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="project-sidebar__list">
              {/* Rows are select + drag-to-reorder; all project actions (edit + delete) live in
                  the content-area header's "…" menu, not here. */}
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  isSelected={project.id === selectedProjectId}
                  onSelect={() => onSelectProject(project.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
