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
 * Pure computation of the full reordered task list after a drag-end, given the active/over ids.
 * Returns tasks with `order` reassigned by position so the caller can write them straight into the
 * query cache for the optimistic update, and extract `.map(t => t.id)` for the mutation payload.
 * Only incomplete tasks are draggable, so completed tasks are always appended unchanged at the end.
 * Returns `null` when the drag shouldn't produce a reorder (no-op drop, or a drag involving a
 * completed task). Extracted as a standalone, dnd-kit-independent function so it can be unit tested
 * directly with plain task objects instead of relying on dnd-kit's simulated sensors in jsdom.
 */
export function computeReorderedTasks(
  tasks: TaskResponse[],
  activeId: number | string,
  overId: number | string,
): TaskResponse[] | null {
  if (activeId === overId) {
    return null;
  }

  const incomplete = sortIncompleteTasks(tasks);
  const oldIndex = incomplete.findIndex((task) => task.id === activeId);
  const newIndex = incomplete.findIndex((task) => task.id === overId);
  if (oldIndex === -1 || newIndex === -1) {
    return null;
  }

  const reorderedIncomplete = arrayMove(incomplete, oldIndex, newIndex);
  const completed = tasks
    .filter((task) => task.isComplete)
    .sort((a, b) => a.order - b.order);
  return [...reorderedIncomplete, ...completed].map((task, index) => ({ ...task, order: index }));
}
