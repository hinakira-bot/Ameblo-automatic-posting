import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import config from './config.js';
import logger from './logger.js';

const SESSION_DIR = config.paths.session;
const LOGIN_URL = 'https://auth.user.ameba.jp/signin';
const EDITOR_URL = 'https://blog.ameba.jp/ucs/entry/srventryinsertinput.do';

/**
 * ブラウザを起動（セッション付き・ボット検出回避）
 */
async function launchBrowser(headless = true) {
  mkdirSync(SESSION_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless,
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

  const context = await browser.newContext({
    storageState: existsSync(resolve(SESSION_DIR, 'state.json'))
      ? resolve(SESSION_DIR, 'state.json')
      : undefined,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'ja-JP',
  });

  // ボット検出回避: navigator.webdriver 等を隠す
  await context.addInitScript(() => {
    // navigator.webdriver を undefined に
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // chrome オブジェクトを偽装
    if (!window.chrome) {
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    }

    // permissions.query を偽装
    const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (origQuery) {
      navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    }

    // plugins を偽装（空だとヘッドレス検出される）
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // languages を偽装
    Object.defineProperty(navigator, 'languages', {
      get: () => ['ja', 'en-US', 'en'],
    });
  });

  return { browser, context };
}

/**
 * 人間らしいタイピング（ランダム遅延付き）
 */
async function humanType(page, selector, text) {
  await page.click(selector);
  await page.waitForTimeout(200 + Math.random() * 300);
  // フィールドを選択してクリア
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(100);
  // 1文字ずつタイプ（ランダム遅延）
  for (const char of text) {
    await page.keyboard.type(char, { delay: 30 + Math.random() * 80 });
  }
  await page.waitForTimeout(300 + Math.random() * 400);
}

/**
 * アメブロにログイン
 */
async function login(context) {
  const page = await context.newPage();

  try {
    // まずブログエディタに直接アクセスしてみる（セッションが有効なら開ける）
    logger.info('セッション確認中...');
    await page.goto(EDITOR_URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const checkUrl = page.url();
    if (checkUrl.includes('entry') || checkUrl.includes('blog.ameba.jp')) {
      logger.info('既にログイン済みです');
      await page.close();
      return true;
    }

    // ログインが必要 → 認証ページへ直接アクセス
    logger.info('アメブロにログイン中...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(2000);

    // ログイン済みの場合（/homeやブログページにリダイレクトされた）
    const afterNavUrl = page.url();
    if (afterNavUrl.includes('/home') || afterNavUrl.includes('blog.ameba.jp')) {
      logger.info('既にログイン済みです（セッション有効）');
      await saveSession(context);
      await page.close();
      return true;
    }

    // auth.user.ameba.jp/signin のフォームで認証
    logger.info(`認証ページ: ${page.url()}`);
    await page.waitForSelector('#accountId', { timeout: 15000 });

    // 人間らしいタイピングでフォーム入力（ボット検出回避）
    logger.info('ID入力中...');
    await humanType(page, '#accountId', config.ameblo.id);

    logger.info('パスワード入力中...');
    await humanType(page, '#password', config.ameblo.password);

    // 入力確認ログ
    const filledId = await page.$eval('#accountId', el => el.value).catch(() => '');
    const filledPw = await page.$eval('#password', el => el.value).catch(() => '');
    logger.info(`入力確認: ID=${filledId ? '入力済み' : '空'}, PW=${filledPw ? '入力済み' : '空'}`);

    await page.waitForTimeout(1000 + Math.random() * 1000);
    await page.click('button[type="submit"]');

    // ログイン完了を待機
    await page.waitForURL((url) => {
      const href = url.href;
      return !href.includes('signin') && !href.includes('/login') && !href.includes('auth.user.ameba.jp');
    }, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    const afterUrl = page.url();
    logger.info(`ログイン後URL: ${afterUrl}`);

    if (afterUrl.includes('signin') || afterUrl.includes('auth.user.ameba.jp/connect')) {
      // デバッグ用スクリーンショットを保存
      try {
        await page.screenshot({ path: resolve(config.paths.logs, 'login-failed.png'), fullPage: true });
        logger.info('ログイン失敗時のスクリーンショットを保存しました: logs/login-failed.png');
      } catch { /* ignore */ }

      // reCAPTCHA検出チェック
      const hasRecaptcha = await page.locator('iframe[src*="recaptcha"]').isVisible().catch(() => false);
      const pageText = await page.textContent('body').catch(() => '');
      logger.error(`ログイン失敗ページの内容: ${pageText.slice(0, 500)}`);

      if (hasRecaptcha || pageText.includes('ロボット') || pageText.includes('セキュリティチェック')) {
        throw new Error(`reCAPTCHAが表示されました。VPSのIPがボット判定されている可能性があります。しばらく時間をおいて再試行してください。(URL: ${afterUrl})`);
      }

      throw new Error(`ログインに失敗しました。ID/パスワードを確認してください。(URL: ${afterUrl})`);
    }

    await saveSession(context);
    logger.info('ログイン成功 - セッションを保存しました');
    await page.close();
    return true;
  } catch (err) {
    await page.close();
    throw err;
  }
}

async function saveSession(context) {
  const state = await context.storageState();
  const statePath = resolve(SESSION_DIR, 'state.json');
  const { writeFileSync } = await import('fs');
  writeFileSync(statePath, JSON.stringify(state));
}

/**
 * エディタ画面のモーダルダイアログを閉じる
 */
async function dismissModals(page) {
  try {
    // エディタ更新モーダル等を閉じる
    const modal = page.locator('dialog.spui-SemiModal[open]');
    if (await modal.isVisible().catch(() => false)) {
      logger.info('モーダルダイアログを閉じています...');
      // モーダル内の閉じるボタンやOKボタンを探す
      const closeBtn = modal.locator('button:has-text("とじる"), button:has-text("OK"), button:has-text("閉じる"), button[aria-label="閉じる"]').first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      } else {
        // JavaScriptでモーダルを閉じる
        await page.evaluate(() => {
          const dialogs = document.querySelectorAll('dialog[open]');
          dialogs.forEach(d => d.close());
        });
      }
      await page.waitForTimeout(1000);
      logger.info('モーダルを閉じました');
    }

    // オーバーレイ要素も削除
    await page.evaluate(() => {
      const overlays = document.querySelectorAll('._3h4C5, .spui-SemiModal');
      overlays.forEach(el => {
        if (el.tagName === 'DIALOG') {
          el.close();
        }
      });
    }).catch(() => {});
  } catch (err) {
    logger.debug(`モーダル閉じ処理: ${err.message}`);
  }
}

/**
 * 写真パネルを開く（アップロード前の準備）
 */
async function openPhotoPanel(page) {
  await page.locator('#sidepanel-accessoryTab-photos').click({ force: true });
  await page.waitForTimeout(1000);
  await page.locator('#js-photo-tabButton').click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  logger.info('写真パネルを開きました');
}

/**
 * 画像をアメブロにアップロード
 * APIレスポンスをインターセプトして画像URLを取得
 */
async function uploadImage(page, imagePath) {
  if (!imagePath || !existsSync(imagePath)) {
    logger.warn(`画像ファイルが見つかりません: ${imagePath}`);
    return null;
  }

  try {
    logger.info(`画像アップロード中: ${imagePath}`);

    // APIレスポンスのPromiseを先に設定（アップロード前に）
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/editor/image/upload') && resp.status() === 200,
      { timeout: 30000 }
    );

    // ファイル入力にセット（アップロードトリガー）
    await page.locator('#js-input-files').setInputFiles(imagePath);

    // APIレスポンスを待機・解析
    const response = await responsePromise;
    const data = await response.json();
    const originalUrl = data.imageInfo?.originalUrl || null;

    if (originalUrl) {
      logger.info(`画像アップロード完了: ${originalUrl}`);
    } else {
      logger.warn('画像URLの取得に失敗');
    }

    await page.waitForTimeout(2000);
    return originalUrl;
  } catch (err) {
    logger.warn(`画像アップロードエラー: ${err.message}`);
    return null;
  }
}

/**
 * カバー画像（アイキャッチ）を設定
 * アップロード済み画像から選択するモーダルを操作
 */
async function setCoverImage(page) {
  try {
    logger.info('カバー画像を設定中...');

    // 「画像を選択する」ボタンをクリック（#js-coverSelect）
    const selectBtn = page.locator('#js-coverSelect');
    if (!await selectBtn.isVisible().catch(() => false)) {
      logger.warn('カバー画像選択ボタンが見つかりません');
      return false;
    }
    await selectBtn.click();
    await page.waitForTimeout(2000);

    // カバー設定モーダルが開くのを待つ
    const modal = page.locator('.CoverSelectModal__body');
    await modal.waitFor({ state: 'visible', timeout: 10000 });

    // 画像グリッドの最初の画像をクリック（最新アップロードが自動選択されている場合もある）
    const gridItem = modal.locator('.CoverEditor__imageItem').first();
    if (await gridItem.isVisible().catch(() => false)) {
      await gridItem.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
    }

    // 「カバーに設定する」ボタンをクリック
    const confirmBtn = page.locator('button:has-text("カバーに設定する")');
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await confirmBtn.click();
    await page.waitForTimeout(2000);
    logger.info('カバー画像を設定しました');
    return true;
  } catch (err) {
    logger.warn(`カバー画像設定エラー: ${err.message}`);
    return false;
  }
}

/**
 * 画像付きHTMLを組み立て
 */
/**
 * <p>タグ内が極端に長い場合（5文以上）のみ分割する安全弁
 * アメブロ向けに1〜3文の自然な段落リズムを保つため、
 * 通常の段落はAI生成のままにする
 */
function splitLongParagraphs(html) {
  return html.replace(/<p>([\s\S]*?)<\/p>/g, (match, content) => {
    const trimmed = content.trim();
    if (!trimmed) return match;

    // ブロック要素や画像を含むpタグはそのまま
    if (/<(img|ul|ol|table|h[1-6]|div|blockquote)/i.test(trimmed)) return match;

    // 文の数をカウント（HTMLタグ外の「。」）
    let count = 0;
    let inTag = false;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '<') inTag = true;
      if (trimmed[i] === '>') { inTag = false; continue; }
      if (trimmed[i] === '。' && !inTag) count++;
    }

    // 4文以下ならそのまま（自然なリズム）
    if (count <= 4) return match;

    // 5文以上なら2〜3文ずつのグループに分割
    const sentences = [];
    let current = '';
    let sentenceCount = 0;
    inTag = false;

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '<') inTag = true;
      if (ch === '>') { inTag = false; current += ch; continue; }
      current += ch;

      if (ch === '。' && !inTag) {
        sentenceCount++;
        // 2〜3文ごとに段落を切る
        if (sentenceCount >= 2 + (sentences.length % 2)) {
          sentences.push(current.trim());
          current = '';
          sentenceCount = 0;
        }
      }
    }
    if (current.trim()) sentences.push(current.trim());
    if (sentences.length <= 1) return match;

    return sentences
      .filter(s => s.length > 0)
      .map(s => `<p>${s}</p>`)
      .join('\n<br />\n');
  });
}

/**
 * 連続する<p>タグ同士の間に<br />がなければ挿入する
 * ただしh2/h3/img直後のpや、リスト前後のpは除外
 */
function ensureLineBreaksBetweenParagraphs(html) {
  // </p>の直後（空白・改行のみ挟んで）<p>が来る場合、間に<br />を挿入
  // ただし既に<br />がある場合はスキップ
  return html.replace(/<\/p>([\s\n\r]*)(<p>)/g, (match, gap, nextP) => {
    // 既に<br>が含まれていればそのまま
    if (/\bbr\b/i.test(gap)) return match;
    return `</p>\n<br />\n${nextP}`;
  });
}

/** メルマガ誘導リンク */
const MAIL_MAGAZINE_URL = 'https://hinakira.net/p/r/RwKLzKtX';

/** 最初のh2見出し前に挿入するCTA（短め・テキストリンク＋特典軽く） */
function buildTopCta() {
  return [
    '<br />',
    '<p>━━━━━━━━━━━━━━━━━━</p>',
    '<br />',
    `<p>📩 GPTs動画・図解作成ツールなど<strong>無料特典つき</strong>！ <a href="${MAIL_MAGAZINE_URL}">ひなきらのAIメルマガはこちら</a></p>`,
    '<br />',
    '<p>━━━━━━━━━━━━━━━━━━</p>',
    '<br />',
  ].join('\n');
}

/** 記事末尾に挿入するCTA（特典詳細付き） */
function buildBottomCta() {
  return [
    '<br />',
    '<p>━━━━━━━━━━━━━━━━━━</p>',
    '<br />',
    `<p>📩 <strong>ここまで読んでくれたあなたへ</strong></p>`,
    '<br />',
    `<p>AIを使いこなすための情報を、メルマガで無料配信しています。</p>`,
    '<br />',
    `<p>🎁 <strong>今だけの登録特典つき！</strong></p>`,
    '<br />',
    '<ul>',
    '<li>GPTsの作り方動画をプレゼント</li>',
    '<li>有料級の図解作成ツールをプレゼント</li>',
    '<li>限定オープンチャットへご案内</li>',
    '</ul>',
    '<br />',
    '<p>さらに、最新のプロンプトやAIツールも随時プレゼントしています。</p>',
    '<br />',
    '<p>登録しておくだけで「得する」情報が届くので、ぜひチェックしてみてくださいね。</p>',
    '<br />',
    `<p>👉 <a href="${MAIL_MAGAZINE_URL}">無料メルマガに登録する</a></p>`,
    '<br />',
    '<p>━━━━━━━━━━━━━━━━━━</p>',
  ].join('\n');
}

/**
 * AIがMarkdown記法を混在させた場合にHTMLへ変換する
 */
function convertMarkdownToHtml(html) {
  // ### 見出し → <h3>
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  // ## 見出し → <h2>
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  // **太字** → <strong>（HTMLタグ内は除く）
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return html;
}

function buildPostHtml(article, images) {
  let html = '';

  // アイキャッチ画像（本文先頭に挿入）
  if (images.eyecatchUrl) {
    html += `<p><img src="${images.eyecatchUrl}" alt="${article.title}" /></p>\n`;
  }

  // Markdown記法が混在していたらHTMLに変換
  let bodyHtml = convertMarkdownToHtml(article.bodyHtml);

  // 本文を追加（極端に長い段落のみ分割）
  html += splitLongParagraphs(bodyHtml);

  // 連続する段落間に<br />を補完（アメブロで空行を表示するため）
  html = ensureLineBreaksBetweenParagraphs(html);

  // --- メルマガCTA挿入 ---
  // 1) 最初のh2見出しの直前に挿入
  const firstH2Match = html.match(/<h2[^>]*>/);
  if (firstH2Match) {
    const pos = html.indexOf(firstH2Match[0]);
    html = html.slice(0, pos) + buildTopCta() + '\n' + html.slice(pos);
  }

  // 2) 記事の一番最後に挿入
  html += '\n' + buildBottomCta();

  return html;
}

/**
 * 記事を投稿
 */
export async function postToAmeblo(article, imageFiles) {
  logger.info(`=== アメブロ投稿開始: "${article.title}" ===`);

  if (config.dryRun) {
    logger.info('[ドライラン] 実際の投稿はスキップされます');
    return { success: true, dryRun: true, title: article.title };
  }

  const { browser, context } = await launchBrowser();

  try {
    // ログイン
    await login(context);

    const page = await context.newPage();
    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000);

    // CKEditorの読み込みを待つ
    await page.waitForSelector('#cke_amebloeditor', { timeout: 30000 });
    logger.info('エディタの読み込み完了');

    // モーダルダイアログが表示されていたら閉じる（エディタ更新通知など）
    await dismissModals(page);

    // --- 画像アップロード ---
    const imageUrls = { eyecatchUrl: null, diagramUrls: [] };
    const hasImages = imageFiles.eyecatchPath || (imageFiles.diagrams || []).some(d => d.imagePath);

    if (hasImages) {
      // 写真パネルを開く（ファイル入力を有効にする）
      await openPhotoPanel(page);
    }

    if (imageFiles.eyecatchPath) {
      imageUrls.eyecatchUrl = await uploadImage(page, imageFiles.eyecatchPath);
    }

    for (const diagram of imageFiles.diagrams || []) {
      if (diagram.imagePath) {
        const url = await uploadImage(page, diagram.imagePath);
        imageUrls.diagramUrls.push({
          index: diagram.index,
          h2: diagram.h2,
          url,
        });
      }
    }

    // --- カバー画像設定（アップロード済み画像から選択） ---
    if (imageUrls.eyecatchUrl) {
      await setCoverImage(page);
    }

    // --- HTML組み立て ---
    const postHtml = buildPostHtml(article, imageUrls);

    // --- タイトル入力 ---
    logger.info('タイトルを入力中...');
    await page.fill('input[name="entry_title"]', article.title);

    // --- 本文入力（CKEditor API経由） ---
    logger.info('本文を入力中...');

    // CKEditor APIで直接HTMLを設定（モーダル干渉を回避）
    await page.evaluate((html) => {
      if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances.amebloeditor) {
        CKEDITOR.instances.amebloeditor.setData(html);
      }
    }, postHtml);
    await page.waitForTimeout(2000);

    // CKEditor APIが使えなかった場合のフォールバック
    const editorContent = await page.evaluate(() => {
      if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances.amebloeditor) {
        return CKEDITOR.instances.amebloeditor.getData();
      }
      return '';
    });

    if (!editorContent || editorContent.length < 100) {
      logger.info('CKEditor APIでの設定に失敗、HTML表示モードで入力します...');
      // モーダルを再度閉じる
      await dismissModals(page);
      // HTML表示モードに切り替え（force: trueでクリック）
      await page.locator('#js-editorModeButton--source').click({ force: true });
      await page.waitForTimeout(1000);
      const sourceTextarea = page.locator('textarea.cke_source');
      await sourceTextarea.waitFor({ state: 'visible', timeout: 10000 });
      await sourceTextarea.fill(postHtml);
      await page.waitForTimeout(1000);
      // 通常表示に戻す
      await page.locator('#js-editorModeButton--wysiwyg').click({ force: true });
      await page.waitForTimeout(2000);
    }

    logger.info('本文入力完了');

    // --- 投稿ボタン ---
    logger.info('記事を投稿中...');
    // モーダルを閉じてから投稿
    await dismissModals(page);
    await page.locator('button.js-submitButton:has-text("投稿する")').click({ force: true });

    // 投稿完了を待機
    await page.waitForTimeout(5000);

    // 確認ダイアログが出た場合の対応
    const confirmBtn = page.locator('button:has-text("OK"), button:has-text("投稿する")').last();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click({ force: true });
      await page.waitForTimeout(5000);
    }

    const finalUrl = page.url();
    logger.info(`投稿完了: ${finalUrl}`);

    // セッション保存（失敗しても投稿自体は成功扱い）
    try {
      await saveSession(context);
    } catch (sessionErr) {
      logger.warn(`セッション保存エラー（投稿は成功）: ${sessionErr.message}`);
    }

    await browser.close();
    return { success: true, url: finalUrl, title: article.title };
  } catch (err) {
    logger.error(`投稿エラー: ${err.message}`);
    logger.error(err.stack);
    try { await browser.close(); } catch { /* ignore */ }
    return { success: false, error: err.message, title: article.title };
  }
}

/**
 * ログインテスト用
 */
export async function testLogin() {
  const { browser, context } = await launchBrowser(false);
  try {
    await login(context);
    logger.info('ログインテスト成功');
    await browser.close();
    return true;
  } catch (err) {
    logger.error(`ログインテスト失敗: ${err.message}`);
    await browser.close();
    return false;
  }
}
