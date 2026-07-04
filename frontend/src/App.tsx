import { useQuery } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { listProjects } from './api/client';
import type { SelectedProjectId } from './components/ProjectSidebar';
import { TaskList } from './components/TaskList';

function ContentArea({ selectedProjectId }: { selectedProjectId: SelectedProjectId }) {
  // Shares the `['projects']` query cache with ProjectSidebar, so this doesn't trigger an
  // extra network request.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  if (selectedProjectId === null) {
    return <p>Select a project</p>;
  }

  const selectedProject = projects?.find((project) => project.id === selectedProjectId);

  // `projects` has loaded but no longer contains the selected id -- the project was deleted
  // (e.g. from another tab, or just now via the sidebar). Fall back to the same empty state as
  // "nothing selected" rather than getting stuck showing "Loading..." forever.
  if (projects && !selectedProject) {
    return <p>Select a project</p>;
  }

  return (
    <>
      <h1>{selectedProject?.name ?? 'Loading…'}</h1>
      <TaskList projectId={selectedProjectId} />
    </>
  );
}

function App() {
  return (
    <Layout>{(selectedProjectId) => <ContentArea selectedProjectId={selectedProjectId} />}</Layout>
  );
}

export default App;
