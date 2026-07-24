import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectResponse } from './api/generated-schemas';
import App from './App';

vi.mock('./api/client', async () => {
  const actual = await vi.importActual<typeof import('./api/client')>('./api/client');
  return {
    ...actual,
    listProjects: vi.fn(),
    listTasks: vi.fn(),
  };
});

import { listProjects, listTasks } from './api/client';

const mockListProjects = vi.mocked(listProjects);
const mockListTasks = vi.mocked(listTasks);

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

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  mockListProjects.mockReset();
  mockListTasks.mockReset();
  mockListTasks.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('keeps the selected project selected when another project is reordered above it', async () => {
    mockListProjects.mockResolvedValue([inbox, work]);
    const queryClient = renderApp();

    // Nothing has been clicked: the selection here is the default the app seeds from the loaded
    // list, which is the case the bug used to hit.
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();

    // Stands in for a drag-to-reorder: this is exactly the cache write ProjectSidebar's
    // `handleDragEnd` makes when Work is dropped above Inbox. Driving dnd-kit's sensors from a
    // test can't reach this state, so the reorder's effect on the cache is applied directly.
    act(() => {
      queryClient.setQueryData(['projects'], [work, inbox]);
    });

    // Wait on the sidebar actually showing the new order, so the assertions below can't pass just
    // because the reorder hadn't been rendered yet.
    const sidebar = screen.getByRole('navigation', { name: 'Projects' });
    await waitFor(() => {
      const names = within(sidebar)
        .getAllByRole('button', { name: /^(Inbox|Work)$/ })
        .map((button) => button.textContent);
      expect(names).toEqual(['Work', 'Inbox']);
    });

    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Inbox' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('selects the first remaining project when the selected one is deleted', async () => {
    mockListProjects.mockResolvedValue([inbox, work]);
    const queryClient = renderApp();

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(['projects'], [work]);
    });

    expect(await screen.findByRole('heading', { name: 'Work' })).toBeInTheDocument();
  });

  it('prompts to create a project once the last one is deleted', async () => {
    mockListProjects.mockResolvedValue([inbox]);
    const queryClient = renderApp();

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(['projects'], []);
    });

    expect(await screen.findByText('Create a project to get started')).toBeInTheDocument();
  });
});
