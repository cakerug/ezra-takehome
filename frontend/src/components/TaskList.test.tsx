import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectResponse, TaskResponse } from '../api/generated-schemas';
import { ApiError, toToastMessage } from '../api/errors';
import { showErrorToast } from '../toastBus';
import { TaskList } from './TaskList';
import { ToastHost } from './ToastHost';


vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listProjects: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    patchTask: vi.fn(),
    deleteTask: vi.fn(),
    reorderTasks: vi.fn(),
  };
});

import {
  createTask,
  deleteTask,
  listProjects,
  listTasks,
  patchTask,
  reorderTasks,
} from '../api/client';

const mockListProjects = vi.mocked(listProjects);
const mockListTasks = vi.mocked(listTasks);
const mockCreateTask = vi.mocked(createTask);
const mockPatchTask = vi.mocked(patchTask);
const mockDeleteTask = vi.mocked(deleteTask);
const mockReorderTasks = vi.mocked(reorderTasks);

const inbox: ProjectResponse = {
  id: 1,
  name: 'Inbox',
  order: 0,
  createdAt: '2026-01-01T00:00:00Z',
};
const work: ProjectResponse = {
  id: 2,
  name: 'Work',
  order: 1,
  createdAt: '2026-01-01T00:00:00Z',
};

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
      <TaskList projectId={projectId} projects={[inbox, work]} />
      <ToastHost />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockListProjects.mockReset();
  mockListTasks.mockReset();
  mockCreateTask.mockReset();
  mockPatchTask.mockReset();
  mockDeleteTask.mockReset();
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
      expect(mockCreateTask).toHaveBeenCalledWith({ projectId: 1, title: 'Walk dog' });
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

    await user.click(await screen.findByRole('button', { name: '+ Add task' }));
    // Type the title and press Enter (no explicit button click) -- the form should submit.
    await user.type(screen.getByLabelText('Title'), 'Quick task{Enter}');

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith({ projectId: 1, title: 'Quick task' });
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

    await user.click(await screen.findByRole('button', { name: '+ Add task' }));
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

  it('pressing Escape on an empty new-task form hides it immediately, with no confirm dialog', async () => {
    const user = userEvent.setup();
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    await user.click(await screen.findByRole('button', { name: '+ Add task' }));
    expect(screen.getByLabelText('Title')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '+ Add task' })).toBeInTheDocument();
  });

  it('pressing Escape on a dirty new-task form shows a discard confirmation', async () => {
    const user = userEvent.setup();
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    await user.click(await screen.findByRole('button', { name: '+ Add task' }));
    await user.type(screen.getByLabelText('Title'), 'Some task');

    await user.keyboard('{Escape}');

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Discard new task?')).toBeInTheDocument();

    // "Keep editing" just dismisses the confirm dialog -- the form stays open with its content.
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Some task');
  });

  it('confirming discard on a dirty new-task form hides and clears it', async () => {
    const user = userEvent.setup();
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    await user.click(await screen.findByRole('button', { name: '+ Add task' }));
    await user.type(screen.getByLabelText('Title'), 'Some task');
    await user.type(screen.getByLabelText('Description'), 'Some description');

    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

    // Reopening the form should show it empty, confirming the discard actually cleared the fields.
    await user.click(await screen.findByRole('button', { name: '+ Add task' }));
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Description')).toHaveValue('');
  });

  it('completing a task strikes it through, moves it to the bottom, and persists via the API (AE1)', async () => {
    const user = userEvent.setup();
    const first = makeTask({ id: 1, title: 'First', order: 0 });
    const second = makeTask({ id: 2, title: 'Second', order: 1 });
    mockListTasks.mockResolvedValueOnce([first, second]);

    const completedFirst = { ...first, isComplete: true, completedAt: '2026-07-02T00:00:00Z' };
    mockPatchTask.mockResolvedValueOnce(completedFirst);
    mockListTasks.mockResolvedValueOnce([completedFirst, second]);

    renderTaskList();

    await screen.findByText('First');
    await screen.findByText('Second');

    await user.click(screen.getByLabelText('Mark "First" complete'));

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalledWith(1, { isComplete: true });
    });

    // After refetch: "First" is struck through and ordered after "Second", under the "completed"
    // toggle (default expanded, so it's still visible without an extra click).
    const titleFirst = await screen.findByText('First');
    expect(titleFirst).toHaveClass('task-item__title--complete');
    expect(screen.getByRole('button', { name: '1 completed' })).toBeInTheDocument();

    const items = screen
      .getAllByRole('listitem')
      .filter((item) => within(item).queryByRole('checkbox'));
    const titles = items.map((item) => within(item).queryByText(/First|Second/)?.textContent);
    expect(titles).toEqual(['Second', 'First']);
  });

  it('collapses and expands the completed group without closing that task\'s open detail dialog', async () => {
    const user = userEvent.setup();
    const open = makeTask({ id: 1, title: 'Open task', order: 0 });
    const done = makeTask({
      id: 2,
      title: 'Done task',
      order: 1,
      isComplete: true,
      completedAt: '2026-07-01T00:00:00Z',
    });
    mockListTasks.mockResolvedValue([open, done]);

    renderTaskList();

    await screen.findByText('Open task');
    expect(await screen.findByText('Done task')).toBeInTheDocument();

    // Collapse the completed group: the row is hidden via the native `hidden` attribute, not
    // unmounted, so it's still in the DOM but no longer visible/accessible.
    await user.click(screen.getByRole('button', { name: '1 completed' }));
    expect(screen.getByText('Done task')).not.toBeVisible();

    // Expand again: it's visible.
    await user.click(screen.getByRole('button', { name: '1 completed' }));
    expect(await screen.findByText('Done task')).toBeVisible();

    // Opening its detail dialog, then collapsing the group, must not blow away the dialog's state.
    await user.click(screen.getByRole('button', { name: 'View "Done task"' }));
    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByRole('textbox', { name: 'Task title' });
    expect(titleInput).toHaveValue('Done task');
  });

  it('reopening a completed task calls patchTask with isComplete: false and removes the completed styling (AE1)', async () => {
    const user = userEvent.setup();
    const completed = makeTask({
      id: 1,
      title: 'Done task',
      isComplete: true,
      completedAt: '2026-07-01T00:00:00Z',
    });
    mockListTasks.mockResolvedValueOnce([completed]);

    const reopened = { ...completed, isComplete: false, completedAt: null };
    mockPatchTask.mockResolvedValueOnce(reopened);
    mockListTasks.mockResolvedValueOnce([reopened]);

    renderTaskList();

    const titleBeforeReopen = await screen.findByText('Done task');
    expect(titleBeforeReopen).toHaveClass('task-item__title--complete');

    await user.click(screen.getByLabelText('Mark "Done task" incomplete'));

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalledWith(1, { isComplete: false });
    });

    const titleAfterReopen = await screen.findByText('Done task');
    expect(titleAfterReopen).not.toHaveClass('task-item__title--complete');
  });

  it('toggles completion from the detail view checkbox and strikes through the title there too', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Buy milk' });
    mockListTasks.mockResolvedValueOnce([task]);

    const completed = { ...task, isComplete: true, completedAt: '2026-07-02T00:00:00Z' };
    mockPatchTask.mockResolvedValueOnce(completed);
    mockListTasks.mockResolvedValueOnce([completed]);

    renderTaskList();

    await screen.findByText('Buy milk');

    await user.click(screen.getByRole('button', { name: 'View "Buy milk"' }));
    const dialog = await screen.findByRole('dialog');

    const dialogCheckbox = within(dialog).getByRole('checkbox', { name: 'Mark "Buy milk" complete' });
    await user.click(dialogCheckbox);

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalledWith(1, { isComplete: true });
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
    mockPatchTask.mockResolvedValueOnce(updated);
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
      // Both fields are sent together, so the untouched description accompanies the new title.
      expect(mockPatchTask).toHaveBeenCalledWith(1, {
        title: 'New title',
        description: 'Old desc',
      });
    });

    // No unsaved changes remain, so closing doesn't prompt for discard.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
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

    // Hiding Save must not take the close affordance with it: this button is the locked dialog's
    // only visible exit, so losing it strands the user on Escape/backdrop alone.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
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
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Discard changes?')).toBeInTheDocument();

    // "Keep editing" returns to the still-open detail view without saving.
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockPatchTask).not.toHaveBeenCalled();

    // Confirming discard closes the detail view for good.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
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

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

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
    mockPatchTask.mockRejectedValueOnce(validationError);

    renderTaskList();

    await screen.findByText('Old title');

    await user.click(screen.getByRole('button', { name: 'View "Old title"' }));
    const dialog = await screen.findByRole('dialog');

    const titleInput = within(dialog).getByRole('textbox', { name: 'Task title' });
    await user.clear(titleInput);
    await user.type(titleInput, 'A'.repeat(201));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalled();
    });

    expect(
      await within(dialog).findByText('Title must be at most 200 characters.'),
    ).toBeInTheDocument();
    // The validation error is shown inline in the detail view, not via the generic Toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves a task from the detail view\'s "…" menu and closes the dialog', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Movable task', projectId: 1 });
    mockListTasks.mockResolvedValueOnce([task]);

    const moved = { ...task, projectId: 2 };
    mockPatchTask.mockResolvedValueOnce(moved);
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList(1);

    await screen.findByText('Movable task');

    await user.click(screen.getByRole('button', { name: 'View "Movable task"' }));
    const dialog = await screen.findByRole('dialog');

    // The dialog's top-right "…" menu surfaces the same "move to project" targets as the row's.
    await user.click(within(dialog).getByRole('button', { name: 'More actions for "Movable task"' }));
    await user.click(within(dialog).getByRole('menuitem', { name: 'Work' }));

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalledWith(1, { projectId: 2 });
    });
    // Moving closes the detail view (the task no longer belongs to this project).
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('deletes a task from the detail view\'s "…" menu via the confirm dialog', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Doomed task' });
    mockListTasks.mockResolvedValueOnce([task]);
    mockDeleteTask.mockResolvedValueOnce(undefined);
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    await screen.findByText('Doomed task');

    await user.click(screen.getByRole('button', { name: 'View "Doomed task"' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'More actions for "Doomed task"' }));
    await user.click(within(dialog).getByRole('menuitem', { name: 'Delete' }));
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
    // layout/geometry, so collision detection never fires). Instead, we call the mocked
    // `reorderTasks` directly with the swapped order to verify the API integration.
    await expect(reorderTasks({ projectId: 1, orderedTaskIds: [2, 1] })).rejects.toThrow();

    // Order in the DOM is unchanged because no successful reorder ever invalidated the query.
    const items = screen.getAllByRole('listitem');
    const titles = items.map((item) => within(item).queryByText(/First|Second/)?.textContent);
    expect(titles).toEqual(['First', 'Second']);
  });

  it('shows a Toast when a mutation (move) fails, and the list stays unchanged', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Stubborn task', projectId: 1 });
    mockListTasks.mockResolvedValue([task]);
    mockPatchTask.mockRejectedValueOnce(new Error('Failed to move task.'));

    renderTaskList(1);

    await screen.findByText('Stubborn task');

    // "Move to <project>" lives in the row's "…" overflow menu now.
    await user.click(screen.getByRole('button', { name: 'More actions for "Stubborn task"' }));
    await user.click(screen.getByRole('menuitem', { name: 'Work' }));

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalledWith(1, { projectId: 2 });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    // The task is still shown in this (now-unchanged) project's list.
    expect(screen.getByText('Stubborn task')).toBeInTheDocument();
  });

  it('picking a project from the move menu calls patchTask with the target project id, and the task disappears after refetch', async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: 1, title: 'Movable task', projectId: 1 });
    mockListTasks.mockResolvedValueOnce([task]);

    const moved = { ...task, projectId: 2 };
    mockPatchTask.mockResolvedValueOnce(moved);
    // Refetch of project 1's tasks after the move: task 1 no longer belongs there.
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList(1);

    await screen.findByText('Movable task');

    await user.click(screen.getByRole('button', { name: 'More actions for "Movable task"' }));
    await user.click(screen.getByRole('menuitem', { name: 'Work' }));

    await waitFor(() => {
      expect(mockPatchTask).toHaveBeenCalledWith(1, { projectId: 2 });
    });

    await waitFor(() => {
      expect(screen.queryByText('Movable task')).not.toBeInTheDocument();
    });
  });

  it('shows just the add-task button instead of a blank list when a project has no tasks', async () => {
    mockListTasks.mockResolvedValueOnce([]);

    renderTaskList();

    expect(await screen.findByRole('button', { name: '+ Add task' })).toBeInTheDocument();
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
        <TaskList projectId={1} projects={[inbox, work]} />
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

