/**
 * Next.js Instrumentation Hook
 * サーバー起動時に一度だけ実行される。自動投稿スケジューラーをここで初期化する。
 */

export async function register() {
  // Node.jsランタイムでのみ実行（Edge Runtimeでは不要）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initScheduler } = await import('./lib/scheduler.js');
    await initScheduler();
  }
}
