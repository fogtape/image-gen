/**
 * Simple async mutex for serializing critical sections.
 * Prevents concurrent read-modify-write races in async code.
 */
export function createMutex() {
  let chain = Promise.resolve();
  return function withLock(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
}
