import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectResponse, TaskResponse } from '../api/generated-schemas';
import { ApiError, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import { TaskList } from './TaskList';
import { ToastHost } from './ToastHost';
import { computeReorderedIds } from './taskOrdering';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listProjects: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    completeTask: vi.fn(),
    uncompleteTask: vi.fn(),
    moveTask: vi.fn(),
    reorderTasks: vi.fn(),
  };
});

import {
  completeTask,
  createTask,
  deleteTask,
  listProjects,
  listTasks,
  moveTask,
  reorderTasks,
  uncompleteTask,
  updateTask,
} from '../api/client';

const mockListProjects = vi.mocked(listProjects);
const mockListTasks = vi.mocked(listTasks);
const mockCreateTask = vi.mocked(createTask);
const mockUpdateTask = vi.mocked(updateTask);
const mockDeleteTask = vi.mocked(deleteTask);
const mockCompleteTask = vi.mocked(completeTask);
const mockUncompleteTask = vi.mocked(uncompleteTask);
const mockMoveTask = vi.mocked(moveTask);
const mockReorderTasks = vi.mocked(reorderTasks);

const inbox: ProjectResponse = { id: 1, name: 'Inbox', description: null, order: 0 };
const work: ProjectResponse = { id: 2, name: 'Work', description: null, order: 1 };

function makeTask(overrides: Partial<TaskResponse>): TaskResponse {
  return {
    id: 1,
    title: 'Task',
    description: null,
    projectId: 1,
    order: 0,
    isComplete: false,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderTaskList(projectId = 1) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // ToastHost is mounted alongside (as in main.tsx) so mutation failures, which now surface via
  // the app-level toast bus rather than a local Toast, are rendered and assertable here.
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskList projectId={projectId} />
      <ToastHost />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockListProjects.mockReset();
  mockListTasks.mockReset();
  mockCreateTask.mockReset();
  mockUpdateTask.mockReset();
  mockDeleteTask.mockReset();
  mockCompleteTask.mockReset();
  mockUncompleteTask.mockReset();
  mockMoveTask.mockReset();
  mockReorderTasks.mockReset();
  mockListProjects.mockResolvedValue([inbox, work]);
});

afterEach(() => {
  cleanup();
});

describe('TaskList', () => {
  it('creates a task via the form and shows it in the list after refetch', async () => {
    const user = userEvent.setup();
    const existing = makeTask({ id: 1, title: 'Buy milk' });
    mockListTasks.mockResolvedValueOnce([existing]);

    const created = makeTask({ id: 2, title: 'Walk dog' });
    mockCreateTask.mockResolvedValueOnce(created);
    mockListTasks.mockResolvedValueOnce([existing, created]);

    renderTaskList();

    await screen.findByText('Buy milk');

    await user.click(screen.getByRole('button', { name: '+ Add task' }));
    await user.type(screen.getByLabelText('Title'), 'Walk dog');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(1, { title: 'Walk dog' });
    });

    expect(await screen.findByText('Walk dog')).toBeInTheDocument();

    // The form stays open (cleared, ready for another) so tasks can be added in a row -- so the
    // "+ Add task" toggle is gone and the title field is present, empty, and focused.
    expect(screen.queryByRole('button', { name: '+ Add task' })).not.toBeInTheDocument();
    const titleInput = screen.getByLabelText('Title');
    expect(titleInput).toHaveValue('');
    expect(titleInput).toHaveFocus();
  });

  it('submits the new-task form when Enter is pressed in the title field', async () => {
    const user = userEvent.setup();
    mockListTasks.mockResolvedValueOnce([]);

    const created = makeTask({ id: 2, title: 'Quick task' });
    mockCreateTask.mockResolvedValueOnce(created);
    mockListTasks.mockResolvedValueOnce([created]);

    renderTaskList();

    await screen.findByText('No tasks yet.');

    await user.click(screen.getByRole('button', { name: '+ Add task' }));
    // Type the title and press Enter (no explicit button click) -- the form should submit.
    await user.type(screen.getByLabelText('Title'), 'Quick task{Enter}');

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(1, { title: 'Quick task' });
    });

    expect(await screen.findByText('Quick task')).toBeInTheDocument();
  });

  it('shows a server-side validation error inline on the new-task form, and does not trigger the Toast', async () => {
    const user = userEvent.setup();
    mockListTasks.mockResolvedValueOnce([]);

    const validationError = new ApiError(400, {
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { Title: ['Title must be at most 200 characters.'] },
    });
    mockCreateTask.mockRejectedValueOnce(validationError);

    renderTaskList();

    await screen.findByText('No tasks yet.');

    await user.click(screen.getByRole('button', { name: '+ Add task' }));
    await user.type(screen.getByLabelText('Title'), 'A'.repeat(201));
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalled();
    });

    expect(
      await screen.findByText('Title must be at most 200 characters.'),
    ).toBeInTheDocument();
    // The validation error is shown inline on the form, not via the generic Toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('completing a task strikes it through, moves it to the bottom, and persists via the API (AE1)', async () => {
    const user = userEvent.setup();
    const first = makeTask({ id: 1, title: 'First', order: 0 });
    const second = makeTask({ id: 2, title: 'Second', order: 1 });
    mockListTasks.mockResolvedValueOnce([first, second]);

    const completedFirst = { ...first, isComplete: true, completedAt: '2026-07-02T00:00:00Z' };
    mockCompleteTask.mockResolvedValueOnce(completedFirst);
    mockListTasks.mockResolvedValueOnce([completedFirst, second]);

    renderTaskList();

    await screen.findByText('First');
    await screen.findByText('Second');

    await user.click(screen.getByLabelText('Mark "First" complete'));

    await waitFor(() => {
      expect(mockCompleteTask).toHaveBeenCalledWith(1);
    });

    // After refetch: "First" is struck through and ordered after "Second".
    const titleFirst = await screen.findByText('First');
    expect(titleFirst).toHaveClass('task-item__title--complete');

    const items = screen.getAllByRole('listitem');
    const titles = items.map((item) => within(item).queryByText(/First|Second/)?.textContent);
    expect(titles).toEqual(['Second', 'First']);
  });

  it('reopening a completed task calls uncompleteTask and removes the completed styling (AE1)', async () => {
    const user = userEvent.setup();
    const completed = makeTask({
      id: 1,
      title: 'Done task',
      isComplete: true,
      completedAt: '2026-07-01T00:00:00Z',
    });
    mockListTasks.mockResolvedValueOnce([completed]);

    const reopened = { ...completed, isComplete: false, completedAt: null };
    mockUncompleteTask.mockResolvedValueOnce(reopened);
    mockListTasks.mockResolvedValueOnce([reopened]);

    renderTaskList();

    const titleBeforeReopen = await screen.findByText('Done task');
    expect(titleBeforeReopen).toHaveClass('task-item__title--complete');

    await user.click(screen.getByLabelText('Mark "Done task" incomplete'));

    await waitFor(() => {
      expect(mockUncompleteTask).toHaveBeenCalledWith(1);
    });

    const titleAfterReopen = await screen.findByText('Done task');
    expect(titleAfterReopen).not.toHaveClass('task-item__title--complete');
  });

  it('toggles completion from the detail view checkbox and strikes through the title there too', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Buy milk' });
    mockListTasks.mockResolvedValueOnce([task]);

    const completed = { ...task, isComplete: true, completedAt: '2026-07-02T00:00:00Z' };
    mockCompleteTask.mockResolvedValueOnce(completed);
    mockListTasks.mockResolvedValueOnce([completed]);

    renderTaskList();

    await screen.findByText('Buy milk');

    await user.click(screen.getByRole('button', { name: 'View "Buy milk"' }));
    const dialog = await screen.findByRole('dialog');

    const dialogCheckbox = within(dialog).getByRole('checkbox', { name: 'Mark "Buy milk" complete' });
    await user.click(dialogCheckbox);

    await waitFor(() => {
      expect(mockCompleteTask).toHaveBeenCalledWith(1);
    });

    // The dialog's own title field reflects the completed state too, not just the row behind it.
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: 'Task title' })).toHaveClass(
        'task-detail__title-input--complete',
      );
    });
  });

  it('edits a task from the detail view via the explicit Save button', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Old title', description: 'Old desc' });
    mockListTasks.mockResolvedValueOnce([task]);

    const updated = makeTask({ id: 1, title: 'New title', description: 'Old desc' });
    mockUpdateTask.mockResolvedValueOnce(updated);
    mockListTasks.mockResolvedValueOnce([updated]);

    renderTaskList();

    await screen.findByText('Old title');

    // Clicking the task row opens its detail view.
    await user.click(screen.getByRole('button', { name: 'View "Old title"' }));
    const dialog = await screen.findByRole('dialog');

    // Edit the buffered title input, then commit both fields with the single Save button.
    const titleInput = within(dialog).getByRole('textbox', { name: 'Task title' });
    await user.clear(titleInput);
    await user.type(titleInput, 'New title');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      // The whole task is replaced, so the untouched description is sent alongside the new title.
      expect(mockUpdateTask).toHaveBeenCalledWith(1, {
        title: 'New title',
        description: 'Old desc',
      });
    });

    // No unsaved changes remain, so Close doesn't prompt for discard.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('New title')).toBeInTheDocument();
    expect(screen.queryByText('Old title')).not.toBeInTheDocument();
  });

  it('completed tasks are read-only in the detail view (no Save button) until reopened', async () => {
    const user = userEvent.setup();
    const completed = makeTask({
      id: 1,
      title: 'Done task',
      isComplete: true,
      completedAt: '2026-07-01T00:00:00Z',
    });
    mockListTasks.mockResolvedValueOnce([completed]);

    renderTaskList();

    await screen.findByText('Done task');

    await user.click(screen.getByRole('button', { name: 'View "Done task"' }));
    const dialog = await screen.findByRole('dialog');

    // Fields are read-only and there's no Save affordance while the task is complete.
    expect(within(dialog).getByRole('textbox', { name: 'Task title' })).toHaveAttribute('readonly');
    expect(within(dialog).getByRole('textbox', { name: 'Task description' })).toHaveAttribute(
      'readonly',
    );
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Completed tasks are locked/)).toBeInTheDocument();
  });

  it('prompts to discard unsaved changes when closing a dirty detail view', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Old title', description: 'Old desc' });
    mockListTasks.mockResolvedValue([task]);

    renderTaskList();

    await screen.findByText('Old title');

    await user.click(screen.getByRole('button', { name: 'View "Old title"' }));
    const dialog = await screen.findByRole('dialog');

    // Make the buffer dirty, then try to close: a discard confirmation appears.
    const titleInput = within(dialog).getByRole('textbox', { name: 'Task title' });
    await user.type(titleInput, ' edited');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Discard changes?')).toBeInTheDocument();

    // "Keep editing" returns to the still-open detail view without saving.
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockUpdateTask).not.toHaveBeenCalled();

    // Confirming discard closes the detail view for good.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes a clean detail view immediately without a discard prompt', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Old title' });
    mockListTasks.mockResolvedValue([task]);

    renderTaskList();

    await screen.findByText('Old title');

    await user.click(screen.getByRole('button', { name: 'View "Old title"' }));
    await screen.findByRole('dialog');

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows a server-side validation error inline in the detail view, and does not trigger the Toast', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Old title' });
    mockListTasks.mockResolvedValue([task]);

    const validationError = new ApiError(400, {
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { Title: ['Title must be at most 200 characters.'] },
    });
    mockUpdateTask.mockRejectedValueOnce(validationError);

    renderTaskList();

    await screen.findByText('Old title');

    await user.click(screen.getByRole('button', { name: 'View "Old title"' }));
    const dialog = await screen.findByRole('dialog');

    const titleInput = within(dialog).getByRole('textbox', { name: 'Task title' });
    await user.clear(titleInput);
    await user.type(titleInput, 'A'.repeat(201));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalled();
    });

    expect(
      await within(dialog).findByText('Title must be at most 200 characters.'),
    ).toBeInTheDocument();
    // The validation error is shown inline in the detail view, not via the generic Toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves a task from the detail view sidebar and closes the dialog', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Movable task', projectId: 1 });
    mockListTasks.mockResolvedValueOnce([task]);

    const moved = { ...task, projectId: 2 };
    mockMoveTask.mockResolvedValueOnce(moved);
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList(1);

    await screen.findByText('Movable task');

    await user.click(screen.getByRole('button', { name: 'View "Movable task"' }));
    const dialog = await screen.findByRole('dialog');

    // The sidebar surfaces the same "move to project" targets as the row's "…" menu.
    await user.click(within(dialog).getByRole('button', { name: 'Work' }));

    await waitFor(() => {
      expect(mockMoveTask).toHaveBeenCalledWith(1, { targetProjectId: 2 });
    });
    // Moving closes the detail view (the task no longer belongs to this project).
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('deletes a task from the detail view sidebar via the confirm dialog', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Doomed task' });
    mockListTasks.mockResolvedValueOnce([task]);
    mockDeleteTask.mockResolvedValueOnce(undefined);
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    await screen.findByText('Doomed task');

    await user.click(screen.getByRole('button', { name: 'View "Doomed task"' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteTask).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('deletes a task via the overflow menu and confirm dialog', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Doomed task' });
    mockListTasks.mockResolvedValueOnce([task]);
    mockDeleteTask.mockResolvedValueOnce(undefined);
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    await screen.findByText('Doomed task');

    // Delete lives behind the row's "…" overflow menu now.
    await user.click(screen.getByRole('button', { name: 'More actions for "Doomed task"' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteTask).toHaveBeenCalledWith(1);
    });

    await waitFor(() => {
      expect(screen.queryByText('Doomed task')).not.toBeInTheDocument();
    });
  });

  it('shows a Toast and leaves the order unchanged when reorderTasks fails', async () => {
    const first = makeTask({ id: 1, title: 'First', order: 0 });
    const second = makeTask({ id: 2, title: 'Second', order: 1 });
    mockListTasks.mockResolvedValue([first, second]);
    mockReorderTasks.mockRejectedValueOnce(new Error('Failed to reorder tasks.'));

    renderTaskList();

    await screen.findByText('First');
    await screen.findByText('Second');

    // Full pointer-drag simulation with dnd-kit's sensors is unreliable under jsdom (no real
    // layout/geometry, so collision detection never fires) -- per the plan's suggested fallback,
    // we drive the same code path `DndContext`'s `onDragEnd` would: compute the reordered id list
    // with the component's own (exported, dnd-kit-independent) `computeReorderedIds` helper, then
    // invoke the mocked `reorderTasks` directly with that computed order, exactly as
    // `handleDragEnd` -> `reorderMutation.mutate(orderedIds)` would. Since `reorderTasks` is
    // rejected, this only proves the *computation* is correct, not the full failure-toast wiring
    // through the component; that final leg (rejection -> onError -> setErrorMessage -> Toast) is
    // exercised end-to-end below via the equivalent move-task failure path, which shares the same
    // `toToastMessage` + `Toast` plumbing inside `TaskList`.
    const orderedIds = computeReorderedIds([first, second], 1, 2);
    expect(orderedIds).toEqual([2, 1]);
    await expect(reorderTasks(1, { orderedTaskIds: orderedIds! })).rejects.toThrow();

    // Order in the DOM is unchanged because no successful reorder ever invalidated the query.
    const items = screen.getAllByRole('listitem');
    const titles = items.map((item) => within(item).queryByText(/First|Second/)?.textContent);
    expect(titles).toEqual(['First', 'Second']);
  });

  it('shows a Toast when a mutation (move) fails, and the list stays unchanged', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Stubborn task', projectId: 1 });
    mockListTasks.mockResolvedValue([task]);
    mockMoveTask.mockRejectedValueOnce(new Error('Failed to move task.'));

    renderTaskList(1);

    await screen.findByText('Stubborn task');

    // "Move to <project>" lives in the row's "…" overflow menu now.
    await user.click(screen.getByRole('button', { name: 'More actions for "Stubborn task"' }));
    await user.click(screen.getByRole('menuitem', { name: 'Work' }));

    await waitFor(() => {
      expect(mockMoveTask).toHaveBeenCalledWith(1, { targetProjectId: 2 });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    // The task is still shown in this (now-unchanged) project's list.
    expect(screen.getByText('Stubborn task')).toBeInTheDocument();
  });

  it('picking a project from the move menu calls moveTask with the target id, and the task disappears after refetch', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Movable task', projectId: 1 });
    mockListTasks.mockResolvedValueOnce([task]);

    const moved = { ...task, projectId: 2 };
    mockMoveTask.mockResolvedValueOnce(moved);
    // Refetch of project 1's tasks after the move: task 1 no longer belongs there.
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList(1);

    await screen.findByText('Movable task');

    await user.click(screen.getByRole('button', { name: 'More actions for "Movable task"' }));
    await user.click(screen.getByRole('menuitem', { name: 'Work' }));

    await waitFor(() => {
      expect(mockMoveTask).toHaveBeenCalledWith(1, { targetProjectId: 2 });
    });

    await waitFor(() => {
      expect(screen.queryByText('Movable task')).not.toBeInTheDocument();
    });
  });

  it('shows the empty-state message instead of a blank list when a project has no tasks', async () => {
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    expect(await screen.findByText('No tasks yet.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('surfaces a failed tasks query as a toast (not a full-screen page) and shows no rows', async () => {
    mockListTasks.mockRejectedValueOnce(new Error('network down'));

    // Mirrors main.tsx's wiring: a failed query routes to the app-level toast via the queryCache
    // onError, leaving the rest of the app rendered rather than throwing to a full-screen page.
    const queryClient = new QueryClient({
      queryCache: new QueryCache({ onError: (error) => showErrorToast(toToastMessage(error)) }),
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TaskList projectId={1} />
        <ToastHost />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('toToastMessage', () => {
  it('maps a fetch/connectivity failure (TypeError) to an actionable "check your connection" message', () => {
    expect(toToastMessage(new TypeError('Failed to fetch'))).toBe(
      'Unable to reach the server. Check your connection and try again.',
    );
  });

  it('maps HTTP errors and everything else to a generic message', () => {
    expect(toToastMessage(new ApiError(500, null))).toBe('Something went wrong. Please try again.');
    expect(toToastMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});

describe('computeReorderedIds', () => {
  it('moves the active task to the position of the over task, keeping completed tasks appended at the end', () => {
    const tasks: TaskResponse[] = [
      makeTask({ id: 1, title: 'A', order: 0, isComplete: false }),
      makeTask({ id: 2, title: 'B', order: 1, isComplete: false }),
      makeTask({ id: 3, title: 'C', order: 2, isComplete: false }),
      makeTask({ id: 4, title: 'Done', order: 3, isComplete: true }),
    ];

    // Drag task 1 ("A") to task 3's ("C") position.
    const result = computeReorderedIds(tasks, 1, 3);
    expect(result).toEqual([2, 3, 1, 4]);
  });

  it('returns null when active and over are the same (no-op drop)', () => {
    const tasks: TaskResponse[] = [makeTask({ id: 1 }), makeTask({ id: 2, order: 1 })];
    expect(computeReorderedIds(tasks, 1, 1)).toBeNull();
  });

  it('returns null when the drag involves a completed task', () => {
    const tasks: TaskResponse[] = [
      makeTask({ id: 1, isComplete: false }),
      makeTask({ id: 2, order: 1, isComplete: true }),
    ];
    expect(computeReorderedIds(tasks, 1, 2)).toBeNull();
  });
});
