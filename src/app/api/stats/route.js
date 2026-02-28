import { NextResponse } from 'next/server';
import { getStats } from '@/keyword-manager.js';
import { getPostLog } from '@/post-logger.js';

/** GET /api/stats — ダッシュボード統計 */
export async function GET() {
  try {
    const stats = getStats();
    const posts = getPostLog();

    // 最近5件の投稿
    const recentPosts = [...posts]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);

    // スケジューラー状態
    let scheduler = { initialized: false, schedule: null, running: false };
    try {
      const { getSchedulerStatus, ensureInitialized } = await import('@/lib/scheduler.js');
      ensureInitialized();
      scheduler = getSchedulerStatus();
    } catch { /* ignore */ }

    return NextResponse.json({ stats, recentPosts, scheduler });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
