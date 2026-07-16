import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
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
    // While dragging, the in-place row is just the faded placeholder for the vacated slot -- the
    // floating `ProjectRowOverlay` (rendered by the `DragOverlay`) is what follows the cursor.
    isDragging && 'project-sidebar__item--dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li ref={setNodeRef} style={style} className="project-sidebar__row">
      {/* Purely a visual affordance shown on row hover -- the whole row is already the drag surface
          (pointer + keyboard, via the button below), so this is hidden from assistive tech and sits
          in the sidebar padding, outside the row's hover/selected background. */}
      <span className="project-sidebar__drag-handle" aria-hidden="true">
        ⠿
      </span>
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

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);

  // A project row is both the pointer drag surface and a click-to-select button, so on release the
  // browser fires a native `click` on the just-dragged row -- which would otherwise select it even
  // though the user only meant to reorder. dnd-kit's `onDragStart` fires only once a real drag
  // begins (the 8px `PointerSensor` threshold, never a plain click), so we raise a flag there and
  // have the select handler ignore the trailing click. The flag is cleared on the next tick (after
  // that click has been dispatched) in both drag-end and drag-cancel, so it can never wedge and
  // swallow a later genuine click if a drag happens to produce no trailing click.
  const justDraggedRef = useRef(false);

  function handleDragStart(event: DragStartEvent) {
    justDraggedRef.current = true;
    setActiveId(Number(event.active.id));
  }

  function clearJustDraggedSoon() {
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
  }

  function handleDragCancel() {
    setActiveId(null);
    clearJustDraggedSoon();
  }

  function handleSelectProject(projectId: SelectedProjectId) {
    if (justDraggedRef.current) {
      return;
    }
    onSelectProject(projectId);
  }

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
    // Let the just-dragged row's trailing `click` be ignored, then clear the flag next tick.
    clearJustDraggedSoon();
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

    const orderedIds = arrayMove(projects, oldIndex, newIndex).map((project) => project.id);
    reorderMutation.mutate(orderedIds);
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
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
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
