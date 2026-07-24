import type { TaskResponse } from '../api/generated-schemas';

/** Incomplete tasks in their manual drag order. */
export function sortIncompleteTasks(tasks: TaskResponse[]): TaskResponse[] {
  return tasks
    .filter((task) => !task.isComplete)
    .sort((a, b) => a.order - b.order);
}

/** Completed tasks, most-recently-completed first, so a task the user just checked off appears at
 * the top of the folded "completed" group.
 *
 * Sorting this group by `completedAt` rather than `order` leaves `order` free to keep meaning
 * "manual position in the list", so un-completing a task drops it back among the incomplete tasks
 * near where it used to sit instead of at the end. It's the position *relative to* the other tasks
 * that survives, not an exact slot: a completed task stays in the project's single `order`
 * sequence, so reorders that happen while it's checked off renumber it along with everything else
 * (see `TaskList`'s `handleDragEnd`). */
export function sortCompletedTasks(tasks: TaskResponse[]): TaskResponse[] {
  return tasks
    .filter((task) => task.isComplete)
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime;
    });
}
