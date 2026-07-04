import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectResponse } from '../api/types';
import { ProjectSidebar } from './ProjectSidebar';

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
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectSidebar selectedProjectId={null} onSelectProject={() => {}} />
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
});
