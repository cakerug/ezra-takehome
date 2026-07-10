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

  // No resolved selection yet: either the initial load before App auto-selects the default
  // project, or the brief gap after deleting the selected project before re-selection lands.
  // Show a neutral placeholder rather than a blank pane.
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

  // Keep a valid project selected once projects load: default to the seeded Inbox (isDefault) so
  // a fresh load lands on a populated view instead of a blank pane, and recover the same way if
  // the selected project stops existing (e.g. it was just deleted). Never overrides a still-valid
  // user selection. Adjusted during render (rather than in an effect) per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes,
  // so the corrected selection is ready in this render instead of causing an extra one.
  const [projectsForSelection, setProjectsForSelection] = useState(projects);
  if (projects !== projectsForSelection) {
    setProjectsForSelection(projects);
    if (projects && projects.length > 0) {
      const selectionValid =
        selectedProjectId !== null && projects.some((project) => project.id === selectedProjectId);
      if (!selectionValid) {
        const defaultProject = projects.find((project) => project.isDefault) ?? projects[0];
        setSelectedProjectId(defaultProject.id);
      }
    }
  }

  return (
    <div className="layout">
      <aside className="layout__sidebar">
        <ProjectSidebar
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
        />
      </aside>
      <main className="layout__content">
        <ContentArea selectedProjectId={selectedProjectId} />
      </main>
    </div>
  );
}

export default App;
