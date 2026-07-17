import { useState } from 'react';
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
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { listProjects, listTasks, reorderTasks } from '../api/client';
import { toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import { NewTaskForm } from './NewTaskForm';
import { TaskItem, TaskItemOverlay } from './TaskItem';
import { sortIncompleteTasks, sortCompletedTasks, computeReorderedIds } from './taskOrdering';

interface TaskListProps {
  projectId: number;
}

/**
 * Renders the selected project's tasks -- creation form and drag-to-reorder list. Reordering is
 * scoped to the current project only (drag-and-drop across projects is out of scope; moving
 * projects is done via each `TaskItem`'s dropdown, per F1).
 *
 * Optimistic reorder: on drop we write the new order into the cache immediately (so the row stays
 * exactly where it was dropped -- no flash back to its old slot while the request is in flight),
 * then send the full reordered id list to `reorderTasks`. The server's authoritative response
 * reconciles the cache on success; on failure we roll the cache back to its pre-drag order and
 * surface the error via the app-level toast (see `showErrorToast`).
 */
export function TaskList({ projectId }: TaskListProps) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isAddingTask, setIsAddingTask] = useState(false);
  // Completed tasks fold into their own group, shown by default. Collapsing/expanding is
  // session-only UI state (not persisted) -- it's not about remembering a preference so much as
  // a quick way to get clutter out of the way for a moment.
  const [showCompleted, setShowCompleted] = useState(true);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => listTasks(projectId),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const otherProjects = (projects ?? []).filter((project) => project.id !== projectId);

  const sensors = useSensors(
    // The whole row is now the drag surface (not just a dedicated handle), and it contains other
    // clickable controls (checkbox, body button, "…" menu). A small movement threshold lets a
    // plain click on those still register normally -- only a deliberate drag (pointer moves ≥8px
    // before release) is treated as a reorder.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderMutation = useMutation({
    mutationFn: (orderedTaskIds: number[]) =>
      reorderTasks({ projectId, orderedTaskIds }),
    onSuccess: (updatedTasks) => {
      // Reconcile the optimistic order with the server's authoritative response (which also carries
      // the server-assigned `order` values) by writing it straight into the cache instead of
      // invalidating -- avoids an extra refetch round trip.
      queryClient.setQueryData(['tasks', projectId], updatedTasks);
    },
    onError: (error: unknown) => {
      showErrorToast(toToastMessage(error));
    },
  });

  function handleDragStart(event: DragStartEvent) {
    setActiveId(Number(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!tasks || !over) {
      return;
    }

    const orderedIds = computeReorderedIds(tasks, active.id, over.id);
    if (!orderedIds) {
      return;
    }

    // Optimistically apply the new order to the cache now, synchronously, so it batches with the
    // `setActiveId(null)` above -- the row stays where it was dropped instead of flashing back to
    // its old slot until the server responds. `sortTasks` orders by each task's `order` field
    // (not array position), so we reassign `order` by new index rather than just reordering the
    // array. `onSuccess` overwrites this with the server's authoritative values; the per-drop
    // `onError` rolls the cache back to `previous`.
    const previous = tasks;
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const reordered = orderedIds.map((id, index) => ({ ...tasksById.get(id)!, order: index }));
    queryClient.setQueryData(['tasks', projectId], reordered);
    reorderMutation.mutate(orderedIds, {
      onError: () => queryClient.setQueryData(['tasks', projectId], previous),
    });
  }

  if (isLoading) {
    return <p className="task-list__status">Loading tasks…</p>;
  }

  const incomplete = tasks ? sortIncompleteTasks(tasks) : [];
  const completed = tasks ? sortCompletedTasks(tasks) : [];
  const incompleteIds = incomplete.map((task) => task.id);
  const activeTask = activeId === null ? undefined : tasks?.find((task) => task.id === activeId);

  return (
    <div className="task-list">
      {(incomplete.length > 0 || completed.length > 0) && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          {/* Completed tasks stay in this same <ul> (rather than a separate list rendered only
              when expanded) so that completing/un-completing a task -- which moves it between the
              incomplete rows and the folded group below -- is a same-parent reorder, not an
              unmount/remount. That matters because a task's detail dialog is state owned by its
              `TaskItem`: toggling "complete" from inside that dialog must not silently close it
              out from under the user. Collapsing the group hides its rows with the native `hidden`
              attribute (not conditional rendering) for the same reason.

              Rows are built as one combined array, rather than three adjacent JSX expressions
              (incomplete.map, a conditional toggle row, completed.map), because React only matches
              keys *within* a single array during reconciliation -- across separate sibling arrays
              a same-keyed element is torn down and rebuilt rather than moved, which is exactly the
              remount this structure exists to avoid. */}
          <SortableContext items={incompleteIds} strategy={verticalListSortingStrategy}>
            <ul className="task-list__items">
              {[
                ...incomplete.map((task) => (
                  <TaskItem key={task.id} task={task} otherProjects={otherProjects} isDraggable />
                )),
                ...(completed.length > 0
                  ? [
                      <li key="completed-toggle-row" className="task-list__completed-toggle-row">
                        <button
                          type="button"
                          className="task-list__completed-toggle"
                          onClick={() => setShowCompleted((prev) => !prev)}
                          aria-expanded={showCompleted}
                        >
                          <span
                            className={`task-list__completed-chevron${showCompleted ? ' task-list__completed-chevron--open' : ''}`}
                            aria-hidden="true"
                          />
                          {completed.length} completed
                        </button>
                      </li>,
                    ]
                  : []),
                ...completed.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    otherProjects={otherProjects}
                    isDraggable={false}
                    hidden={!showCompleted}
                  />
                )),
              ]}
            </ul>
          </SortableContext>
          <DragOverlay>{activeTask && <TaskItemOverlay task={activeTask} />}</DragOverlay>
        </DndContext>
      )}

      {isAddingTask ? (
        // Intentionally left open after a create (no onCreated handler): the form clears and
        // refocuses its title field so several tasks can be added in a row. Cancel closes it.
        <NewTaskForm projectId={projectId} onCancel={() => setIsAddingTask(false)} />
      ) : (
        <button
          type="button"
          className="btn btn--secondary task-list__add-button"
          onClick={() => setIsAddingTask(true)}
        >
          + Add task
        </button>
      )}
    </div>
  );
}
