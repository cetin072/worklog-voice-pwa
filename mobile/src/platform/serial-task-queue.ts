export function createSerialTaskQueue() {
  let tail: Promise<void> = Promise.resolve();

  return Object.freeze({
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    reset() {
      tail = Promise.resolve();
    },
  });
}
