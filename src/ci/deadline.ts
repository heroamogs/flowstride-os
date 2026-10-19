/** Bound asynchronous plugin work while observing late rejections safely. */
export async function withDeadline<T>(operation: Promise<T> | T, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(operation), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Flowstride step exceeded its ${timeout}ms timeout.`)), timeout);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
