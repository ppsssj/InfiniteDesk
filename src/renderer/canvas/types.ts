export type VirtualWindowState = {
  hwnd?: string;
  title: string;
  processName: string;
  realX: number;
  realY: number;
  virtualX: number;
  virtualY: number;
  width: number;
  height: number;
  initialVirtualX?: number;
  initialVirtualY?: number;
  isDirty?: boolean;
  statusReason?: string;
  isHelper?: boolean;
};

export type TemplateRegion = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  windowIds: string[];
  color?: string;
  createdAt: string;
  isDirty?: boolean;
};
