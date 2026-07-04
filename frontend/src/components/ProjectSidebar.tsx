import { useQuery } from '@tanstack/react-query';
import { listProjects } from '../api/client';

/** `null` means no project is currently selected. The seeded default project (`isDefault: true`)
 * is named "Inbox" by the backend and returned from `/api/projects` like any other project, so
 * it needs no special-casing here -- selecting it just selects that project's id. */
export type SelectedProjectId = number | null;

interface ProjectSidebarProps {
  selectedProjectId: SelectedProjectId;
  onSelectProject: (projectId: SelectedProjectId) => void;
}

export function ProjectSidebar({ selectedProjectId, onSelectProject }: ProjectSidebarProps) {
  const {
    data: projects,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  });

  return (
    <nav aria-label="Projects" className="project-sidebar">
      <h2 className="project-sidebar__heading">Projects</h2>

      {isLoading && <p className="project-sidebar__status">Loading projects…</p>}
      {isError && (
        <p className="project-sidebar__status project-sidebar__status--error">
          Failed to load projects{error instanceof Error ? `: ${error.message}` : ''}
        </p>
      )}

      {projects && (
        <ul className="project-sidebar__list">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className={
                  project.id === selectedProjectId
                    ? 'project-sidebar__item project-sidebar__item--selected'
                    : 'project-sidebar__item'
                }
                onClick={() => onSelectProject(project.id)}
                aria-current={project.id === selectedProjectId ? 'true' : undefined}
              >
                {project.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
