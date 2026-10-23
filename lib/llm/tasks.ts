import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Snapshot } from '../domain';
import { runModel, routedModel, type ModelRunResult, type TaskType } from './provider';

type GroundedFact = {
  id: string;
  entity: string;
  predicate: string;
  value: unknown;
  source: string;
  verified_at: string;
};
type GroundedClaim = { fact_id: string; predicate: string; value: unknown };
export const MAX_EXTRACTION_ATTEMPTS = 2;
export type GroundedOutput = {
  kind: 'ANALYSIS';
  summary: string;
  citations: string[];
  intent?: 'CONCEPT' | 'COMPARE' | 'BUILD';
  claims?: GroundedClaim[];
};

const claimSchema = z.strictObject({
  fact_id: z.string(),
  predicate: z.string(),
  value: z.unknown(),
});

export function groundedOutputSchema(
  task: TaskType,
  facts: GroundedFact[],
): z.ZodType<GroundedOutput> {
  const common = {
    kind: z.literal('ANALYSIS'),
    summary: z.string().min(1).max(80),
    citations: z.array(z.string()).max(2),
  };
  let schema: z.ZodType<GroundedOutput>;
  if (task === 'classification')
    schema = z.strictObject({
      ...common,
      intent: z.enum(['CONCEPT', 'COMPARE', 'BUILD']),
    });
  else if (task === 'extraction')
    schema = z.strictObject({
      ...common,
      claims: z.tuple([claimSchema]),
    });
  else schema = z.strictObject(common);

  const ids = new Set(facts.map((fact) => fact.id));
  return schema.superRefine((value, ctx) => {
    if (value.citations.some((id) => !ids.has(id)))
      ctx.addIssue({ code: 'custom', message: 'Unknown evidence citation' });
    if (facts.length && !value.citations.length)
      ctx.addIssue({ code: 'custom', message: 'Evidence citations required' });
    for (const claim of value.claims ?? []) {
      const fact = facts.find((candidate) => candidate.id === claim.fact_id);
      if (
        !fact ||
        fact.predicate !== claim.predicate ||
        JSON.stringify(fact.value) !== JSON.stringify(claim.value)
      )
        ctx.addIssue({ code: 'custom', message: 'Extraction does not match supplied evidence' });
    }
  });
}

function taskPrompt(task: TaskType, query: string, facts: GroundedFact[], repairError?: string) {
  const taskInstruction =
    task === 'extraction'
      ? 'Include claims as an array containing exactly ONE supported fact_id/predicate/value object. Omit intent.'
      : task === 'classification'
        ? 'Include exactly one intent: CONCEPT, COMPARE or BUILD. Omit claims.'
        : 'Omit claims and intent.';
  return JSON.stringify({
    task,
    query: query.slice(0, 500),
    evidence: facts,
    instructions: `Return one compact JSON object only. summary must be ONE short Chinese sentence of at most 80 characters. citations must contain at most 2 supplied evidence IDs. Official declarations are DECLARED, never tested compatibility. Unknown remains unknown. All prose is ANALYSIS. ${taskInstruction}`,
    ...(repairError
      ? {
          repair: `The previous output failed with ${repairError}. Return a new object that follows every field and cardinality constraint exactly.`,
        }
      : {}),
    example: {
      kind: 'ANALYSIS',
      summary: '证据不足以确认运行时兼容性。',
      citations: facts[0] ? [facts[0].id] : [],
      ...(task === 'classification' ? { intent: 'CONCEPT' } : {}),
      ...(task === 'extraction' && facts[0]
        ? {
            claims: [
              { fact_id: facts[0].id, predicate: facts[0].predicate, value: facts[0].value },
            ],
          }
        : {}),
    },
  });
}

function totalEstimatedCost(attempts: ModelRunResult<GroundedOutput>[]) {
  const charged = attempts.filter((attempt) => attempt.status !== 'BLOCKED');
  if (charged.some((attempt) => attempt.estimatedCost === null)) return null;
  return charged.reduce((total, attempt) => total + (attempt.estimatedCost ?? 0), 0);
}

export async function groundedTask(
  data: Snapshot,
  task: TaskType,
  query: string,
  userId: string,
  cardId?: string,
) {
  const facts = data.facts
    .filter(
      (fact) =>
        fact.claim_id &&
        ['CLAIM_VERIFIED', 'CROSS_VERIFIED'].includes(fact.verification_status ?? '') &&
        (!cardId ||
          fact.entity_id === cardId ||
          data.relationships.some(
            (relationship) =>
              relationship.to_id === cardId && relationship.from_id === fact.entity_id,
          )),
    )
    .filter((fact) => JSON.stringify(fact.value).length < 300)
    .slice(0, 4)
    .map((fact) => ({
      id: fact.id,
      entity: fact.entity_id,
      predicate: fact.predicate,
      value: fact.value,
      source: fact.source_id,
      verified_at: fact.last_verified_at,
    }));
  const schema = groundedOutputSchema(task, facts);
  const requestId = randomUUID();
  const cacheIdentity = taskPrompt(task, query, facts);
  const attempts: ModelRunResult<GroundedOutput>[] = [];
  let repairError: string | undefined;

  for (
    let attempt = 0;
    attempt < (task === 'extraction' ? MAX_EXTRACTION_ATTEMPTS : 1);
    attempt++
  ) {
    const result = await runModel(
      'deepseek',
      {
        model: routedModel(task),
        task,
        prompt: taskPrompt(task, query, facts, repairError),
        maxOutputTokens: 1024,
        requestId,
        cardId,
        cacheIdentity,
      },
      schema,
      userId,
      null,
    );
    attempts.push(result);
    if (
      result.status === 'SUCCESS' ||
      !['OUTPUT_SCHEMA_INVALID', 'OUTPUT_JSON_INVALID'].includes(result.error ?? '')
    )
      break;
    repairError = result.error ?? undefined;
  }

  const result = attempts.at(-1)!;
  const totalCost = totalEstimatedCost(attempts);
  return {
    ...result,
    estimatedCost: totalCost,
    warning: attempts.some((attempt) => attempt.warning),
    totalEstimatedCost: totalCost,
    attemptCount: attempts.length,
    repaired:
      task === 'extraction' &&
      attempts.length === MAX_EXTRACTION_ATTEMPTS &&
      result.status === 'SUCCESS',
    unrecoverable:
      task === 'extraction' &&
      attempts.length === MAX_EXTRACTION_ATTEMPTS &&
      result.status === 'FAILED',
    attempts: attempts.map((attempt, index) => ({
      attempt: index + 1,
      usageId: attempt.usageId,
      status: attempt.status,
      error: attempt.error,
      estimatedCost: attempt.estimatedCost,
      cacheHit: attempt.cacheHit,
    })),
  };
}
