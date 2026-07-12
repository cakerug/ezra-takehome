import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  completeTask,
  deleteTask,
  moveTask,
  uncompleteTask,
  updateTask,
} from '../api/client';
import { extractFieldErrors, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import type { ProjectResponse, TaskResponse } from '../api/generated-schemas';
import { ActionMenu, type ActionMenuEntry } from './ActionMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';

interface TaskDetailDialogProps {
  task: TaskResponse;
  /** All projects other than the task's own, powering the "…" menu's "Move to" list. */
  otherProjects: ProjectResponse[];
  onClose: () => void;
}

/**
 * The popup "view" opened by clicking a task row. Title and description are edited through an
 * explicit editing buffer (not auto-save-on-blur): the two fields are seeded from the task and
 * committed together by a single "Save" button via the `updateTask` mutation. Because `updateTask`
 * replaces the whole task, both fields are always sent together.
 *
 * Closing while the buffer differs from the task (Close button, backdrop, or Escape) prompts a
 * discard confirmation; a clean buffer closes immediately. Field-validation failures render inline;
 * anything else surfaces in the app-level toast, matching the rest of the app.
 *
 * Completed tasks are locked for editing (mirroring the backend's 403 guard): the fields become
 * read-only and Save is hidden, but the complete/uncomplete checkbox still works so the user can
 * reopen the task and then edit it. Complete/uncomplete is a separate, un-buffered mutation.
 *
 * A top-right "…" `ActionMenu` surfaces the same secondary actions as the row's own overflow menu
 * -- move to another project and delete -- mirroring `TaskItem`'s menu construction exactly (move
 * does the dual-project invalidation; delete is gated by a `ConfirmDialog`) and closing the dialog
 * once they land. Unlike the row's menu, this one isn't gated by `isLocked`: move/delete stay
 * available even on a completed (locked) task, matching the old sidebar's behavior.
 */
export function TaskDetailDialog({ task, otherProjects, onClose }: TaskDetailDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const isLocked = task.isComplete;
  // Dirty when the buffer diverges from the task's current values. A locked (completed) task can't
  // be edited, so its buffer is never considered dirty -- closing it never prompts.
  const isDirty =
    !isLocked && (title !== task.title || description !== (task.description ?? ''));

  function invalidateTasks() {
    queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
  }

  const updateMutation = useMutation({
    mutationFn: (next: { title: string; description: string }) =>
      updateTask(task.id, {
        title: next.title,
        ...(next.description.trim() ? { description: next.description } : {}),
      }),
    onSuccess: invalidateTasks,
    onError: (error: unknown) => {
      if (!extractFieldErrors(error)) {
        showErrorToast(toToastMessage(error));
      }
    },
  });

  const toggleCompleteMutation = useMutation({
    mutationFn: () => (task.isComplete ? uncompleteTask(task.id) : completeTask(task.id)),
    onSuccess: invalidateTasks,
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  const moveMutation = useMutation({
    mutationFn: (targetProjectId: number) => moveTask(task.id, { targetProjectId }),
    onSuccess: (_movedTask, targetProjectId) => {
      invalidateTasks();
      // Also refresh the destination project's list so switching to it doesn't briefly show the
      // moved task missing (see the matching note in TaskItem).
      queryClient.invalidateQueries({ queryKey: ['tasks', targetProjectId] });
      onClose();
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  // On failure the confirm dialog stays open (we don't clear isConfirmingDelete) so the user can
  // retry in place; the error itself surfaces in the app-level toast.
  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      invalidateTasks();
      onClose();
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  function handleSave() {
    const trimmed = title.trim();
    // Title is required; an empty title can't be saved (the backend would reject it anyway).
    if (!trimmed) {
      return;
    }
    updateMutation.mutate({ title: trimmed, description });
  }

  // Guards every close path (Close button, backdrop, Escape): prompt before dropping unsaved edits.
  function requestClose() {
    if (isDirty) {
      setIsConfirmingDiscard(true);
      return;
    }
    onClose();
  }

  const inlineError = extractFieldErrors(updateMutation.error);

  // Move/delete now live in the top-right "…" menu, mirroring `TaskItem`'s menu construction.
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
    { label: 'Delete', danger: true, onSelect: () => setIsConfirmingDelete(true) },
  ];

  return (
    <Dialog ariaLabel={`Task: ${task.title}`} onClose={requestClose}>
      <div className="task-detail">
        <ActionMenu
          buttonLabel={`More actions for "${task.title}"`}
          items={menuItems}
          className="task-detail__menu"
        />
        <div className="task-detail__main">
          <div className="task-detail__header">
            <input
              type="checkbox"
              className="task-detail__checkbox"
              checked={task.isComplete}
              onChange={() => toggleCompleteMutation.mutate()}
              disabled={toggleCompleteMutation.isPending}
              aria-label={
                task.isComplete ? `Mark "${task.title}" incomplete` : `Mark "${task.title}" complete`
              }
            />
            <input
              type="text"
              className={
                task.isComplete
                  ? 'task-detail__title-input task-detail__title-input--complete'
                  : 'task-detail__title-input'
              }
              aria-label="Task title"
              value={title}
              readOnly={isLocked}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <textarea
            className={
              // Only strike through actual content, not an empty description.
              task.isComplete && description.trim()
                ? 'task-detail__description-input task-detail__description-input--complete'
                : 'task-detail__description-input'
            }
            aria-label="Task description"
            rows={3}
            value={description}
            readOnly={isLocked}
            placeholder="Add a description…"
            onChange={(event) => setDescription(event.target.value)}
          />
          {isLocked && (
            <p className="task-detail__hint">
              Completed tasks are locked. Mark it incomplete to edit.
            </p>
          )}
          {inlineError && <p className="task-detail__error">{inlineError}</p>}
          <div className="task-detail__actions">
            <button type="button" className="btn btn--secondary" onClick={requestClose}>
              Close
            </button>
            {!isLocked && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSave}
                disabled={updateMutation.isPending || !isDirty}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>

      {isConfirmingDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes. Closing now will discard them."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={onClose}
          onCancel={() => setIsConfirmingDiscard(false)}
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
    </Dialog>
  );
}
