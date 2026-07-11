import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectResponse } from '../api/generated-schemas';
import { ApiError } from '../api/errors';
import { ProjectSidebar } from './ProjectSidebar';
import { ToastHost } from './ToastHost';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  };
});

import { createProject, deleteProject, listProjects, updateProject } from '../api/client';

const mockListProjects = vi.mocked(listProjects);
const mockCreateProject = vi.mocked(createProject);
const mockUpdateProject = vi.mocked(updateProject);
const mockDeleteProject = vi.mocked(deleteProject);

const inbox: ProjectResponse = { id: 1, name: 'Inbox', description: null, isDefault: true };
const work: ProjectResponse = {
  id: 2,
  name: 'Work',
  description: 'Work stuff',
  isDefault: false,
};

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // ToastHost is mounted alongside (as in main.tsx) so mutation failures, which now surface via
  // the app-level toast bus rather than a local Toast, are rendered and assertable here.
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectSidebar selectedProjectId={null} onSelectProject={() => {}} />
      <ToastHost />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockListProjects.mockReset();
  mockCreateProject.mockReset();
  mockUpdateProject.mockReset();
  mockDeleteProject.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ProjectSidebar', () => {
  it('creates a project via the form and shows it in the list after refetch', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValueOnce([inbox]);
    const created: ProjectResponse = {
      id: 3,
      name: 'Groceries',
      description: 'Buy milk',
      isDefault: false,
    };
    mockCreateProject.mockResolvedValueOnce(created);
    mockListProjects.mockResolvedValueOnce([inbox, created]);

    renderSidebar();

    await screen.findByText('Inbox');

    await user.type(screen.getByLabelText('Name'), 'Groceries');
    await user.type(screen.getByLabelText('Description'), 'Buy milk');
    await user.click(screen.getByRole('button', { name: 'Add project' }));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: 'Groceries',
        description: 'Buy milk',
      });
    });

    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(mockListProjects).toHaveBeenCalledTimes(2);
  });

  it('shows a server-side validation error inline on the new-project form, and does not trigger the Toast', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValueOnce([inbox]);

    const validationError = new ApiError(400, {
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { Name: ['Name must be at most 100 characters.'] },
    });
    mockCreateProject.mockRejectedValueOnce(validationError);

    renderSidebar();

    await screen.findByText('Inbox');

    await user.type(screen.getByLabelText('Name'), 'A'.repeat(101));
    await user.click(screen.getByRole('button', { name: 'Add project' }));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalled();
    });

    expect(
      await screen.findByText('Name must be at most 100 characters.'),
    ).toBeInTheDocument();
    // The validation error is shown inline on the form, not via the generic Toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('edits a project and updates its displayed name', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValueOnce([inbox, work]);
    const updated: ProjectResponse = {
      id: 2,
      name: 'Work Renamed',
      description: 'New description',
      isDefault: false,
    };
    mockUpdateProject.mockResolvedValueOnce(updated);
    mockListProjects.mockResolvedValueOnce([inbox, updated]);

    renderSidebar();

    await screen.findByText('Work');

    await user.click(screen.getByRole('button', { name: 'Edit Work' }));

    const editForm = screen.getByRole('form', { name: 'Edit Work' });

    const nameInput = within(editForm).getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Work Renamed');

    const descriptionInput = within(editForm).getByLabelText('Description');
    await user.clear(descriptionInput);
    await user.type(descriptionInput, 'New description');

    await user.click(within(editForm).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProject).toHaveBeenCalledWith(2, {
        name: 'Work Renamed',
        description: 'New description',
      });
    });

    expect(await screen.findByText('Work Renamed')).toBeInTheDocument();
    expect(screen.queryByText('Work', { exact: true })).not.toBeInTheDocument();
  });

  it('shows a server-side validation error inline on the edit-project form, and does not trigger the Toast', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValueOnce([inbox, work]);

    const validationError = new ApiError(400, {
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { Name: ['Name must be at most 100 characters.'] },
    });
    mockUpdateProject.mockRejectedValueOnce(validationError);

    renderSidebar();

    await screen.findByText('Work');

    await user.click(screen.getByRole('button', { name: 'Edit Work' }));

    const editForm = screen.getByRole('form', { name: 'Edit Work' });

    const nameInput = within(editForm).getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'A'.repeat(101));

    await user.click(within(editForm).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProject).toHaveBeenCalled();
    });

    expect(
      await within(editForm).findByText('Name must be at most 100 characters.'),
    ).toBeInTheDocument();
    // The validation error is shown inline on the form, not via the generic Toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never renders a delete control for the default (Inbox) project', async () => {
    mockListProjects.mockResolvedValue([inbox, work]);

    renderSidebar();

    await screen.findByText('Inbox');
    await screen.findByText('Work');

    // Non-default project has a delete control...
    expect(screen.getByRole('button', { name: 'Delete Work' })).toBeInTheDocument();

    // ...but the Inbox row has none at all -- not disabled, not present.
    expect(screen.queryByRole('button', { name: 'Delete Inbox' })).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Inbox')).not.toBeInTheDocument();

    const inboxRow = screen.getByText('Inbox').closest('li');
    expect(inboxRow).not.toBeNull();
    expect(within(inboxRow!).queryByText('Delete')).not.toBeInTheDocument();
  });

  it('opens a confirmation dialog on delete; confirming calls deleteProject, canceling does not', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([inbox, work]);
    mockDeleteProject.mockResolvedValue(undefined);

    renderSidebar();

    await screen.findByText('Work');

    await user.click(screen.getByRole('button', { name: 'Delete Work' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Delete "Work"\?/)).toBeInTheDocument();

    // Cancel: no deletion call, project remains.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mockDeleteProject).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();

    // Now confirm the flow actually deletes.
    await user.click(screen.getByRole('button', { name: 'Delete Work' }));
    const dialogAgain = await screen.findByRole('alertdialog');
    await user.click(within(dialogAgain).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteProject).toHaveBeenCalledWith(2);
    });
  });

  it('surfaces a failed delete in a Toast and keeps the dialog open for retry', async () => {
    const user = userEvent.setup();
    mockListProjects.mockResolvedValue([inbox, work]);
    mockDeleteProject.mockRejectedValueOnce(
      new ApiError(500, {
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred. Please try again later.',
      }),
    );

    renderSidebar();

    await screen.findByText('Work');

    await user.click(screen.getByRole('button', { name: 'Delete Work' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteProject).toHaveBeenCalledWith(2);
    });

    // The failure surfaces in the shared Toast with a generic message (the server's raw 500
    // detail is not shown), and the dialog stays open so the user can retry in place.
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});
