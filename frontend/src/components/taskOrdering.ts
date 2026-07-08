import { arrayMove } from '@dnd-kit/sortable';
import type { TaskResponse } from '../api/types';

/** Incomplete tasks first (each group by `order`), completed tasks sorted to the bottom -- per
 * the plan, completed tasks are shown inline rather than in a separate view. */
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
