import type { Source, DataStatus } from '../domain';
export interface Collected {
  status: DataStatus;
  metadata: Record<string, unknown>;
  facts?: {
    predicate: string;
    value: unknown;
    confidence: number;
    published_at?: string;
    locator?: Record<string, unknown>;
  }[];
  events?: { id: string; title: string; published_at: string; url: string; event_type: string }[];
  signals?: { metric: string; value: number; unit: string }[];
  error?: string;
}
export interface SourceAdapter {
  id: string;
  collect(source: Source): Promise<Collected>;
}
