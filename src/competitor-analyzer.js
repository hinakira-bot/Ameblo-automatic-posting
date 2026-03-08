import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import config from './config.js';
import logger from './logger.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

/**
 * Gemini + Google Search Grounding で検索意図と競合情報を取得
 */
async function searchWithGemini(keyword) {
  logger.info(`Gemini Google Search で分析中: "${keyword}"`);

  const model = genAI.getGenerativeModel({
    model: config.gemini.textModel,
    tools: [{ googleSearch: {} }],
  });

  const prompt = `以下のキーワードでGoogle検索した場合の上位記事を分析してください。

キーワード: "${keyword}"

以下の情報をJSON形式で出力してください。JSON以外のテキストは不要です。
{
  "searchResults": [
    { "title": "記事タイトル", "url": "URL", "snippet": "概要" }
  ],
  "topHeadings": [
    {
      "articleTitle": "記事タイトル",
      "headings": [
        { "tag": "h2", "text": "見出しテキスト" }
      ]
    }
  ],
  "searchIntent": "informational / navigational / transactional / commercial のいずれか",
  "commonTopics": ["よく扱われているトピック1", "トピック2", "トピック3"],
  "avgWordCount": 3000,
  "avgH2Count": 5
}

上位5〜10件の記事について分析してください。`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJSON(text);
}

/**
 * 上位記事のURLから直接見出し構造を抽出（補助）
 */
async function extractHeadings(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    const headings = [];
    $('h1, h2, h3').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      const text = $(el).text().trim();
      if (text && text.length < 200) {
        headings.push({ tag, text });
      }
    });

    const bodyText = $('article, .entry-content, .post-content, main, .content')
      .first()
      .text()
      .trim();
    const charCount = bodyText.length || $('body').text().trim().length;

    return { url, headings, charCount };
  } catch (err) {
    logger.debug(`ページ取得失敗 (${url}): ${err.message}`);
    return null;
  }
}

/**
 * キーワードの競合分析（メイン）
 */
export async function analyzeCompetitors(keyword) {
  logger.info(`=== 競合分析開始: "${keyword}" ===`);

  // Gemini + Google Search で分析
  const geminiAnalysis = await searchWithGemini(keyword);

  // 上位記事のURLがあれば直接見出しも取得
  const urls = (geminiAnalysis.searchResults || [])
    .map((r) => r.url)
    .filter((u) => u && u.startsWith('http'))
    .slice(0, 3);

  let articles = [];
  if (urls.length > 0) {
    logger.info(`上位${urls.length}記事の見出しを直接取得中...`);
    const results = await Promise.all(urls.map((u) => extractHeadings(u)));
    articles = results.filter(Boolean);
  }

  const summary = {
    keyword,
    totalArticles: geminiAnalysis.searchResults?.length || 0,
    avgCharCount: geminiAnalysis.avgWordCount || 3000,
    commonH2Count: geminiAnalysis.avgH2Count || 5,
    searchIntent: geminiAnalysis.searchIntent || 'informational',
    commonTopics: geminiAnalysis.commonTopics || [],
    topHeadings: geminiAnalysis.topHeadings || [],
  };

  logger.info(
    `分析完了 - 検索意図: ${summary.searchIntent}, 平均文字数: ${summary.avgCharCount}`
  );

  return {
    keyword,
    searchResults: geminiAnalysis.searchResults || [],
    articles,
    summary,
  };
}

/**
 * 競合分析結果をプロンプト用テキストに変換
 */
export function formatAnalysisForPrompt(analysis) {
  let text = `## 競合分析データ\n`;
  text += `キーワード: ${analysis.keyword}\n`;
  text += `分析記事数: ${analysis.summary?.totalArticles || 0}件\n`;
  text += `平均文字数: ${analysis.summary?.avgCharCount || 0}字\n`;
  text += `平均h2数: ${analysis.summary?.commonH2Count || 0}個\n`;
  text += `検索意図: ${analysis.summary?.searchIntent || '不明'}\n`;
  text += `共通トピック: ${(analysis.summary?.commonTopics || []).join(', ')}\n\n`;

  text += `### 検索結果タイトル一覧\n`;
  for (const r of (analysis.searchResults || []).slice(0, 10)) {
    text += `- ${r.title}\n`;
  }

  if (analysis.summary?.topHeadings?.length > 0) {
    text += `\n### 上位記事の見出し構成 (Gemini分析)\n`;
    for (const article of analysis.summary.topHeadings) {
      text += `\n--- ${article.articleTitle} ---\n`;
      for (const h of article.headings || []) {
        const indent = h.tag === 'h3' ? '  ' : '';
        text += `${indent}[${h.tag}] ${h.text}\n`;
      }
    }
  }

  if (analysis.articles?.length > 0) {
    text += `\n### 上位記事の見出し構成 (直接取得)\n`;
    for (const article of analysis.articles) {
      text += `\n--- ${article.url} (${article.charCount}字) ---\n`;
      for (const h of article.headings) {
        const indent = h.tag === 'h3' ? '  ' : '';
        text += `${indent}[${h.tag}] ${h.text}\n`;
      }
    }
  }

  return text;
}

/**
 * Gemini + Google Search Grounding で最新情報を取得
 */
export async function searchLatestNews(keyword) {
  logger.info(`最新情報を検索中: "${keyword}"`);

  const model = genAI.getGenerativeModel({
    model: config.gemini.textModel,
    tools: [{ googleSearch: {} }],
  });

  const currentDate = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const prompt = `以下のキーワードに関する最新情報・最新ニュースを徹底的に調査してください。

キーワード: "${keyword}"
調査日: ${currentDate}

## 調査の重点ポイント

### 1. 基本情報の正確性（最重要）
- **ツール・サービスの正式名称**を必ず公式サイトで確認してください
- **料金プラン・価格**は公式の料金ページから正確な数値を取得してください
- **AIモデル名・バージョン**は公式ドキュメントの最新情報を確認してください
- **機能・スペック**は公式の仕様ページから取得してください
- 名称の表記ゆれ（例: ChatGPT vs Chat GPT）に注意し、公式表記に統一してください

### 2. 最新情報
- ${currentYear}年の最新ニュース・トレンド・アップデート
- 最近発表されたデータ・統計・調査結果
- 業界の最新動向・変化・新サービス
- 法改正・制度変更など最新の公式情報
- 料金改定・プラン変更があった場合は特に詳しく

### 3. 情報の信頼性
- 公式サイト・公式ブログ・公式ドキュメントを最優先の情報源としてください
- 情報源は必ず明記してください
- 古い情報と最新情報が混在しないよう注意してください

以下のJSON形式で出力してください。JSON以外のテキストは不要です。
{
  "latestNews": [
    {
      "title": "ニュースのタイトルや要約",
      "detail": "具体的な内容（数値・日付含む）",
      "source": "情報源（公式サイトURL等）",
      "date": "発表日・掲載日（わかる範囲）",
      "reliability": "high / medium / low（情報の信頼度）"
    }
  ],
  "officialInfo": {
    "toolName": "ツール・サービスの正式名称（該当する場合）",
    "pricing": "最新の料金情報（該当する場合）",
    "models": "最新のモデル名・バージョン（該当する場合）",
    "lastUpdated": "公式情報の最終更新日（わかる範囲）"
  },
  "trends": ["最新トレンド1", "最新トレンド2"],
  "keyInsights": "記事に反映すべき重要な最新ポイントの要約（300字以内）",
  "cautionNotes": "記事作成時に注意すべき点（古い情報の混同、名称間違いなど）"
}

最新で信頼性の高い情報を5〜15件程度取得してください。公式サイトの情報を最優先してください。`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseJSON(text);
    logger.info(`最新情報: ${parsed.latestNews?.length || 0}件取得`);
    return parsed;
  } catch (err) {
    logger.warn(`最新情報検索エラー: ${err.message}`);
    return { latestNews: [], trends: [], keyInsights: '' };
  }
}

/**
 * ファクトチェック: ツール名・モデル名・料金などの正確性を検証
 * Google Search Groundingで公式情報を再確認する
 */
export async function verifyFacts(keyword, latestNews) {
  logger.info(`ファクトチェック実行中: "${keyword}"`);

  const model = genAI.getGenerativeModel({
    model: config.gemini.textModel,
    tools: [{ googleSearch: {} }],
  });

  // 検証対象の情報を整理
  const officialInfo = latestNews?.officialInfo || {};
  const newsItems = (latestNews?.latestNews || []).slice(0, 5);

  const currentDate = new Date().toISOString().split('T')[0];
  const prompt = `以下のキーワードに関する情報の正確性を、公式サイトや公式ドキュメントを確認してファクトチェックしてください。

キーワード: "${keyword}"
確認日: ${currentDate}

## 確認済みの情報
${officialInfo.toolName ? `ツール名: ${officialInfo.toolName}` : ''}
${officialInfo.pricing ? `料金情報: ${officialInfo.pricing}` : ''}
${officialInfo.models ? `モデル情報: ${officialInfo.models}` : ''}

## ニュース情報
${newsItems.map((n, i) => `${i + 1}. ${n.title}: ${n.detail}`).join('\n')}

## 確認事項
1. 上記の情報に誤りがないか、公式サイトで確認してください
2. ツール・サービスの正式名称は正しいですか？
3. 料金・価格に変更はありませんか？（最新の公式料金ページを確認）
4. モデル名・バージョンは最新ですか？
5. 廃止されたサービス・機能を含んでいませんか？

以下のJSON形式で出力してください。JSON以外のテキストは不要です。
{
  "verified": true,
  "corrections": [
    {
      "original": "元の情報",
      "corrected": "正しい情報",
      "source": "確認元の公式URL",
      "type": "naming / pricing / model / feature / date"
    }
  ],
  "confirmedFacts": [
    "確認できた正確な事実1",
    "確認できた正確な事実2"
  ],
  "warnings": ["記事作成時の注意点1", "注意点2"]
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseJSON(text);
    const correctionCount = parsed.corrections?.length || 0;
    if (correctionCount > 0) {
      logger.warn(`ファクトチェック: ${correctionCount}件の修正あり`);
      for (const c of parsed.corrections) {
        logger.warn(`  修正: "${c.original}" → "${c.corrected}" (${c.type})`);
      }
    } else {
      logger.info('ファクトチェック: 修正なし（情報は正確）');
    }
    return parsed;
  } catch (err) {
    logger.warn(`ファクトチェックエラー: ${err.message}`);
    return { verified: false, corrections: [], confirmedFacts: [], warnings: [] };
  }
}

/**
 * ファクトチェック結果をプロンプト用テキストに変換
 */
export function formatFactCheckForPrompt(factCheck) {
  if (!factCheck || (!factCheck.corrections?.length && !factCheck.confirmedFacts?.length)) {
    return '';
  }

  let text = `## ファクトチェック結果\n`;
  text += `以下の情報は公式サイトで検証済みです。記事中でこれらの情報に言及する場合は、必ずこの検証済み情報を使用してください。\n\n`;

  if (factCheck.corrections?.length > 0) {
    text += `### 修正が必要な情報（重要）\n`;
    text += `以下の情報は誤りが見つかりました。修正後の情報を使用してください：\n`;
    for (const c of factCheck.corrections) {
      text += `- **誤**: ${c.original} → **正**: ${c.corrected}`;
      if (c.source) text += ` (出典: ${c.source})`;
      text += `\n`;
    }
    text += `\n`;
  }

  if (factCheck.confirmedFacts?.length > 0) {
    text += `### 確認済みの正確な情報\n`;
    for (const fact of factCheck.confirmedFacts) {
      text += `- ${fact}\n`;
    }
    text += `\n`;
  }

  if (factCheck.warnings?.length > 0) {
    text += `### 注意事項\n`;
    for (const w of factCheck.warnings) {
      text += `- ${w}\n`;
    }
  }

  return text;
}

/**
 * 最新情報をプロンプト用テキストに変換
 */
export function formatLatestNewsForPrompt(latestNews) {
  if (!latestNews || (!latestNews.latestNews?.length && !latestNews.keyInsights)) {
    return '';
  }

  let text = `## 最新情報（${new Date().getFullYear()}年）\n`;

  if (latestNews.keyInsights) {
    text += `\n### 重要ポイント\n${latestNews.keyInsights}\n`;
  }

  if (latestNews.trends?.length > 0) {
    text += `\n### 最新トレンド\n`;
    for (const trend of latestNews.trends) {
      text += `- ${trend}\n`;
    }
  }

  if (latestNews.officialInfo) {
    const info = latestNews.officialInfo;
    if (info.toolName || info.pricing || info.models) {
      text += `\n### 公式情報（正確性が高い情報）\n`;
      if (info.toolName) text += `- 正式名称: ${info.toolName}\n`;
      if (info.pricing) text += `- 料金情報: ${info.pricing}\n`;
      if (info.models) text += `- モデル情報: ${info.models}\n`;
      if (info.lastUpdated) text += `- 最終更新: ${info.lastUpdated}\n`;
    }
  }

  if (latestNews.latestNews?.length > 0) {
    text += `\n### 最新ニュース\n`;
    for (const news of latestNews.latestNews) {
      text += `- **${news.title}**: ${news.detail}`;
      if (news.date) text += ` (${news.date})`;
      if (news.source) text += ` [出典: ${news.source}]`;
      text += `\n`;
    }
  }

  if (latestNews.cautionNotes) {
    text += `\n### 注意事項\n${latestNews.cautionNotes}\n`;
  }

  return text;
}

/** JSONパーサー */
function parseJSON(text) {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    logger.warn(`JSON解析失敗、デフォルト値を使用: ${e.message}`);
    return {
      searchResults: [],
      topHeadings: [],
      searchIntent: 'informational',
      commonTopics: [],
      avgWordCount: 3000,
      avgH2Count: 5,
    };
  }
}
