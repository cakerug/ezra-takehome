import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjects } from './api/client';
import type { ProjectResponse } from './api/generated-schemas';
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

function ContentArea({
  projects,
  selectedProjectId,
}: {
  projects: ProjectResponse[];
  selectedProjectId: SelectedProjectId;
}) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const selectedProject =
    selectedProjectId === null
      ? undefined
      : projects.find((project) => project.id === selectedProjectId);

  if (!selectedProject) {
    // No projects left -- e.g. the last one was just deleted.
    return <p className="content__empty">Create a project to get started</p>;
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
      <TaskList projectId={selectedProject.id} projects={projects} />

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
 * Also owns the projects load, and holds the shell back until it resolves so everything below can
 * treat `projects` as present -- it's the only subscriber to the ['projects'] query, and passes the
 * list down to both children.
 */
function App() {
  // As the app evolves in complexity, I would change this to a useContext (i.e., for prop-drilling
  // and ease of understanding) and then even zustand or redux (for more selective state updates and
  // thus fewer re-renders)
  // Using an id instead of an index just for the edge case where another tab rearranges or deletes a project
  const [selectedProjectId, setSelectedProjectId] = useState<SelectedProjectId>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  // Pin the selection to the first project as soon as the list of projects arrives.
  // Re-pin it if that project disappears (via deletion).
  // We do this during render so the id lands in the first paint -- in a useEffect, the content
  // pane commits "Create a project to get started" beside a fully populated sidebar, then
  // corrects itself.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // Note: we don't do the purely derived version:
  // const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0];
  // that they have in that example because there is a subtle bug where if you do not ever select a
  // projectid, then rearranging would always default to the 0th project.
  const hasProjects = projects !== undefined && projects.length > 0;
  if (hasProjects && !projects.some((project) => project.id === selectedProjectId)) {
    setSelectedProjectId(projects[0].id);
  }

  if (isLoading) {
    return <p className="content__empty">Loading…</p>;
  }

  if (!projects) {
    return <p className="content__empty">Could not load your projects.</p>;
  }

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
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
            />
          </>
        )}
      </aside>
      <main className="layout__content">
        <ContentArea projects={projects} selectedProjectId={selectedProjectId} />
      </main>
    </div>
  );
}

export default App;
