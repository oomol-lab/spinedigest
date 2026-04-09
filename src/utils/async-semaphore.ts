export class AsyncSemaphore {
  #activeCount = 0;
  readonly #concurrency: number;
  readonly #pendingResolvers: Array<() => void> = [];

  public constructor(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError("concurrency must be a positive integer");
    }

    this.#concurrency = concurrency;
  }

  public async use<T>(operation: () => Promise<T>): Promise<T> {
    await this.#acquire();

    try {
      return await operation();
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#activeCount < this.#concurrency) {
      this.#activeCount += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.#pendingResolvers.push(() => {
        this.#activeCount += 1;
        resolve();
      });
    });
  }

  #release(): void {
    this.#activeCount -= 1;

    const next = this.#pendingResolvers.shift();
    next?.();
  }
}
