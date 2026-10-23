export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { stopScheduler, startScheduler } = await import('./lib/scheduler');
    const { closeDatabase } = await import('./lib/db');
    const global = globalThis as unknown as { frontierShutdown?: () => Promise<void> };
    global.frontierShutdown = async () => {
      await stopScheduler();
      await closeDatabase();
    };
    if (process.env.SCHEDULER_ENABLED === 'true') {
      const { seed } = await import('./lib/seed');
      await seed();
      startScheduler();
    }
  }
}
