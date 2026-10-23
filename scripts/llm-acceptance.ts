import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { database, closeDatabase } from '../lib/db';
import { snapshot } from '../lib/knowledge';
import { groundedTask } from '../lib/llm/tasks';
import { hashPassword } from '../lib/auth';

const acceptancePath = 'docs/LLM_ACCEPTANCE_REMEDIATION.json';
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
  const databaseVersion = (
    await db.query<{ version: string }>("SELECT current_setting('server_version') AS version")
  ).rows[0].version;
  const user = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    user,
    `llm-${user}@example.test`,
    await hashPassword(randomUUID() + randomUUID()),
  ]);
  const data = await snapshot();
  const taskNames = ['classification', 'extraction', 'research', 'build-analysis'] as const;
  const results: Array<{
    task: (typeof taskNames)[number];
    result: Awaited<ReturnType<typeof groundedTask>>;
  }> = [];
  for (const task of taskNames) {
    const result = await groundedTask(
      data,
      task,
      task === 'build-analysis' ? '我想给 OpenClaw 增加长期记忆' : '解释 Mem0 长期记忆的已收集证据',
      user,
      'mem0',
    );
    results.push({ task, result });
    console.log(
      JSON.stringify({
        task,
        status: result.status,
        estimatedCost: result.estimatedCost,
        error: result.error,
      }),
    );
    if (result.status !== 'SUCCESS') break;
  }
  const cache = await groundedTask(
    data,
    'research',
    '解释 Mem0 长期记忆的已收集证据',
    user,
    'mem0',
  );
  const usage = (
    await db.query<{
      id: string;
      request_id: string;
      provider: string;
      model: string;
      task_type: string;
      input_tokens: number | null;
      output_tokens: number | null;
      latency_ms: number | null;
      estimated_cost: string | null;
      reserved_cost: string;
      status: string;
      error_code: string | null;
      cache_hit: boolean;
      price_basis: unknown;
    }>(
      'SELECT id,request_id,provider,model,task_type,input_tokens,output_tokens,latency_ms,estimated_cost,reserved_cost,status,error_code,cache_hit,price_basis FROM llm_usage WHERE user_id=$1 ORDER BY created_at,id',
      [user],
    )
  ).rows;
  const extraction = results.find((entry) => entry.task === 'extraction')?.result;
  // HTTP/provider success is not extraction business success: the contract requires exactly one
  // grounded claim, and every repair attempt must be represented in the usage ledger.
  const extractionUsage = usage.filter((row) => row.request_id === extraction?.requestId);
  const chargedExtractionUsage = extractionUsage.filter((row) => row.status !== 'BLOCKED');
  const extractionLedgerCost = chargedExtractionUsage.some((row) => row.estimated_cost === null)
    ? null
    : chargedExtractionUsage.reduce((total, row) => total + Number(row.estimated_cost), 0);
  const extractionTotalCost = extraction?.totalEstimatedCost ?? null;
  const extractionChecks = {
    businessSuccess: extraction?.status === 'SUCCESS',
    exactlyOneClaim: extraction?.status === 'SUCCESS' && extraction.result?.claims?.length === 1,
    boundedAttempts: !!extraction && extraction.attemptCount >= 1 && extraction.attemptCount <= 2,
    attemptLedgerComplete:
      !!extraction &&
      extractionUsage.length === extraction.attemptCount &&
      extraction.attempts.every((attempt) => {
        const row = extractionUsage.find((candidate) => candidate.id === attempt.usageId);
        return (
          row?.request_id === extraction.requestId &&
          row.task_type === 'extraction' &&
          row.status === (attempt.cacheHit ? 'CACHED' : attempt.status) &&
          row.error_code === attempt.error &&
          row.cache_hit === attempt.cacheHit &&
          sameCost(row.estimated_cost, attempt.estimatedCost)
        );
      }),
    oneRequestId:
      !!extraction && extractionUsage.every((row) => row.request_id === extraction.requestId),
    unknownCostReserved: chargedExtractionUsage
      .filter((row) => row.estimated_cost === null)
      .every((row) => Number.isFinite(Number(row.reserved_cost)) && Number(row.reserved_cost) > 0),
    totalCostRecorded:
      extractionLedgerCost === null || extractionTotalCost === null
        ? extractionLedgerCost === extractionTotalCost
        : Math.abs(extractionLedgerCost - extractionTotalCost) < 1e-12,
  };
  const businessPass =
    results.length === taskNames.length &&
    results.every(({ result }) => result.status === 'SUCCESS') &&
    Object.values(extractionChecks).every(Boolean) &&
    cache.status === 'SUCCESS' &&
    cache.cacheHit;
  await writeFile(
    // Keep LLM_ACCEPTANCE*.json as immutable historical evidence; remediation runs get a new file.
    acceptancePath,
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        database: { engine: 'PostgreSQL', name: databaseName, version: databaseVersion },
        policy: { maxCallsPerUtcDay: callCap },
        syntheticUser: true,
        businessPass,
        extractionChecks,
        results: results.map(({ task, result }) => ({ task, ...result })),
        cacheReuse: { status: cache.status, cacheHit: cache.cacheHit },
        usage,
      },
      null,
      2,
    ) + '\n',
  );
  if (!businessPass) process.exitCode = 1;
} finally {
  await closeDatabase();
}
