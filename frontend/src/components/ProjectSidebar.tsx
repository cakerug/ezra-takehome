import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
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

/** Floating visual clone rendered inside `ProjectSidebar`'s `DragOverlay` while a project is being
 * dragged -- it tracks the pointer directly instead of the reorder-relative transform `useSortable`
 * applies to the in-place row, so the dragged project follows the cursor and only snaps to its new
 * slot on drop (mirrors `TaskItemOverlay`). Presentational only: no hooks, no selection/click
 * behavior. Keeps the selected styling so a selected project doesn't visually flip while lifted. */
export function ProjectRowOverlay({
  project,
  isSelected,
}: {
  project: ProjectResponse;
  isSelected: boolean;
}) {
  const className = [
    'project-sidebar__item',
    'project-sidebar__item--overlay',
    isSelected && 'project-sidebar__item--selected',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="project-sidebar__row project-sidebar__row--overlay">
      <span className="project-sidebar__drag-handle" aria-hidden="true">
        ⠿
      </span>
      <span className={className}>{project.name}</span>
    </div>
  );
}

/**
 * A single draggable sidebar row. Mirrors `TaskItem`'s drag pattern: the whole row is the
 * *pointer* drag surface (a small movement threshold in the parent's `PointerSensor` lets a
 * plain click on the select button still register normally), while *keyboard* dragging is
 * scoped to the small handle button via `setActivatorNodeRef` -- this prevents Space/Enter on
 * the select button from starting a keyboard drag instead of selecting.
 */
function ProjectRow({ project, isSelected, onSelect }: ProjectRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: project.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const className = [
    'project-sidebar__item',
    isSelected && 'project-sidebar__item--selected',
    // While dragging, the in-place row is just the faded placeholder for the vacated slot -- the
    // floating `ProjectRowOverlay` (rendered by the `DragOverlay`) is what follows the cursor.
    isDragging && 'project-sidebar__item--dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="project-sidebar__row"
      {...listeners}
    >
      <button
        type="button"
        className="project-sidebar__drag-handle"
        aria-label={`Reorder ${project.name}`}
        ref={setActivatorNodeRef}
        {...attributes}
      >
        ⠿
      </button>
      <button
        type="button"
        className={className}
        onClick={onSelect}
        aria-current={isSelected ? 'true' : undefined}
      >
        {project.name}
      </button>
    </li>
  );
}

/**
 * Project list sidebar with drag-to-reorder. Reordering is optimistic (mirrors `TaskList`): on drop
 * it writes the new order into the `['projects']` cache immediately (so the row stays where it was
 * dropped rather than flashing back to its old slot mid-request), then sends the full reordered id
 * list to `reorderProjects`. The server's response reconciles the cache on success; on failure the
 * cache is rolled back to its pre-drag order and the error is surfaced by the app-level toast.
 */
export function ProjectSidebar({ selectedProjectId, onSelectProject }: ProjectSidebarProps) {
  const queryClient = useQueryClient();

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(Number(event.active.id));
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  function handleSelectProject(projectId: SelectedProjectId) {
    onSelectProject(projectId);
  }

  const sensors = useSensors(
    // The 8px threshold prevents a stationary pointer click from being treated as a drag, letting
    // the select button's onClick fire normally on a plain click.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderMutation = useMutation({
    mutationFn: (orderedProjectIds: number[]) => reorderProjects({ orderedProjectIds }),
    onSuccess: (updatedProjects) => {
      // Reconcile the optimistic order with the server's authoritative response by writing it
      // straight into the cache instead of invalidating -- avoids an extra refetch round trip.
      queryClient.setQueryData(['projects'], updatedProjects);
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);

    const { active, over } = event;
    if (!projects || !over || active.id === over.id) {
      return;
    }

    const oldIndex = projects.findIndex((project) => project.id === active.id);
    const newIndex = projects.findIndex((project) => project.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Optimistically apply the new order to the cache now, synchronously, so it batches with the
    // `setActiveId(null)` above -- the row stays where it was dropped instead of flashing back to
    // its old slot until the server responds. Projects render in raw cache order (no `order`-field
    // sort, unlike tasks), so writing the reordered array is enough. `onSuccess` overwrites this
    // with the server's authoritative order; the per-drop `onError` rolls the cache back.
    const previous = projects;
    const reordered = arrayMove(projects, oldIndex, newIndex);
    queryClient.setQueryData(['projects'], reordered);
    reorderMutation.mutate(
      reordered.map((project) => project.id),
      { onError: () => queryClient.setQueryData(['projects'], previous) },
    );
  }

  const activeProject =
    activeId === null ? undefined : projects?.find((project) => project.id === activeId);

  return (
    <nav aria-label="Projects" className="project-sidebar">
      <h2 className="project-sidebar__heading">Projects</h2>

      {isLoading && <p className="project-sidebar__status">Loading projects…</p>}

      {projects && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
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
                  onSelect={() => handleSelectProject(project.id)}
                />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay>
            {activeProject && (
              <ProjectRowOverlay
                project={activeProject}
                isSelected={activeProject.id === selectedProjectId}
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {isCreatingProject ? (
        // Rendered inline in the sidebar (mirrors TaskList's inline NewTaskForm). Closes on
        // successful create or Cancel; the form itself handles Escape-to-discard.
        <NewProjectForm
          onCreated={() => setIsCreatingProject(false)}
          onCancel={() => setIsCreatingProject(false)}
        />
      ) : (
        <button
          type="button"
          className="btn btn--secondary project-sidebar__create-button"
          onClick={() => setIsCreatingProject(true)}
        >
          + Add project
        </button>
      )}
    </nav>
  );
}

interface EditProjectFormProps {
  project: ProjectResponse;
  onDone: () => void;
}

/** Name edit form. Opened from the content-area header's "…" menu (next to the project title),
 * rendered inside a `Dialog`. Field-validation failures render inline; any other failure surfaces
 * in the app-level toast (via `showErrorToast`). */
export function EditProjectForm({ project, onDone }: EditProjectFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);

  const mutation = useMutation({
    mutationFn: () => updateProject(project.id, { name }),
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

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
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
      <div className="edit-project-form__field">
        {/* This field renders no visible caption by design -- it's the dialog's only input, and
            it's pre-filled with the project's name. aria-label is what keeps it from reaching
            screen readers as an unnamed textbox. */}
        <input
          type="text"
          aria-label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>
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
