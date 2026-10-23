import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { database, closeDatabase } from '../lib/db';
import { snapshot } from '../lib/knowledge';
import { groundedTask } from '../lib/llm/tasks';

const acceptancePath = 'docs/LLM_EXTRACTION_REMEDIATION.json';
await writeFile(
  acceptancePath,
  JSON.stringify(
    {
      checked_at: new Date().toISOString(),
      businessPass: false,
      failure: { phase: 'INITIALIZATION', code: 'ACCEPTANCE_DID_NOT_COMPLETE' },
    },
    null,
    2,
  ) + '\n',
);
const acceptanceDatabase = 'frontier_acceptance_v011';
let databaseName = '';
try {
  databaseName = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.replace(/^\/+|\/+$/g, '')
    : '';
} catch {}
if (databaseName !== acceptanceDatabase) throw new Error('Real acceptance database required');
const callCap = Number(process.env.LLM_MAX_CALLS_PER_DAY ?? '100');
if (!Number.isSafeInteger(callCap) || callCap <= 0)
  throw new Error('LLM_MAX_CALLS_PER_DAY must be a positive integer');

function sameCost(recorded: string | null, reported: number | null) {
  if (recorded === null || reported === null) return recorded === null && reported === null;
  const value = Number(recorded);
  return Number.isFinite(value) && Math.abs(value - reported) < 1e-12;
}

const db = await database();
try {
  const user = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    user,
    `llm-${user}@example.test`,
    'not-login-enabled',
  ]);
  const result = await groundedTask(
    await snapshot(),
    'extraction',
    '从 Mem0 证据中抽取一条结构化事实',
    user,
    'mem0',
  );
  const usage = (
    await db.query<{
      id: string;
      request_id: string;
      estimated_cost: string | null;
      reserved_cost: string;
      status: string;
      error_code: string | null;
      cache_hit: boolean;
      task_type: string;
    }>(
      'SELECT id,request_id,provider,model,task_type,input_tokens,output_tokens,latency_ms,estimated_cost,reserved_cost,status,error_code,cache_hit,price_basis FROM llm_usage WHERE request_id=$1 ORDER BY created_at,id',
      [result.requestId],
    )
  ).rows;
  const chargedUsage = usage.filter((row) => row.status !== 'BLOCKED');
  const ledgerTotalCost = chargedUsage.some((row) => row.estimated_cost === null)
    ? null
    : chargedUsage.reduce((total, row) => total + Number(row.estimated_cost), 0);
  const checks = {
    businessSuccess: result.status === 'SUCCESS',
    exactlyOneClaim: result.result?.claims?.length === 1,
    boundedAttempts: result.attemptCount >= 1 && result.attemptCount <= 2,
    attemptLedgerComplete:
      usage.length === result.attemptCount &&
      result.attempts.every((attempt) => {
        const row = usage.find((candidate) => candidate.id === attempt.usageId);
        return (
          row?.request_id === result.requestId &&
          row.task_type === 'extraction' &&
          row.status === (attempt.cacheHit ? 'CACHED' : attempt.status) &&
          row.error_code === attempt.error &&
          row.cache_hit === attempt.cacheHit &&
          sameCost(row.estimated_cost, attempt.estimatedCost)
        );
      }),
    oneRequestId: usage.every((row) => row.request_id === result.requestId),
    unknownCostReserved: chargedUsage
      .filter((row) => row.estimated_cost === null)
      .every((row) => Number.isFinite(Number(row.reserved_cost)) && Number(row.reserved_cost) > 0),
    totalCostRecorded:
      ledgerTotalCost === null || result.totalEstimatedCost === null
        ? ledgerTotalCost === result.totalEstimatedCost
        : Math.abs(ledgerTotalCost - result.totalEstimatedCost) < 1e-12,
  };
  const businessPass = Object.values(checks).every(Boolean);
  await writeFile(
    acceptancePath,
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        database: { engine: 'PostgreSQL', name: databaseName },
        policy: { maxCallsPerUtcDay: callCap },
        businessPass,
        checks,
        result,
        usage,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      businessPass,
      status: result.status,
      claims: result.result?.claims?.length,
      attempts: result.attemptCount,
      repaired: result.repaired,
      totalEstimatedCost: result.totalEstimatedCost,
    }),
  );
  if (!businessPass) process.exitCode = 1;
} finally {
  await closeDatabase();
}
