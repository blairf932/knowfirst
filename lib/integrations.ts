// Candidate package names were verified in the vendors' official integration documentation.
// This registry is a collection allowlist, not evidence that an integration works.
export const integrationConfigs = [
  {
    entityId: 'mem0',
    package: '@mem0/openclaw-mem0',
    docs: 'https://docs.mem0.ai/integrations/openclaw',
  },
  {
    entityId: 'supermemory',
    package: '@supermemory/openclaw-supermemory',
    docs: 'https://supermemory.ai/docs/integrations/openclaw',
  },
];
export const packageUrl = (name: string) =>
  `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`;
