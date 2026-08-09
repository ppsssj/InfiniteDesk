import React from 'react';
import { Eye, Trash2, Undo2 } from 'lucide-react';
import type { LayoutTemplate } from '../../shared/types';

type TemplateListProps = {
  templates: LayoutTemplate[];
  onPreview: (template: LayoutTemplate) => void;
  onRestore: (template: LayoutTemplate) => void;
  onDelete: (template: LayoutTemplate) => void;
};

export function TemplateList({ templates, onPreview, onRestore, onDelete }: TemplateListProps): React.JSX.Element {
  return (
    <section className="side-section">
      <div className="section-heading">
        <h2>Saved Templates</h2>
        <span>{templates.length}</span>
      </div>
      <div className="template-list">
        {templates.length === 0 ? (
          <div className="empty-state">No saved templates.</div>
        ) : (
          templates.map((template) => (
            <article className="template-card" key={template.id}>
              <div>
                <h3>{template.name}</h3>
                <p>{template.windows.length} windows</p>
              </div>
              <div className="template-actions">
                <button title="Preview as region" onClick={() => onPreview(template)}>
                  <Eye size={16} />
                </button>
                <button title="Restore template" onClick={() => onRestore(template)}>
                  <Undo2 size={16} />
                </button>
                <button title="Delete template" onClick={() => onDelete(template)}>
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
