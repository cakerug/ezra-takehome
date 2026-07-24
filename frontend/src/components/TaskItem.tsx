import { useState } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { deleteTask, patchTask } from '../api/client';
import { toToastMessage } from '../api/errors';
import { showErrorToast, showSuccessToast } from '../toastBus';
import type { ProjectResponse, TaskResponse } from '../api/generated-schemas';
import { ActionMenu, type ActionMenuEntry } from './ActionMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { TaskDetailDialog } from './TaskDetailDialog';

/** Floating visual clone rendered inside `TaskList`'s `DragOverlay` while a task is being dragged
 * -- it tracks the pointer directly instead of the reorder-relative transform `useSortable`
 * applies to the in-place row, so the dragged task visually follows the cursor and only snaps to
 * its new slot on drop. Presentational only: no hooks, no mutations, no interactive controls. */
export function TaskItemOverlay({ task }: { task: TaskResponse }) {
  return (
    <li className="task-item task-item--overlay">
      <span className="task-item__drag-handle" aria-hidden="true">
        ⠿
      </span>
      <input type="checkbox" className="task-item__checkbox" checked={task.isComplete} readOnly />
      <div className="task-item__body">
        <p className="task-item__title">{task.title}</p>
        {task.description && <p className="task-item__description">{task.description}</p>}
      </div>
    </li>
  );
}

interface TaskItemProps {
  task: TaskResponse;
  /** All projects other than the task's own, for the "move to project" dropdown. */
  otherProjects: ProjectResponse[];
  /** Only incomplete tasks participate in drag-to-reorder; completed ones render without drag
   * behavior since they're pinned to the bottom regardless of order. */
  isDraggable: boolean;
  /** Collapses this row via the native `hidden` attribute (used for folded-away completed tasks)
   * rather than skipping its render entirely, so the row -- and any dialog state it owns -- stays
   * mounted while the "completed" group is collapsed. */
  hidden?: boolean;
}

/**
 * A single task row: the whole row is the *pointer* drag surface (a small movement threshold in
 * `TaskList`'s `PointerSensor` lets plain clicks on nested controls still register normally --
 * only a deliberate drag is treated as a reorder), while *keyboard* dragging stays scoped to the
 * small handle button (see the note above `useSortable` in this file for why). Also renders a
 * complete/uncomplete checkbox, a clickable body that opens the task's detail view
 * (`TaskDetailDialog`, where title/description are edited), and an overflow "…" menu holding
 * "Move to <project>" + Delete (delete backed by the shared `ConfirmDialog`). The drag handle and
 * "…" menu stay hidden until the row is hovered/focused (see `index.css`) to keep the list
 * uncluttered. Every mutation here is pessimistic: on success it invalidates the project's task
 * list so `TaskList` refetches from the server; on failure the list is left exactly as it was.
 * Failures surface in the app-level toast (via `showErrorToast`); the delete dialog additionally
 * stays open so the user can retry in place.
 */
export function TaskItem({ task, otherProjects, isDraggable, hidden }: TaskItemProps) {
  const queryClient = useQueryClient();
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: !isDraggable,
  });

  // While dragging, the in-place row becomes a placeholder for the slot being vacated -- the
  // floating `TaskItemOverlay` (rendered by `TaskList`'s `DragOverlay`) is what follows the
  // cursor, so this row only needs `useSortable`'s reorder-relative transform to animate the
  // other rows sliding out of the way, not to track the pointer itself.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function invalidateTasks() {
    queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
  }

  const toggleCompleteMutation = useMutation({
    mutationFn: () => patchTask(task.id, { isComplete: !task.isComplete }),
    onSuccess: (updatedTask) => {
      invalidateTasks();
      // Only on completing, not uncompleting -- there's no "Save" button on this row for the
      // toast to otherwise stand in for, so it confirms the toggle took effect on the server.
      if (updatedTask.isComplete) {
        showSuccessToast(`"${updatedTask.title}" marked complete`);
      }
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  const moveMutation = useMutation({
    mutationFn: (targetProjectId: number) => patchTask(task.id, { projectId: targetProjectId }),
    onSuccess: (_movedTask, targetProjectId) => {
      invalidateTasks();
      // Also refresh the destination project's list. Without this, if the user has already
      // viewed that project, its cached list still omits the moved task until something else
      // invalidates it -- so switching to it would briefly show the task missing.
      // Note: having to remember to do two invalidations here wouldn't really be solved by
      // Apollo/GraphQL either -- it has the same issue with collection membership. It would
      // only help if there were per-task cache entries elsewhere referencing this task.
      queryClient.invalidateQueries({ queryKey: ['tasks', targetProjectId] });
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  // On failure the dialog stays open (we don't clear isConfirmingDelete) so the user can retry in
  // place; the error itself is surfaced in the app-level toast.
  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      invalidateTasks();
      setIsConfirmingDelete(false);
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  // "Move to project", edit, and delete all live in the row's "…" menu. Edit (which opens the same
  // detail dialog as clicking the row body) sits just above Delete at the bottom. The move targets
  // are only included when there's somewhere to move to (i.e. more than one project exists).
  const menuItems: ActionMenuEntry[] = [
    ...(otherProjects.length > 0
      ? [
        { heading: 'Move to' } as const,
        ...otherProjects.map((project) => ({
          label: project.name,
          onSelect: () => moveMutation.mutate(project.id),
        })),
        { separator: true } as const,
      ]
      : []),
    { label: 'Edit', onSelect: () => setIsDetailOpen(true) },
    { separator: true } as const,
    { label: 'Delete', danger: true, onSelect: () => setIsConfirmingDelete(true) },
  ];

  const rowClassName = [
    'task-item',
    isDragging && 'task-item--dragging',
    isDraggable && 'task-item--draggable',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={rowClassName}
      hidden={hidden}
      {...listeners}
    >
      <button
        type="button"
        className="task-item__drag-handle"
        aria-label={`Reorder ${task.title}`}
        ref={setActivatorNodeRef}
        // Rendered even for non-draggable (completed) rows so the row layout stays stable, but
        // inert there: disabled and hidden from the accessibility tree / tab order.
        disabled={!isDraggable}
        aria-hidden={!isDraggable}
        {...(isDraggable ? attributes : {})}
      >
        ⠿
      </button>
      <input
        type="checkbox"
        className="task-item__checkbox"
        checked={task.isComplete}
        onChange={() => toggleCompleteMutation.mutate()}
        disabled={toggleCompleteMutation.isPending}
        aria-label={task.isComplete ? `Mark "${task.title}" incomplete` : `Mark "${task.title}" complete`}
      />
      <button
        type="button"
        className="task-item__body"
        onClick={() => setIsDetailOpen(true)}
        aria-label={`View "${task.title}"`}
      >
        <span
          className={
            task.isComplete
              ? 'task-item__title task-item__title--complete'
              : 'task-item__title'
          }
        >
          {task.title}
        </span>
        {task.description && (
          <span
            className={
              task.isComplete
                ? 'task-item__description task-item__description--complete'
                : 'task-item__description'
            }
          >
            {task.description}
          </span>
        )}
      </button>
      <ActionMenu
        className="task-item__menu"
        buttonLabel={`More actions for "${task.title}"`}
        items={menuItems}
      />

      {isDetailOpen && (
        <TaskDetailDialog
          task={task}
          otherProjects={otherProjects}
          onClose={() => setIsDetailOpen(false)}
        />
      )}

      {isConfirmingDelete && (
        <ConfirmDialog
          title={`Delete "${task.title}"?`}
          message="This will permanently delete this task. This cannot be undone."
          confirmLabel="Delete"
          isConfirming={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setIsConfirmingDelete(false)}
        />
      )}
    </li>
  );
}
