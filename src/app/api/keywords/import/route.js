import { NextResponse } from 'next/server';
import { listKeywords, addKeyword } from '@/keyword-manager.js';

/**
 * CSVテキストをパースして行の配列を返す
 * ダブルクォート内のカンマ・改行にも対応
 */
function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  const chars = [...text];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (inQuotes) {
      if (ch === '"') {
        // エスケープされたダブルクォート
        if (chars[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        rows.push(current);
        current = '';
      } else if (ch === '\n' || (ch === '\r' && chars[i + 1] === '\n')) {
        rows.push(current);
        current = '';
        if (ch === '\r') i++; // skip \n
        return { fields: rows, rest: chars.slice(i + 1).join('') };
      } else if (ch === '\r') {
        rows.push(current);
        current = '';
        return { fields: rows, rest: chars.slice(i + 1).join('') };
      } else {
        current += ch;
      }
    }
  }

  rows.push(current);
  return { fields: rows, rest: '' };
}

/**
 * CSV全体をパースして行の配列を返す
 */
function parseCSVAll(text) {
  // BOM除去
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];

  const allRows = [];
  let remaining = cleaned;

  while (remaining.length > 0) {
    const { fields, rest } = parseCSV(remaining);
    allRows.push(fields);
    remaining = rest;
  }

  return allRows;
}

/** POST /api/keywords/import — CSVインポート */
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'CSVファイルを選択してください' },
        { status: 400 }
      );
    }

    // ファイル内容を読み取り
    const text = await file.text();
    const rows = parseCSVAll(text);

    if (rows.length < 2) {
      return NextResponse.json(
        { error: 'CSVにデータ行がありません（ヘッダー行 + 1行以上必要）' },
        { status: 400 }
      );
    }

    // ヘッダー行からカラムインデックスを特定
    const headerRow = rows[0].map((h) => h.trim().toLowerCase());
    const keywordIdx = headerRow.indexOf('keyword');
    const descIdx = headerRow.indexOf('description');
    const catIdx = headerRow.indexOf('category');

    if (keywordIdx === -1) {
      return NextResponse.json(
        { error: 'CSVに「keyword」列が見つかりません' },
        { status: 400 }
      );
    }

    // 既存キーワードを取得（重複チェック用）
    const existing = listKeywords();
    const existingSet = new Set(
      existing.map((k) => `${(k.keyword || '').trim()}|||${(k.description || '').trim()}`)
    );

    let imported = 0;
    let skipped = 0;
    const errors = [];

    // データ行を処理
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const keyword = (row[keywordIdx] || '').trim();
      const description = descIdx >= 0 ? (row[descIdx] || '').trim() : '';
      const category = catIdx >= 0 ? (row[catIdx] || '').trim() : '';

      // 空行スキップ
      if (!keyword && !description) {
        continue;
      }

      // 重複チェック
      const key = `${keyword}|||${description}`;
      if (existingSet.has(key)) {
        skipped++;
        continue;
      }

      try {
        const result = addKeyword(keyword, category, description);
        if (result) {
          imported++;
          existingSet.add(key); // 同CSV内の重複も防止
        } else {
          skipped++;
        }
      } catch (err) {
        errors.push(`行${i + 1}: ${err.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      errors,
      total: rows.length - 1,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
