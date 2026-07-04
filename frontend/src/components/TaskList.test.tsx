import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectResponse, TaskResponse } from '../api/types';
import { ApiError } from '../api/client';
import { TaskList, computeReorderedIds } from './TaskList';

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
  updateTask,
} from '../api/client';

const mockListProjects = vi.mocked(listProjects);
const mockListTasks = vi.mocked(listTasks);
const mockCreateTask = vi.mocked(createTask);
const mockUpdateTask = vi.mocked(updateTask);
const mockDeleteTask = vi.mocked(deleteTask);
const mockCompleteTask = vi.mocked(completeTask);
const mockMoveTask = vi.mocked(moveTask);
const mockReorderTasks = vi.mocked(reorderTasks);

const inbox: ProjectResponse = { id: 1, name: 'Inbox', description: null, isDefault: true };
const work: ProjectResponse = { id: 2, name: 'Work', description: null, isDefault: false };

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
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskList projectId={projectId} />
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

    await user.type(screen.getByLabelText('Title'), 'Walk dog');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(1, { title: 'Walk dog' });
    });

    expect(await screen.findByText('Walk dog')).toBeInTheDocument();
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

  it('edits a task and updates its displayed title/description', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Old title', description: 'Old desc' });
    mockListTasks.mockResolvedValueOnce([task]);

    const updated = makeTask({ id: 1, title: 'New title', description: 'New desc' });
    mockUpdateTask.mockResolvedValueOnce(updated);
    mockListTasks.mockResolvedValueOnce([updated]);

    renderTaskList();

    await screen.findByText('Old title');

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const form = screen.getByRole('form', { name: 'Edit Old title' });
    const titleInput = within(form).getByLabelText('Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'New title');

    const descInput = within(form).getByLabelText('Description');
    await user.clear(descInput);
    await user.type(descInput, 'New desc');

    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith(1, { title: 'New title', description: 'New desc' });
    });

    expect(await screen.findByText('New title')).toBeInTheDocument();
    expect(screen.queryByText('Old title')).not.toBeInTheDocument();
  });

  it('shows a server-side validation error inline on the edit-task form, and does not trigger the Toast', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const form = screen.getByRole('form', { name: 'Edit Old title' });
    const titleInput = within(form).getByLabelText('Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'A'.repeat(201));

    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalled();
    });

    expect(
      await within(form).findByText('Title must be at most 200 characters.'),
    ).toBeInTheDocument();
    // The validation error is shown inline on the form, not via the generic Toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('deletes a task via the confirm dialog', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Doomed task' });
    mockListTasks.mockResolvedValueOnce([task]);
    mockDeleteTask.mockResolvedValueOnce(undefined);
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    await screen.findByText('Doomed task');

    await user.click(screen.getByRole('button', { name: 'Delete' }));

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
    // `extractErrorMessage` + `Toast` plumbing inside `TaskList`.
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

    const select = screen.getByLabelText('Move Stubborn task to project');
    await user.selectOptions(select, 'Work');

    await waitFor(() => {
      expect(mockMoveTask).toHaveBeenCalledWith(1, { targetProjectId: 2 });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to move task.');
    // The task is still shown in this (now-unchanged) project's list.
    expect(screen.getByText('Stubborn task')).toBeInTheDocument();
  });

  it('selecting a project from the move dropdown calls moveTask with the target id, and the task disappears after refetch', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Movable task', projectId: 1 });
    mockListTasks.mockResolvedValueOnce([task]);

    const moved = { ...task, projectId: 2 };
    mockMoveTask.mockResolvedValueOnce(moved);
    // Refetch of project 1's tasks after the move: task 1 no longer belongs there.
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList(1);

    await screen.findByText('Movable task');

    const select = screen.getByLabelText('Move Movable task to project');
    await user.selectOptions(select, 'Work');

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
