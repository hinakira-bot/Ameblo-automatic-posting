import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import config from './config.js';
import logger from './logger.js';
import { loadPrompt, renderPrompt } from './prompt-manager.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const imageModel = genAI.getGenerativeModel({ model: config.gemini.imageModel });

/**
 * Gemini Image Preview で画像を生成し、ファイルに保存
 */
async function generateImage(prompt, outputPath, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      logger.info(`画像生成中 (試行${attempt + 1}): ${prompt.slice(0, 50)}...`);

      const result = await imageModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['image', 'text'],
        },
      });

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        if (part.inlineData) {
          const buffer = Buffer.from(part.inlineData.data, 'base64');
          writeFileSync(outputPath, buffer);
          logger.info(`画像保存: ${outputPath}`);
          return outputPath;
        }
      }

      logger.warn(`画像データが見つかりませんでした (試行${attempt + 1})`);
    } catch (err) {
      logger.warn(`画像生成エラー (試行${attempt + 1}): ${err.message}`);
      if (attempt < retries) {
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  logger.error(`画像生成失敗: ${prompt.slice(0, 50)}...`);
  return null;
}

/**
 * アイキャッチ画像を生成
 */
export async function generateEyecatch(keyword, title, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, 'eyecatch.png');

  const template = loadPrompt('image-eyecatch');
  const prompt = renderPrompt(template, { keyword, title });

  return generateImage(prompt, outputPath);
}

/**
 * h2見出し用の図解画像を生成
 */
export async function generateDiagrams(outline, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const template = loadPrompt('image-diagram');
  const results = [];

  for (let i = 0; i < outline.length; i++) {
    const section = outline[i];
    // まとめセクションは図解不要
    if (section.h2.includes('まとめ')) {
      results.push({ index: i, h2: section.h2, imagePath: null });
      continue;
    }

    const outputPath = resolve(outputDir, `diagram-${i}.png`);
    const description = section.diagramDescription || section.h2;

    const prompt = renderPrompt(template, {
      diagramDescription: description,
      sectionH2: section.h2,
      sectionH3s: section.h3s.join(', '),
    });

    // API負荷軽減のため間隔を空ける
    if (i > 0) await sleep(3000);

    const imagePath = await generateImage(prompt, outputPath);
    results.push({ index: i, h2: section.h2, imagePath });
  }

  return results;
}

/**
 * 全画像を一括生成
 */
export async function generateAllImages(article) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir = resolve(config.paths.images, timestamp);
  mkdirSync(outputDir, { recursive: true });

  logger.info(`=== 画像生成開始 (${outputDir}) ===`);

  // アイキャッチ生成
  const eyecatchPath = await generateEyecatch(article.keyword, article.title, outputDir);

  // 図解生成
  const diagrams = await generateDiagrams(article.outline, outputDir);

  const successCount = diagrams.filter((d) => d.imagePath).length;
  logger.info(
    `画像生成完了 - アイキャッチ: ${eyecatchPath ? 'OK' : 'NG'}, 図解: ${successCount}/${diagrams.length}枚`
  );

  return { eyecatchPath, diagrams, outputDir };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
