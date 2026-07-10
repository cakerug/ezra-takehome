import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjects } from './api/client';
import { ProjectSidebar, type SelectedProjectId } from './components/ProjectSidebar';
import { TaskList } from './components/TaskList';

function ContentArea({ selectedProjectId }: { selectedProjectId: SelectedProjectId }) {
  // Shares the `['projects']` query cache with ProjectSidebar/App, so this doesn't trigger an
  // extra network request.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const selectedProject =
    selectedProjectId === null
      ? undefined
      : projects?.find((project) => project.id === selectedProjectId);

  // No resolved selection yet -- the initial load before the projects query resolves and App
  // can pick a default. Show a neutral placeholder rather than a blank pane.
  if (!selectedProject) {
    return <p className="content__empty">Loading…</p>;
  }

  return (
    <>
      <h1 className="content__title">{selectedProject.name}</h1>
      {selectedProject.description && (
        <p className="content__description">{selectedProject.description}</p>
      )}
      <TaskList projectId={selectedProject.id} />
    </>
  );
}

/**
 * Top-level app shell: a project sidebar beside a content area. Owns "currently selected project"
 * state and hands it to both the sidebar (which sets it) and the content area (which reads it).
 */
function App() {
  // As the app evolves in complexity, I would change this to a useContext (i.e., for prop-drilling
  // and ease of understanding) and then even zustand or redux (for more selective state updates and
  // thus fewer re-renders)
  const [selectedProjectId, setSelectedProjectId] = useState<SelectedProjectId>(null);

  // Shares the ['projects'] cache with ProjectSidebar/ContentArea, so this adds no extra request.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  // Fall back to the seeded default (Inbox) whenever there's no selection yet or the selected
  // project no longer exists (e.g. it was just deleted), so the view is never blank. Never
  // overrides a still-valid user selection.
  const selectionValid =
    selectedProjectId !== null && projects?.some((project) => project.id === selectedProjectId);
  const effectiveProjectId = selectionValid
    ? selectedProjectId
    : ((projects?.find((project) => project.isDefault) ?? projects?.[0])?.id ?? null);

  return (
    <div className="layout">
      <aside className="layout__sidebar">
        <ProjectSidebar
          selectedProjectId={effectiveProjectId}
          onSelectProject={setSelectedProjectId}
        />
      </aside>
      <main className="layout__content">
        <ContentArea selectedProjectId={effectiveProjectId} />
      </main>
    </div>
  );
}

export default App;
