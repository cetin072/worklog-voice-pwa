export async function withRequestDeadline<T>(request: (signal: AbortSignal) => Promise<T>, milliseconds = 15000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([request(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error('연결이 지연되고 있어요. 네트워크를 확인하고 다시 시도해주세요.')); controller.abort(); }, milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}
