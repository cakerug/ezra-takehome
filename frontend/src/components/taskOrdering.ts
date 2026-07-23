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
