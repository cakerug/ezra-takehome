import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjects } from '../api/client';
import { ProjectSidebar, type SelectedProjectId } from './ProjectSidebar';

interface LayoutProps {
  /** Renders the content area, given the currently selected project id (or null for none). */
  children: (selectedProjectId: SelectedProjectId) => ReactNode;
}

/**
 * Top-level app shell: a project sidebar beside a content area. Owns "currently selected
 * project" state and hands it down to `children` as a render prop so later units (U7's project
 * management controls, U8's task list) can render project- or task-specific content without
 * Layout needing to know about either.
 */
export function Layout({ children }: LayoutProps) {
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
      <main className="layout__content">{children(selectedProjectId)}</main>
    </div>
  );
}
