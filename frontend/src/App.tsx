import { useQuery } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { listProjects } from './api/client';
import type { SelectedProjectId } from './components/ProjectSidebar';

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

  // U7 will replace this placeholder with project management controls, and U8 will add the
  // task list, both scoped to `selectedProjectId`.
  return <h1>{selectedProject?.name ?? 'Loading…'}</h1>;
}

function App() {
  return (
    <Layout>{(selectedProjectId) => <ContentArea selectedProjectId={selectedProjectId} />}</Layout>
  );
}

export default App;
