import { listKeywords } from '@/keyword-manager.js';

/**
 * CSVのフィールドをエスケープ
 * カンマ・改行・ダブルクォートを含む場合はダブルクォートで囲む
 */
function escapeCSV(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** GET /api/keywords/export — キーワードCSVエクスポート */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let keywords = listKeywords();
    if (status) {
      keywords = keywords.filter((k) => k.status === status);
    }

    // CSVヘッダー
    const headers = ['keyword', 'description', 'category', 'status', 'createdAt', 'postedAt', 'postUrl'];

    // CSV行を生成
    const rows = keywords.map((kw) =>
      headers.map((h) => escapeCSV(kw[h] || '')).join(',')
    );

    // BOM + ヘッダー + データ
    const BOM = '\uFEFF';
    const csv = BOM + headers.join(',') + '\n' + rows.join('\n');

    // ファイル名に日付を含める
    const date = new Date().toISOString().slice(0, 10);
    const filename = `keywords-${date}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
