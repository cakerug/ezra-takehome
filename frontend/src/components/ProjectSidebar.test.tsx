import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectResponse } from '../api/generated-schemas';
import { ApiError } from '../api/errors';
import { DeleteProjectDialog, EditProjectForm, ProjectSidebar } from './ProjectSidebar';
import { ToastHost } from './ToastHost';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    reorderProjects: vi.fn(),
  };
});

import { createProject, deleteProject, listProjects, updateProject } from '../api/client';

const mockListProjects = vi.mocked(listProjects);
const mockCreateProject = vi.mocked(createProject);
const mockUpdateProject = vi.mocked(updateProject);
const mockDeleteProject = vi.mocked(deleteProject);

const inbox: ProjectResponse = { id: 1, name: 'Inbox', description: null, order: 0 };
const work: ProjectResponse = {
  id: 2,
  name: 'Work',
  description: 'Work stuff',
  order: 1,
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

/** Editing lives in the content-area header now (not the sidebar), so `EditProjectForm` is
 * exercised directly rather than through the sidebar UI. */
function renderEditForm(onDone = () => {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EditProjectForm project={work} onDone={onDone} />
      <ToastHost />
    </QueryClientProvider>,
  );
}

/** Deleting also lives in the content-area header now (not the sidebar), so `DeleteProjectDialog`
 * is exercised directly rather than through the sidebar UI. */
function renderDeleteDialog(onClose = () => {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DeleteProjectDialog project={work} onClose={onClose} />
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
      order: 2,
    };
    mockCreateProject.mockResolvedValueOnce(created);
    mockListProjects.mockResolvedValueOnce([inbox, created]);

    renderSidebar();

    await screen.findByText('Inbox');

    await user.click(screen.getByRole('button', { name: '+ Create new project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });

    await user.type(within(dialog).getByLabelText('Name'), 'Groceries');
    await user.type(within(dialog).getByLabelText('Description'), 'Buy milk');
    await user.click(within(dialog).getByRole('button', { name: 'Add project' }));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: 'Groceries',
        description: 'Buy milk',
      });
    });

    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(mockListProjects).toHaveBeenCalledTimes(2);
    // The dialog closes itself after a successful creation.
    expect(screen.queryByRole('dialog', { name: 'New project' })).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: '+ Create new project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });

    await user.type(within(dialog).getByLabelText('Name'), 'A'.repeat(101));
    await user.click(within(dialog).getByRole('button', { name: 'Add project' }));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalled();
    });

    expect(
      await screen.findByText('Name must be at most 100 characters.'),
    ).toBeInTheDocument();
    // The validation error is shown inline on the form, not via the generic Toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('edits a project: saving sends the update and closes the form', async () => {
    const user = userEvent.setup();
    const updated: ProjectResponse = {
      id: 2,
      name: 'Work Renamed',
      description: 'New description',
      order: 1,
    };
    mockUpdateProject.mockResolvedValueOnce(updated);
    const onDone = vi.fn();

    renderEditForm(onDone);

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
    // On success the form calls onDone so the content-area dialog closes.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('shows a server-side validation error inline on the edit-project form, and does not trigger the Toast', async () => {
    const user = userEvent.setup();

    const validationError = new ApiError(400, {
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { Name: ['Name must be at most 100 characters.'] },
    });
    mockUpdateProject.mockRejectedValueOnce(validationError);
    const onDone = vi.fn();

    renderEditForm(onDone);

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
    // A validation failure keeps the form open for correction.
    expect(onDone).not.toHaveBeenCalled();
  });

  it('renders select-only rows: no per-project action menu in the sidebar', async () => {
    mockListProjects.mockResolvedValue([inbox, work]);

    renderSidebar();

    await screen.findByText('Inbox');
    await screen.findByText('Work');

    // All project actions moved to the content-area header, so no row carries an overflow menu.
    expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    // The rows are still selectable (they're plain buttons named after the project).
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();
  });

  it('confirming the delete dialog calls deleteProject; canceling does not', async () => {
    const user = userEvent.setup();
    mockDeleteProject.mockResolvedValue(undefined);
    const onClose = vi.fn();

    renderDeleteDialog(onClose);

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Delete "Work"\?/)).toBeInTheDocument();

    // Cancel: no deletion call; the host is told to close.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mockDeleteProject).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    // Confirm: the flow actually deletes.
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(mockDeleteProject).toHaveBeenCalledWith(2);
    });
  });

  it('surfaces a failed delete in a Toast and keeps the dialog open for retry', async () => {
    const user = userEvent.setup();
    mockDeleteProject.mockRejectedValueOnce(
      new ApiError(500, {
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred. Please try again later.',
      }),
    );

    renderDeleteDialog();

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
