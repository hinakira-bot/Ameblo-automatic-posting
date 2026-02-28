/**
 * スケジュールUIヘルパー
 * シンプル選択 ↔ cron式の変換（10分単位対応）
 */

/**
 * cron式 → 日本語の説明文に変換
 * セミコロン区切りの複数cron式にも対応
 * @param {string} cron - cron式 (例: '0 9 * * *', '30 9 * * *;0 15 * * *')
 * @returns {string} 日本語説明
 */
export function describeCron(cron) {
  if (!cron) return '未設定';

  // セミコロン区切りの場合
  if (cron.includes(';')) {
    const parts = cron.split(';').map(s => s.trim());
    const times = parts.map(p => {
      const [min, hour] = p.split(' ');
      return `${hour}:${String(min).padStart(2, '0')}`;
    });
    return `毎日 ${times.join(' と ')} に自動投稿`;
  }

  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minStr, hourStr, , , dayOfWeek] = parts;
  const hours = hourStr.split(',').map(Number);
  const mins = minStr.split(',').map(Number);

  // 時刻文字列を生成
  let timeStr;
  if (hours.length > 1 && mins.length === 1) {
    timeStr = hours.map((h) => `${h}:${String(mins[0]).padStart(2, '0')}`).join(' と ');
  } else if (hours.length === 1 && mins.length > 1) {
    timeStr = mins.map((m) => `${hours[0]}:${String(m).padStart(2, '0')}`).join(' と ');
  } else {
    timeStr = `${hours[0]}:${String(mins[0]).padStart(2, '0')}`;
  }

  if (dayOfWeek === '1-5') {
    return `平日 ${timeStr} に自動投稿`;
  }

  return `毎日 ${timeStr} に自動投稿`;
}
