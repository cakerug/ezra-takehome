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
} from '@dnd-kit/sortable';
import { extractErrorMessage, listProjects, listTasks, reorderTasks } from '../api/client';
import { NewTaskForm } from './NewTaskForm';
import { TaskItem } from './TaskItem';
import { Toast } from './Toast';
import { sortTasks, computeReorderedIds } from './taskOrdering';

interface TaskListProps {
  projectId: number;
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
