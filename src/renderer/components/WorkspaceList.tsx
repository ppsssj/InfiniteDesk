import React from 'react';
import { Eye, Trash2, Undo2 } from 'lucide-react';
import type { SavedWorkspace } from '../../shared/types';

type WorkspaceListProps = {
  workspaces: SavedWorkspace[];
  onPreview: (workspace: SavedWorkspace) => void;
  onRestore: (workspace: SavedWorkspace) => void;
  onDelete: (workspace: SavedWorkspace) => void;
};

export function WorkspaceList({ workspaces, onPreview, onRestore, onDelete }: WorkspaceListProps): React.JSX.Element {
  return (
    <section className="side-section">
      <div className="section-heading">
        <h2>Workspaces</h2>
        <span>{workspaces.length}</span>
      </div>
      <div className="template-list">
        {workspaces.length === 0 ? (
          <div className="empty-state">No saved workspaces.</div>
        ) : (
          workspaces.map((workspace) => (
            <article className="template-card" key={workspace.id}>
              <div>
                <h3>{workspace.name}</h3>
                <p>
                  {workspace.windows.length} windows - {workspace.regions.length} regions
                </p>
              </div>
              <div className="template-actions">
                <button title="Load workspace on canvas" onClick={() => onPreview(workspace)}>
                  <Eye size={16} />
                </button>
                <button title="Restore workspace" onClick={() => onRestore(workspace)}>
                  <Undo2 size={16} />
                </button>
                <button title="Delete workspace" onClick={() => onDelete(workspace)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
