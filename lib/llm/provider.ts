import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { database } from '../db';
import { deepseek, flashPrice } from './deepseek';
export type ProviderName = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'local';
export type TaskType = 'extraction' | 'classification' | 'research' | 'build-analysis';
export interface ModelRequest {
  model: string;
  task: TaskType;
  prompt: string;
  maxOutputTokens: number;
  requestId?: string;
  cardId?: string;
  cacheIdentity?: string;
}
export interface ModelResponse {
  output: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  finishReason?: string;
}
export interface LLMProvider {
  name: ProviderName;
  generate(request: ModelRequest): Promise<ModelResponse>;
}
export type ModelRunStatus = 'SUCCESS' | 'FAILED' | 'BLOCKED';
export interface ModelRunResult<T> {
  result: T | null;
  usageId: string;
  requestId: string;
  status: ModelRunStatus;
  error: string | null;
  estimatedCost: number | null;
  cacheHit: boolean;
  warning: boolean;
}
export const modelCacheContract = 'schema-v011-exact-one-repair-v1';
export const registry = new Map<ProviderName, LLMProvider>([['deepseek', deepseek]]);
export const providerAvailability = {
  openai: 'UNAVAILABLE',
  anthropic: 'UNAVAILABLE',
  google: 'UNAVAILABLE',
  deepseek: 'CONFIGURATION_REQUIRED',
  local: 'UNAVAILABLE',
};
export function registerProvider(p: LLMProvider) {
  registry.set(p.name, p);
  providerAvailability[p.name] = 'AVAILABLE';
}
export function routedModel(task: TaskType) {
  return (
    process.env[`LLM_MODEL_${task.replaceAll('-', '_').toUpperCase()}`] ||
    process.env.LLM_MODEL ||
    'deepseek-v4-flash'
  );
}
export async function runModel<T>(
  provider: ProviderName,
  request: ModelRequest,
  schema: z.ZodType<T>,
  userId: string | null,
  runId: string | null,
): Promise<ModelRunResult<T>> {
  const adapter = registry.get(provider);
  if (!adapter) throw new Error('UNAVAILABLE: no model adapter configured');
  const db = await database();
  const id = randomUUID();
  const requestId = request.requestId ?? randomUUID();
  const started = Date.now();
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        userId,
        provider,
        request.model,
        request.task,
        request.cacheIdentity ?? request.prompt,
        modelCacheContract,
      ]),
    )
    .digest('hex');
  const base = [
    id,
    userId,
    runId,
    provider,
    request.model,
    request.task,
    requestId,
    request.cardId ?? null,
  ];
  const cached = (
    await db.query<{ result: unknown }>(
      'SELECT result FROM llm_cache WHERE cache_key=$1 AND expires_at>now()',
      [key],
    )
  ).rows[0];
  if (cached) {
    const parsed = schema.safeParse(cached.result);
    if (parsed.success) {
      await db.query(
        `INSERT INTO llm_usage(id,user_id,run_id,provider,model,task_type,request_id,card_id,status,cache_hit,estimated_cost,input_tokens,output_tokens,latency_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CACHED',true,0,0,0,0)`,
        base,
      );
      return {
        result: parsed.data,
        usageId: id,
        requestId,
        status: 'SUCCESS',
        error: null,
        estimatedCost: 0,
        cacheHit: true,
        warning: false,
      };
    }
    await db.query('DELETE FROM llm_cache WHERE cache_key=$1', [key]);
  }
  const enabled = process.env.LLM_PROVIDER === provider && !!process.env.LLM_API_KEY;
  const promptBytes = Buffer.byteLength(request.prompt);
  const permitted =
    enabled &&
    provider === 'deepseek' &&
    request.model === 'deepseek-v4-flash' &&
    promptBytes <= 16000 &&
    request.maxOutputTokens > 0 &&
    request.maxOutputTokens <= 1024;
  const reserve =
    ((promptBytes + 512) * flashPrice.input + request.maxOutputTokens * flashPrice.output) / 1e6;
  const day = new Date().toISOString().slice(0, 10);
  const buckets = [`global:${day}`, `user:${userId ?? 'anonymous'}:${day}`];
  const limits = [
    Number(process.env.LLM_DAILY_BUDGET_USD ?? '0.10'),
    Number(process.env.LLM_USER_DAILY_BUDGET_USD ?? '0.03'),
  ];
  let reason = permitted ? '' : 'PROVIDER_DISABLED_OR_UNPRICED';
  let warning = false;
  await db.transaction(async (tx) => {
    for (const b of buckets)
      await tx.query('INSERT INTO llm_budgets(bucket) VALUES($1) ON CONFLICT DO NOTHING', [b]);
    const balances = [];
    for (const b of buckets)
      balances.push(
        (
          await tx.query<{ spent: string; reserved: string }>(
            'SELECT spent,reserved FROM llm_budgets WHERE bucket=$1 FOR UPDATE',
            [b],
          )
        ).rows[0],
      );
    const calls = (
      await tx.query<{ n: number }>(
        "SELECT count(*)::int n FROM llm_usage WHERE created_at>=($1::date)::timestamp AT TIME ZONE 'UTC' AND status IN ('RUNNING','SUCCESS','FAILED')",
        [day],
      )
    ).rows[0].n;
    if (calls >= Number(process.env.LLM_MAX_CALLS_PER_DAY ?? '100')) reason = 'CALL_BUDGET';
    if (
      balances.some(
        (b, i) =>
          !Number.isFinite(limits[i]) ||
          limits[i] <= 0 ||
          Number(b.spent) + Number(b.reserved) + reserve > limits[i],
      )
    )
      reason = 'COST_BUDGET';
    warning = balances.some(
      (b, i) => (Number(b.spent) + Number(b.reserved) + reserve) / limits[i] >= 0.8,
    );
    await tx.query(
      `INSERT INTO llm_usage(id,user_id,run_id,provider,model,task_type,request_id,card_id,status,error_code,reserved_cost,price_basis) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        ...base,
        reason ? 'BLOCKED' : 'RUNNING',
        reason || null,
        reason ? 0 : reserve,
        JSON.stringify(flashPrice),
      ],
    );
    if (!reason)
      for (const b of buckets)
        await tx.query('UPDATE llm_budgets SET reserved=reserved+$2 WHERE bucket=$1', [b, reserve]);
  });
  if (reason)
    return {
      result: null,
      usageId: id,
      requestId,
      status: 'BLOCKED',
      error: reason,
      estimatedCost: null,
      cacheHit: false,
      warning,
    };
  let response: ModelResponse | undefined;
  let result: T | null = null;
  let error: string | null = null;
  try {
    response = await adapter.generate(request);
    if (response.finishReason === 'length') throw new Error('OUTPUT_TOKEN_LIMIT');
    result = schema.parse(
      typeof response.output === 'string' ? JSON.parse(response.output) : response.output,
    );
  } catch (e) {
    error =
      e instanceof z.ZodError
        ? 'OUTPUT_SCHEMA_INVALID'
        : e instanceof SyntaxError
          ? 'OUTPUT_JSON_INVALID'
          : e instanceof Error && /^(PROVIDER_HTTP_\d+|OUTPUT_TOKEN_LIMIT)$/.test(e.message)
            ? e.message
            : 'MODEL_OR_VALIDATION_FAILED';
  }
  const cost = response?.estimatedCost ?? null;
  await db.transaction(async (tx) => {
    // Unknown billing (timeout/crash) consumes its reservation conservatively; never counted as free.
    for (const b of buckets)
      await tx.query(
        'UPDATE llm_budgets SET reserved=GREATEST(0,reserved-$2),spent=spent+$3 WHERE bucket=$1',
        [b, reserve, cost ?? reserve],
      );
    await tx.query(
      'UPDATE llm_usage SET status=$2,error_code=$3,input_tokens=$4,output_tokens=$5,estimated_cost=$6,latency_ms=$7 WHERE id=$1',
      [
        id,
        error ? 'FAILED' : 'SUCCESS',
        error,
        response?.inputTokens ?? null,
        response?.outputTokens ?? null,
        cost,
        Date.now() - started,
      ],
    );
    if (result !== null)
      await tx.query(
        "INSERT INTO llm_cache(cache_key,user_id,result,expires_at) VALUES($1,$2,$3,now()+interval '1 hour') ON CONFLICT(cache_key) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at",
        [key, userId, JSON.stringify(result)],
      );
  });
  return {
    result,
    usageId: id,
    requestId,
    status: error ? 'FAILED' : 'SUCCESS',
    error,
    estimatedCost: cost,
    cacheHit: false,
    warning,
  };
}
export async function usageSummary(userId: string) {
  const db = await database();
  const dimensions = [
    'request_id',
    'card_id',
    "(created_at AT TIME ZONE 'UTC')::date",
    'model',
    'task_type',
  ];
  const names = ['request', 'card', 'userDay', 'model', 'task'];
  const result: Record<string, unknown> = {};
  for (let i = 0; i < dimensions.length; i++)
    result[names[i]] = (
      await db.query(
        `SELECT ${dimensions[i]} AS dimension,count(*)::int AS calls,count(*) FILTER(WHERE status='CACHED')::int AS cache_hits,sum(estimated_cost) AS estimated_cost,count(*) FILTER(WHERE estimated_cost IS NULL)::int AS unknown_costs FROM llm_usage WHERE user_id=$1 GROUP BY ${dimensions[i]}`,
        [userId],
      )
    ).rows;
  return result;
}
