/**
 * 対話型ログインセッション管理
 * Web UIからブラウザを操作してreCAPTCHA等を手動解決できる
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import config from '../config.js';
import logger from '../logger.js';

const SESSION_DIR = config.paths.session;

// グローバルシングルトン
const globalKey = Symbol.for('interactive-session');
if (!global[globalKey]) {
  global[globalKey] = {
    active: false,
    browser: null,
    context: null,
    page: null,
    status: 'idle', // idle | starting | ready | success | error
    message: '',
  };
}

const state = global[globalKey];

/**
 * 対話型セッションを開始
 * ブラウザ起動 → ログインページ → ID/PW自動入力 → スクリーンショット待機
 */
export async function startInteractiveSession() {
  if (state.active) {
    throw new Error('対話型セッションは既に起動中です');
  }

  state.active = true;
  state.status = 'starting';
  state.message = 'ブラウザを起動中...';

  try {
    mkdirSync(SESSION_DIR, { recursive: true });

    state.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
      ],
    });

    state.context = await state.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'ja-JP',
    });

    // ボット検出回避
    await state.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      if (!window.chrome) {
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
      }
      const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
      if (origQuery) {
        navigator.permissions.query = (params) =>
          params.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origQuery(params);
      }
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['ja', 'en-US', 'en'] });
    });

    state.page = await state.context.newPage();

    // ログインページへ
    state.message = 'ログインページを開いています...';
    await state.page.goto('https://auth.user.ameba.jp/signin', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // ID・パスワードが設定されていれば自動入力
    if (config.ameblo.id && config.ameblo.password) {
      await state.page.waitForSelector('#accountId', { timeout: 10000 });

      // ID入力
      await state.page.click('#accountId');
      await state.page.waitForTimeout(300);
      await state.page.keyboard.press('Control+a');
      await state.page.keyboard.press('Backspace');
      for (const char of config.ameblo.id) {
        await state.page.keyboard.type(char, { delay: 40 + Math.random() * 60 });
      }
      await state.page.waitForTimeout(500);

      // パスワード入力
      await state.page.click('#password');
      await state.page.waitForTimeout(300);
      await state.page.keyboard.press('Control+a');
      await state.page.keyboard.press('Backspace');
      for (const char of config.ameblo.password) {
        await state.page.keyboard.type(char, { delay: 40 + Math.random() * 60 });
      }
      await state.page.waitForTimeout(500);

      state.message = 'ID・パスワードを入力しました。reCAPTCHAが表示されている場合はチェックしてから「ログイン」ボタンをクリックしてください。';
    } else {
      state.message = 'ID・パスワードを入力してからログインしてください。';
    }

    state.status = 'ready';
    logger.info('対話型セッション: 準備完了');
  } catch (err) {
    state.status = 'error';
    state.message = `起動エラー: ${err.message}`;
    logger.error(`対話型セッション起動エラー: ${err.message}`);
    await closeInteractiveSession();
    throw err;
  }
}

/**
 * 現在のスクリーンショットを取得（JPEG base64）
 */
export async function getScreenshot() {
  if (!state.page) return null;
  try {
    const buffer = await state.page.screenshot({ type: 'jpeg', quality: 75 });
    return buffer.toString('base64');
  } catch {
    return null;
  }
}

/**
 * 指定座標をクリック
 */
export async function clickAt(x, y) {
  if (!state.page) throw new Error('セッションが起動していません');

  logger.info(`対話型セッション: クリック (${x}, ${y})`);
  await state.page.mouse.click(Math.round(x), Math.round(y));
  await state.page.waitForTimeout(2000);

  // ログイン成功チェック
  await checkLoginSuccess();
}

/**
 * ログイン成功したかチェック → 成功ならセッション保存
 */
async function checkLoginSuccess() {
  if (!state.page) return;

  const url = state.page.url();
  logger.info(`対話型セッション: 現在のURL = ${url}`);

  if (
    !url.includes('signin') &&
    !url.includes('auth.user.ameba.jp/connect') &&
    !url.includes('auth.user.ameba.jp/signin')
  ) {
    // ログイン成功！
    state.status = 'success';
    state.message = 'ログイン成功！セッションを保存しました。';
    logger.info('対話型セッション: ログイン成功 - セッション保存');

    try {
      const sessionState = await state.context.storageState();
      writeFileSync(
        resolve(SESSION_DIR, 'state.json'),
        JSON.stringify(sessionState)
      );
    } catch (err) {
      logger.error(`セッション保存エラー: ${err.message}`);
    }

    // ブラウザを閉じる
    await closeInteractiveSession();
  }
}

/**
 * セッションを閉じる
 */
export async function closeInteractiveSession() {
  try {
    if (state.browser) {
      await state.browser.close();
    }
  } catch {}
  state.browser = null;
  state.context = null;
  state.page = null;
  state.active = false;
  if (state.status !== 'success') {
    state.status = 'idle';
    state.message = '';
  }
}

/**
 * 現在の状態を取得
 */
export function getSessionState() {
  // セッションファイルの存在確認
  const hasSession = existsSync(resolve(SESSION_DIR, 'state.json'));

  return {
    active: state.active,
    status: state.status,
    message: state.message,
    hasSession,
  };
}
