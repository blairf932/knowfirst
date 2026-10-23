import { z } from 'zod';
export const statuses = [
  'AVAILABLE',
  'PARTIAL',
  'STALE',
  'UNAVAILABLE',
  'RATE_LIMITED',
  'ERROR',
] as const;
export type DataStatus = (typeof statuses)[number];
export type Tier = 'S' | 'A' | 'B' | 'C';
export type Trend = 'RISING' | 'STABLE' | 'DECLINING' | 'EMERGING' | 'UNCERTAIN';
export type EntityKind = 'Concept' | 'Tool' | 'Company' | 'Project' | 'Technology';
export type EvidenceKind = 'FACT' | 'ANALYSIS';
export interface Entity {
  id: string;
  slug: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  summary: string;
  details: Record<string, unknown>;
}
export interface Source {
  id: string;
  url: string;
  title: string;
  tier: Tier;
  adapter: string;
  entity_id: string | null;
  status: DataStatus;
  retrieved_at: string | null;
  published_at: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
}
export interface Fact {
  id: string;
  entity_id: string;
  predicate: string;
  value: unknown;
  source_id: string;
  kind: EvidenceKind;
  confidence: number;
  discovered_at: string;
  published_at: string | null;
  valid_from: string;
  valid_until: string | null;
  last_verified_at: string;
  claim_id?: string | null;
  verification_status?: 'URL_ONLY' | 'SOURCE_VERIFIED' | 'CLAIM_VERIFIED' | 'CROSS_VERIFIED';
  evidence?: Record<string, unknown> | null;
}
export interface FrontierEvent {
  id: string;
  entity_id: string;
  source_id: string;
  title: string;
  event_type: string;
  published_at: string;
  discovered_at: string;
  url: string;
}
export interface Signal {
  entity_id: string;
  metric: string;
  value: number | null;
  unit: string;
  status: DataStatus;
  observed_at: string;
  source_id: string;
}
export interface UserContext {
  uses: string[];
  interests: string[];
  building: string;
  learned: string[];
}
export const emptyContext: UserContext = { uses: [], interests: [], building: '', learned: [] };
export const contextSchema = z.object({
  uses: z.array(z.string().trim().min(1).max(80)).max(30),
  interests: z.array(z.string().trim().min(1).max(80)).max(30),
  building: z.string().trim().max(1000),
  learned: z.array(z.string().max(80)).max(200).default([]),
});
export const querySchema = z.string().trim().min(1).max(500);
export const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((x) => x.toLowerCase()),
  password: z.string().min(12).max(128),
});
export interface Snapshot {
  entities: Entity[];
  sources: Source[];
  facts: Fact[];
  events: FrontierEvent[];
  signals: Signal[];
  relationships: {
    from_id: string;
    to_id: string;
    predicate: string;
    source_id: string | null;
    kind: EvidenceKind;
  }[];
  revision: string;
}
export const ttlHours = {
  evergreen: Number(process.env.TTL_EVERGREEN_HOURS) || 2160,
  tool: Number(process.env.TTL_TOOL_HOURS) || 168,
  price: Number(process.env.TTL_PRICE_HOURS) || 24,
  changes: Number(process.env.TTL_CHANGES_HOURS) || 6,
};
export function freshness(
  verified: string | null,
  hours = ttlHours.tool,
  now = Date.now(),
): number | null {
  if (!verified) return null;
  return Math.max(
    0,
    Math.min(100, Math.round(100 * (1 - (now - Date.parse(verified)) / (hours * 3600000)))),
  );
}
export function confidenceLabel(n: number | null) {
  return n === null ? 'UNAVAILABLE' : n >= 0.85 ? 'HIGH' : n >= 0.6 ? 'MEDIUM' : 'LOW';
}
