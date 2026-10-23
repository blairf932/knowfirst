import type { DB } from './db';

// A failed close is sticky: opening another instance could corrupt the same directory.
export class DatabaseLifecycle {
  private opening?: Promise<DB>;
  private closing?: Promise<void>;
  private fault?: unknown;
  constructor(private readonly connect: () => Promise<DB>) {}

  open(): Promise<DB> {
    if (this.closing) return this.closing.then(() => this.open());
    if (this.fault) return Promise.reject(this.fault);
    if (!this.opening) {
      this.opening = this.connect()
        .then((raw) => {
          let accepting = true;
          const pending = new Set<Promise<unknown>>();
          const run = <T>(fn: () => Promise<T>): Promise<T> => {
            if (!accepting) return Promise.reject(new Error('Database is closing or closed'));
            const work = Promise.resolve().then(fn);
            pending.add(work);
            void work.then(
              () => pending.delete(work),
              () => pending.delete(work),
            );
            return work;
          };
          const managed: DB = {
            query: (sql, params) => run(() => raw.query(sql, params)),
            exec: (sql) => run(() => raw.exec(sql)),
            transaction: (fn) => run(() => raw.transaction(fn)),
            close: () => {
              if (!accepting)
                return (
                  this.closing ?? (this.fault ? Promise.reject(this.fault) : Promise.resolve())
                );
              return this.close();
            },
          };
          this.stopAccepting = () => {
            accepting = false;
          };
          this.dispose = async () => {
            accepting = false;
            await Promise.allSettled([...pending]);
            await raw.close();
          };
          return managed;
        })
        .catch((error) => {
          this.opening = undefined;
          if (error instanceof UnsafeDatabaseCleanup) this.fault = error;
          throw error;
        });
    }
    return this.opening;
  }
  private stopAccepting?: () => void;
  private dispose?: () => Promise<void>;
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.fault) return Promise.reject(this.fault);
    const opening = this.opening;
    this.stopAccepting?.();
    if (!opening) return Promise.resolve();
    this.closing = (async () => {
      // A rejected open already performed its own cleanup; preserve that original error.
      await opening;
      try {
        await this.dispose!();
      } catch (error) {
        this.fault = error;
        throw error;
      } finally {
        this.opening = undefined;
        this.dispose = undefined;
      }
    })().finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
}
export class UnsafeDatabaseCleanup extends AggregateError {
  constructor(original: unknown, cleanup: unknown) {
    super(
      [original, cleanup],
      'Database cleanup failed; lock retained. Stop and inspect before reopening.',
      { cause: original },
    );
  }
}
