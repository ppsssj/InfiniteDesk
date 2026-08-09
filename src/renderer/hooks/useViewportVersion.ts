import { useEffect, useState, type RefObject } from 'react';

export function useViewportVersion(canvasRef: RefObject<HTMLDivElement | null>): number {
  const [viewportVersion, setViewportVersion] = useState(0);

  useEffect(() => {
    let animationFrameId = 0;
    function handleResize(): void {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(() => {
        setViewportVersion((value) => value + 1);
      });
    }

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    if (canvasRef.current) {
      resizeObserver.observe(canvasRef.current);
    }
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    let animationFrameId = 0;
    const schedulePreviewSync = (): void => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(() => {
        setViewportVersion((value) => value + 1);
      });
    };
    const resizeObserver = new ResizeObserver(schedulePreviewSync);
    const observeUiOverlays = (): void => {
      resizeObserver.disconnect();
      document.querySelectorAll<HTMLElement>('[data-dwm-ui-overlay="true"]').forEach((element) => resizeObserver.observe(element));
    };
    const mutationObserver = new MutationObserver(() => {
      observeUiOverlays();
      schedulePreviewSync();
    });

    observeUiOverlays();
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return viewportVersion;
}
