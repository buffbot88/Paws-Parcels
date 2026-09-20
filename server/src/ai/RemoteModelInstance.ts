export class RemoteModelInstance {
  constructor(readonly baseUrl: string) {}

  async ensureWarm(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  markUsed(): void {}

  async stop(): Promise<void> {}
}
