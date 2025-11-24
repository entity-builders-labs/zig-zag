export interface BadgeData {
  text: string;
  action: 'info' | 'success' | 'warning' | 'error' | 'muted';
}

export interface TourStopLocation {
  type: 'location';
  id: string;
  title: string;
  image: string;
  description?: string;
  badges: BadgeData[];
}

export interface TourStopTransport {
  type: 'transport';
  id: string;
  mode: 'walk' | 'bus';
  label: string;
  duration: string;
}

export type TourStop = TourStopLocation | TourStopTransport;
