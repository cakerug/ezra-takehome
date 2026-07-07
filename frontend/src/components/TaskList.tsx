import { useState } from 'react';
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
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { listProjects, listTasks, reorderTasks } from '../api/client';
import type { TaskResponse } from '../api/types';
import { extractErrorMessage } from '../api/errors';
import { NewTaskForm } from './NewTaskForm';
import { TaskItem } from './TaskItem';
import { Toast } from './Toast';

interface TaskListProps {
  projectId: number;
}

/** Incomplete tasks first (each group by `order`), completed tasks sorted to the bottom -- per
 * the plan, completed tasks are shown inline rather than in a separate view. Exported for direct
 * unit coverage in `TaskList.test.tsx`. */
export function sortTasks(tasks: TaskResponse[]): TaskResponse[] {
  return [...tasks].sort((a, b) => {
    if (a.isComplete !== b.isComplete) {
      return a.isComplete ? 1 : -1;
    }
    return a.order - b.order;
  });
}

/**
 * Pure computation of the full ordered-id list to send to `reorderTasks`, given a drag-end's
 * active/over ids. Only incomplete tasks are draggable, so completed ids are always appended
 * unchanged at the end. Returns `null` when the drag shouldn't produce a reorder (no-op drop, or
 * a drag involving a completed task). Extracted as a standalone, dnd-kit-independent function so
 * it can be unit tested directly with a plain `DragEndEvent`-shaped object, instead of relying on
 * dnd-kit's simulated pointer/keyboard sensors in jsdom (see test file for rationale).
 */
export function computeReorderedIds(
  tasks: TaskResponse[],
  activeId: number | string,
  overId: number | string,
): number[] | null {
  if (activeId === overId) {
    return null;
  }

  const incomplete = sortTasks(tasks).filter((task) => !task.isComplete);
  const oldIndex = incomplete.findIndex((task) => task.id === activeId);
  const newIndex = incomplete.findIndex((task) => task.id === overId);
  if (oldIndex === -1 || newIndex === -1) {
    return null;
  }

  const reordered = arrayMove(incomplete, oldIndex, newIndex);
  const completedIds = sortTasks(tasks)
    .filter((task) => task.isComplete)
    .map((task) => task.id);
  return [...reordered.map((task) => task.id), ...completedIds];
}

/**
 * Renders the selected project's tasks -- creation form, drag-to-reorder list, and the shared
 * error `Toast`. Reordering is scoped to the current project only (drag-and-drop across projects
 * is out of scope; moving projects is done via each `TaskItem`'s dropdown, per F1).
 *
 * Pessimistic by design: dragging computes a new local order for immediate visual feedback during
 * the gesture, but on drop it sends the full reordered id list to `reorderTasks` and adopts the
 * order only from the server's authoritative response (written into the cache on success) -- if
 * the mutation fails, the query cache (and therefore the rendered list) is untouched, so the list
 * reverts to its last-known-good order automatically.
 */
export function TaskList({ projectId }: TaskListProps) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    data: tasks,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => listTasks(projectId),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const otherProjects = (projects ?? []).filter((project) => project.id !== projectId);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderMutation = useMutation({
    mutationFn: (orderedTaskIds: number[]) =>
      reorderTasks(projectId, { orderedTaskIds }),
    onSuccess: (updatedTasks) => {
      // Write the server-confirmed order straight into the cache instead of invalidating. This
      // stays fully pessimistic (it's authoritative server data, not an optimistic guess) but
      // avoids the extra refetch round trip -- during which the list would briefly snap back to
      // the pre-drag order and read as a failed drag.
      queryClient.setQueryData(['tasks', projectId], updatedTasks);
    },
    onError: (error: unknown) => {
      setErrorMessage(extractErrorMessage(error, 'Failed to reorder tasks.'));
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!tasks || !over) {
      return;
    }

    const orderedIds = computeReorderedIds(tasks, active.id, over.id);
    if (orderedIds) {
      reorderMutation.mutate(orderedIds);
    }
  }

  if (isLoading) {
    return <p className="task-list__status">Loading tasks…</p>;
  }

  if (isError) {
    return (
      <p className="task-list__status task-list__status--error">
        Failed to load tasks{error instanceof Error ? `: ${error.message}` : ''}
      </p>
    );
  }

  const sorted = tasks ? sortTasks(tasks) : [];
  const incompleteIds = sorted.filter((task) => !task.isComplete).map((task) => task.id);

  return (
    <div className="task-list">
      {sorted.length === 0 ? (
        <p className="task-list__status">No tasks yet.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={incompleteIds} strategy={verticalListSortingStrategy}>
            <ul className="task-list__items">
              {sorted.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  otherProjects={otherProjects}
                  onError={setErrorMessage}
                  isDraggable={!task.isComplete}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <NewTaskForm projectId={projectId} onError={setErrorMessage} />

      {errorMessage && (
        <Toast message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}
    </div>
  );
}
