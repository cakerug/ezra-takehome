import { useQuery } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { listProjects } from './api/client';
import type { SelectedProjectId } from './components/ProjectSidebar';
import { TaskList } from './components/TaskList';

function ContentArea({ selectedProjectId }: { selectedProjectId: SelectedProjectId }) {
  // Shares the `['projects']` query cache with ProjectSidebar/Layout, so this doesn't trigger an
  // extra network request.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const selectedProject =
    selectedProjectId === null
      ? undefined
      : projects?.find((project) => project.id === selectedProjectId);

  // No resolved selection yet: either the initial load before Layout auto-selects the default
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

function App() {
  return (
    <Layout>{(selectedProjectId) => <ContentArea selectedProjectId={selectedProjectId} />}</Layout>
  );
}

export default App;
