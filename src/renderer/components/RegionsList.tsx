import React from 'react';
import type { TemplateRegion } from '../canvas/types';

type RegionsListProps = {
  regions: TemplateRegion[];
  selectedRegionId: string | null;
};

export function RegionsList({ regions, selectedRegionId }: RegionsListProps): React.JSX.Element {
  return (
    <section className="side-section">
      <div className="section-heading">
        <h2>Regions</h2>
        <span>{regions.length}</span>
      </div>
      <div className="region-list">
        {regions.length === 0 ? (
          <div className="empty-state">Ctrl+Drag on the canvas to create a region.</div>
        ) : (
          regions.map((region) => (
            <article className={`region-list-item ${selectedRegionId === region.id ? 'active' : ''}`} key={region.id}>
              <strong>{region.name}</strong>
              <span>{region.windowIds.length} windows</span>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
