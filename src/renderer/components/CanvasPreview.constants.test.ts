import { describe, expect, it } from 'vitest';
import {
  COMPACT_OVERVIEW_CONTENT_INSET,
  COMPACT_OVERVIEW_SCALE,
  OVERVIEW_CONTENT_INSET,
  OVERVIEW_TITLEBAR_HEIGHT,
  getOverviewChromeMetrics
} from './CanvasPreview.constants';

describe('getOverviewChromeMetrics', () => {
  it('removes fixed chrome below the compact overview threshold', () => {
    expect(getOverviewChromeMetrics(COMPACT_OVERVIEW_SCALE - 0.01)).toEqual({
      titlebarHeight: 0,
      contentInset: COMPACT_OVERVIEW_CONTENT_INSET
    });
  });

  it('keeps readable chrome at and above the overview threshold', () => {
    expect(getOverviewChromeMetrics(COMPACT_OVERVIEW_SCALE)).toEqual({
      titlebarHeight: OVERVIEW_TITLEBAR_HEIGHT,
      contentInset: OVERVIEW_CONTENT_INSET
    });
  });
});
