import { useState } from 'react';
import type { ReactNode } from 'react';
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
