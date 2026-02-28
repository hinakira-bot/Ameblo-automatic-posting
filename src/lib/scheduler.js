/**
 * 自動投稿スケジューラー
 * Next.js サーバー起動時にcronジョブを開始し、settings.jsonのスケジュールに従って自動投稿する
 */

import cron from 'node-cron';

// グローバルシングルトン（Next.js HMRでも維持）
const globalKey = Symbol.for('cron-scheduler');
if (!global[globalKey]) {
  global[globalKey] = {
    tasks: [],       // 複数cronジョブに対応
    currentSchedule: null,
    initialized: false,
  };
}

const schedulerState = global[globalKey];

/** パイプライン実行のコールバック */
async function executeScheduledPost() {
  let logger;
  try {
    logger = (await import('../logger.js')).default;
  } catch {
    logger = console;
  }

  logger.info('[Scheduler] --- スケジュール自動投稿 実行開始 ---');

  // パイプラインが既に実行中かチェック
  const { getStatus, startPipeline } = await import('./pipeline-runner.js');
  const status = getStatus();
  if (status.running) {
    logger.warn('[Scheduler] パイプラインが既に実行中のためスキップ');
    return;
  }

  try {
    await startPipeline({ dryRun: false });
    logger.info('[Scheduler] スケジュール実行を開始しました');
  } catch (err) {
    logger.error(`[Scheduler] スケジュール実行エラー: ${err.message}`);
  }
}

/**
 * スケジューラーを初期化（サーバー起動時に1回だけ呼ばれる）
 */
export async function initScheduler() {
  if (schedulerState.initialized) return;
  schedulerState.initialized = true;

  try {
    const { loadSettings } = await import('../settings-manager.js');
    const settings = loadSettings();
    const schedule = settings.posting?.cronSchedule || '0 9 * * *';

    startCron(schedule);

    const { default: logger } = await import('../logger.js');
    logger.info(`[Scheduler] 自動投稿スケジューラーを開始: ${schedule} (Asia/Tokyo)`);
  } catch (err) {
    console.error('[Scheduler] 初期化エラー:', err.message);
  }
}

/**
 * 全てのcronジョブを停止
 */
function stopAllTasks() {
  for (const task of schedulerState.tasks) {
    try {
      task.stop();
    } catch { /* ignore */ }
  }
  schedulerState.tasks = [];
}

/**
 * cronジョブを開始（既存のジョブがあれば停止してから）
 * セミコロン区切りで複数のcron式に対応
 * @param {string} schedule - cron式（セミコロン区切りで複数可）
 */
export function startCron(schedule) {
  // 既存のジョブを全て停止
  stopAllTasks();

  // セミコロン区切りで分割（daily2で分が異なる場合）
  const schedules = schedule.split(';').map(s => s.trim()).filter(Boolean);

  for (const sched of schedules) {
    if (!cron.validate(sched)) {
      console.error(`[Scheduler] 無効なcronスケジュール: ${sched}`);
      continue;
    }

    const task = cron.schedule(sched, executeScheduledPost, {
      timezone: 'Asia/Tokyo',
    });
    schedulerState.tasks.push(task);
  }

  schedulerState.currentSchedule = schedule;
  return schedulerState.tasks.length > 0;
}

/**
 * スケジューラーの状態を取得
 */
export function getSchedulerStatus() {
  return {
    initialized: schedulerState.initialized,
    schedule: schedulerState.currentSchedule,
    running: schedulerState.tasks.length > 0,
  };
}

/**
 * スケジュールを再設定（設定変更時に呼ぶ）
 */
export async function restartScheduler() {
  try {
    const { loadSettings } = await import('../settings-manager.js');
    const settings = loadSettings();
    const schedule = settings.posting?.cronSchedule || '0 9 * * *';

    startCron(schedule);

    const { default: logger } = await import('../logger.js');
    logger.info(`[Scheduler] スケジュール再設定: ${schedule} (Asia/Tokyo)`);
    return true;
  } catch (err) {
    console.error('[Scheduler] 再設定エラー:', err.message);
    return false;
  }
}

/**
 * スケジューラーが未初期化なら初期化（API Routeからのフォールバック用）
 */
export function ensureInitialized() {
  if (!schedulerState.initialized) {
    initScheduler();
  }
}
