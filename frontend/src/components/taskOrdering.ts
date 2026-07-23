import { arrayMove } from '@dnd-kit/sortable';
import type { TaskResponse } from '../api/generated-schemas';

/** Incomplete tasks in their manual drag order. */
export function sortIncompleteTasks(tasks: TaskResponse[]): TaskResponse[] {
  return tasks
    .filter((task) => !task.isComplete)
    .sort((a, b) => a.order - b.order);
}

/** Completed tasks, most-recently-completed first -- so a task the user just checked off appears
 * at the top of the folded "completed" group, and un-completing it later returns it to its
 * original spot among the incomplete tasks rather than requiring it to "jump back" within this
 * group. */
export function sortCompletedTasks(tasks: TaskResponse[]): TaskResponse[] {
  return tasks
    .filter((task) => task.isComplete)
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime;
    });
}

/**
 * Pure computation of the full ordered-id list to send to the `reorderTasks` endpoint, given a drag-end's
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

  const incomplete = sortIncompleteTasks(tasks);
  const oldIndex = incomplete.findIndex((task) => task.id === activeId);
  const newIndex = incomplete.findIndex((task) => task.id === overId);
  if (oldIndex === -1 || newIndex === -1) {
    return null;
  }

  const reordered = arrayMove(incomplete, oldIndex, newIndex);
  const completedIds = tasks
    .filter((task) => task.isComplete)
    .sort((a, b) => a.order - b.order)
    .map((task) => task.id);
  return [...reordered.map((task) => task.id), ...completedIds];
}
