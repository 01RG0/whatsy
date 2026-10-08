export interface Env {
  BACKEND_URL: string;
  WORKER_SECRET: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const res = await fetch(`${env.BACKEND_URL}/internal/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WORKER_SECRET}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sync failed: ${res.status} ${text}`);
    }
    const data = await res.json() as { synced: number };
    console.log(`Sync complete: ${data.synced} conversations`);
  },
};
