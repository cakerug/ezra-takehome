import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjects } from './api/client';
import { ActionMenu } from './components/ActionMenu';
import { Dialog } from './components/Dialog';
import {
  DeleteProjectDialog,
  EditProjectForm,
  ProjectSidebar,
  type SelectedProjectId,
} from './components/ProjectSidebar';
import { TaskList } from './components/TaskList';

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2 8H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2 12H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ContentArea({ selectedProjectId }: { selectedProjectId: SelectedProjectId }) {
  // Shares the `['projects']` query cache with ProjectSidebar/App, so this doesn't trigger an
  // extra network request.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

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
      <div className="content__header">
        <h1 className="content__title">{selectedProject.name}</h1>
        {/* All project actions (Edit + Delete) live here, from a "…" next to the title -- the
            sidebar rows carry none. Every project gets the menu. */}
        <ActionMenu
          buttonLabel={`More actions for ${selectedProject.name}`}
          items={[
            { label: 'Edit', onSelect: () => setIsEditOpen(true) },
            { label: 'Delete', danger: true, onSelect: () => setIsDeleteOpen(true) },
          ]}
        />
      </div>
      <TaskList projectId={selectedProject.id} />

      {isEditOpen && (
        <Dialog
          ariaLabel={`Edit ${selectedProject.name}`}
          onClose={() => setIsEditOpen(false)}
        >
          <EditProjectForm project={selectedProject} onDone={() => setIsEditOpen(false)} />
        </Dialog>
      )}

      {isDeleteOpen && (
        <DeleteProjectDialog
          project={selectedProject}
          onClose={() => setIsDeleteOpen(false)}
        />
      )}
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Shares the ['projects'] cache with ProjectSidebar/ContentArea, so this adds no extra request.
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  // Fall back to the first project whenever there's no selection yet or the selected project no
  // longer exists (e.g. it was just deleted), so the view is never blank. Never overrides a
  // still-valid user selection.
  const selectionValid =
    selectedProjectId !== null && projects?.some((project) => project.id === selectedProjectId);
  const effectiveProjectId = selectionValid
    ? selectedProjectId
    : (projects?.[0]?.id ?? null);

  return (
    <div className="layout">
      <aside className={isSidebarCollapsed ? 'layout__sidebar layout__sidebar--collapsed' : 'layout__sidebar'}>
        {isSidebarCollapsed ? (
          <button
            type="button"
            className="layout__sidebar-toggle layout__sidebar-toggle--icon"
            onClick={() => setIsSidebarCollapsed(false)}
            aria-label="Expand projects sidebar"
            title="Main menu"
          >
            <SidebarIcon />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="layout__sidebar-toggle"
              onClick={() => setIsSidebarCollapsed(true)}
              aria-label="Collapse projects sidebar"
              aria-expanded="true"
            >
              «
            </button>
            <ProjectSidebar
              selectedProjectId={effectiveProjectId}
              onSelectProject={setSelectedProjectId}
            />
          </>
        )}
      </aside>
      <main className="layout__content">
        <ContentArea selectedProjectId={effectiveProjectId} />
      </main>
    </div>
  );
}

export default App;
