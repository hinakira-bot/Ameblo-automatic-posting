'use client';

import { useState, useEffect } from 'react';

const FREQUENCY_OPTIONS = [
  { value: 'daily1', label: '毎日1回' },
  { value: 'daily2', label: '毎日2回' },
  { value: 'weekday', label: '平日のみ' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const IMAGE_MODELS = [
  { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image (推奨・高速)' },
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (高品質)' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // APIキー管理用
  const [credentials, setCredentials] = useState(null);
  const [credForm, setCredForm] = useState({
    geminiApiKey: '',
    amebloId: '',
    amebloPassword: '',
  });
  const [credSaving, setCredSaving] = useState(false);
  const [credMessage, setCredMessage] = useState('');

  // スケジュールUI用
  const [frequency, setFrequency] = useState('daily1');
  const [hour1, setHour1] = useState(9);
  const [hour2, setHour2] = useState(15);

  useEffect(() => {
    fetchSettings();
    fetchCredentials();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data.settings);

      // cron → シンプル選択に変換
      const cron = data.settings?.posting?.cronSchedule || '0 9 * * *';
      const parsed = parseCronSimple(cron);
      setFrequency(parsed.frequency);
      setHour1(parsed.hour1);
      setHour2(parsed.hour2);
    } catch (err) {
      console.error('設定取得エラー:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCredentials = async () => {
    try {
      const res = await fetch('/api/credentials');
      const data = await res.json();
      setCredentials(data);
    } catch (err) {
      console.error('クレデンシャル取得エラー:', err);
    }
  };

  const handleCredSave = async () => {
    setCredSaving(true);
    setCredMessage('');

    // 空文字のフィールドは送らない（既存値維持）
    const payload = {};
    for (const [key, val] of Object.entries(credForm)) {
      if (val.trim()) payload[key] = val.trim();
    }

    if (Object.keys(payload).length === 0) {
      setCredMessage('変更する項目を入力してください');
      setCredSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setCredMessage('APIキーを更新しました');
        setCredForm({
          geminiApiKey: '',
          amebloId: '',
          amebloPassword: '',
        });
        fetchCredentials(); // マスク表示を更新
        setTimeout(() => setCredMessage(''), 3000);
      } else {
        const data = await res.json();
        setCredMessage(data.error || '保存に失敗しました');
      }
    } catch (err) {
      setCredMessage('エラー: ' + err.message);
    } finally {
      setCredSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');

    // cron式を構築
    const cron = buildCronSimple({ frequency, hour1, hour2 });

    const updates = {
      'article.minLength': settings.article.minLength,
      'article.maxLength': settings.article.maxLength,
      'article.defaultCategory': settings.article.defaultCategory,
      'knowledge.maxFileSizeKB': settings.knowledge.maxFileSizeKB,
      'knowledge.maxTotalChars': settings.knowledge.maxTotalChars,
      'posting.cronSchedule': cron,
      'posting.dryRun': settings.posting.dryRun,
    };

    // 画像生成モデル設定
    if (settings.imageModel) {
      updates['imageModel'] = settings.imageModel;
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      if (res.ok) {
        setMessage('✅ 設定を保存しました');
        setTimeout(() => setMessage(''), 3000);
      } else {
        const data = await res.json();
        setMessage('❌ ' + (data.error || '保存に失敗しました'));
      }
    } catch (err) {
      setMessage('❌ エラー: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (path, value) => {
    setSettings((prev) => {
      const result = { ...prev };
      const keys = path.split('.');
      let current = result;
      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return result;
    });
  };

  if (loading || !settings) {
    return <div className="text-center text-gray-500 py-12">読み込み中...</div>;
  }

  const cronDescription = describeCronSimple({ frequency, hour1, hour2 });

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">設定</h1>

      <div className="space-y-8">
        {/* APIキー・認証情報 */}
        <Section title="APIキー・認証情報">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 mb-2">
            APIキー・パスワードはサーバー上の .env ファイルに保存されます。変更する項目のみ入力してください（空欄の項目は現在の値が維持されます）。
          </div>

          {credentials && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">現在の設定状況</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-gray-500">Gemini APIキー:</span>
                <span className="font-mono text-gray-800">{credentials.geminiApiKey || '未設定'}</span>
                <span className="text-gray-500">アメブロID:</span>
                <span className="font-mono text-gray-800">{credentials.amebloId || '未設定'}</span>
                <span className="text-gray-500">アメブロパスワード:</span>
                <span className="font-mono text-gray-800">{credentials.amebloPassword || '未設定'}</span>
              </div>
            </div>
          )}

          <Field label="Gemini APIキー">
            <input
              type="password"
              value={credForm.geminiApiKey}
              onChange={(e) => setCredForm({ ...credForm, geminiApiKey: e.target.value })}
              className="input-field"
              placeholder="変更する場合のみ入力"
              autoComplete="off"
            />
          </Field>
          <Field label="アメブロID">
            <input
              type="text"
              value={credForm.amebloId}
              onChange={(e) => setCredForm({ ...credForm, amebloId: e.target.value })}
              className="input-field"
              placeholder="変更する場合のみ入力"
              autoComplete="off"
            />
          </Field>
          <Field label="アメブロパスワード">
            <input
              type="password"
              value={credForm.amebloPassword}
              onChange={(e) => setCredForm({ ...credForm, amebloPassword: e.target.value })}
              className="input-field"
              placeholder="変更する場合のみ入力"
              autoComplete="off"
            />
          </Field>

          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleCredSave}
              disabled={credSaving}
              className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {credSaving ? '保存中...' : 'APIキーを更新'}
            </button>
            {credMessage && (
              <span className="text-sm text-amber-700">{credMessage}</span>
            )}
          </div>
        </Section>

        {/* 記事設定 */}
        <Section title="記事設定">
          <Field label="最小文字数">
            <input
              type="number"
              value={settings.article.minLength}
              onChange={(e) => updateField('article.minLength', parseInt(e.target.value) || 0)}
              className="input-field"
            />
          </Field>
          <Field label="最大文字数">
            <input
              type="number"
              value={settings.article.maxLength}
              onChange={(e) => updateField('article.maxLength', parseInt(e.target.value) || 0)}
              className="input-field"
            />
          </Field>
          <Field label="デフォルトカテゴリ">
            <input
              type="text"
              value={settings.article.defaultCategory}
              onChange={(e) => updateField('article.defaultCategory', e.target.value)}
              className="input-field"
              placeholder="未設定"
            />
          </Field>
        </Section>

        {/* ナレッジ設定 */}
        <Section title="ナレッジ設定">
          <Field label="ファイルサイズ上限 (KB)">
            <input
              type="number"
              value={settings.knowledge.maxFileSizeKB}
              onChange={(e) => updateField('knowledge.maxFileSizeKB', parseInt(e.target.value) || 100)}
              className="input-field"
            />
          </Field>
          <Field label="全体文字数上限">
            <input
              type="number"
              value={settings.knowledge.maxTotalChars}
              onChange={(e) => updateField('knowledge.maxTotalChars', parseInt(e.target.value) || 50000)}
              className="input-field"
            />
          </Field>
        </Section>

        {/* 自動投稿スケジュール */}
        <Section title="自動投稿スケジュール">
          <Field label="投稿頻度">
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="input-field"
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </Field>

          <Field label="1回目の時刻">
            <select
              value={hour1}
              onChange={(e) => setHour1(parseInt(e.target.value))}
              className="input-field"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{h}:00</option>
              ))}
            </select>
          </Field>

          {frequency === 'daily2' && (
            <Field label="2回目の時刻">
              <select
                value={hour2}
                onChange={(e) => setHour2(parseInt(e.target.value))}
                className="input-field"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{h}:00</option>
                ))}
              </select>
            </Field>
          )}

          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600">
            📅 {cronDescription}
          </div>
        </Section>

        {/* 画像生成モデル */}
        <Section title="画像生成">
          <Field label="画像生成モデル">
            <select
              value={settings.imageModel || 'gemini-3.1-flash-image-preview'}
              onChange={(e) => updateField('imageModel', e.target.value)}
              className="input-field"
            >
              {IMAGE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
        </Section>

        {/* その他 */}
        <Section title="その他">
          <Field label="ドライラン（投稿スキップ）">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.posting.dryRun}
                onChange={(e) => updateField('posting.dryRun', e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm text-gray-600">有効にすると実際の投稿をスキップします</span>
            </label>
          </Field>
        </Section>

        {/* 保存ボタン */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? '保存中...' : '設定を保存'}
          </button>
          {message && (
            <span className="text-sm">{message}</span>
          )}
        </div>
      </div>

      <style jsx>{`
        :global(.input-field) {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        :global(.input-field:focus) {
          outline: none;
          box-shadow: 0 0 0 2px #3b82f6;
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

// --- ヘルパー関数（クライアントサイド） ---

function buildCronSimple({ frequency, hour1, hour2 }) {
  const h1 = Math.min(23, Math.max(0, parseInt(hour1) || 0));
  switch (frequency) {
    case 'daily2': {
      const h2 = Math.min(23, Math.max(0, parseInt(hour2) || 15));
      const hours = [h1, h2].sort((a, b) => a - b).join(',');
      return `0 ${hours} * * *`;
    }
    case 'weekday':
      return `0 ${h1} * * 1-5`;
    default:
      return `0 ${h1} * * *`;
  }
}

function parseCronSimple(cron) {
  if (!cron) return { frequency: 'daily1', hour1: 9, hour2: 15 };
  const parts = cron.split(' ');
  if (parts.length !== 5) return { frequency: 'daily1', hour1: 9, hour2: 15 };
  const [, hourStr, , , dow] = parts;
  const hours = hourStr.split(',').map(Number);
  return {
    frequency: dow === '1-5' ? 'weekday' : hours.length > 1 ? 'daily2' : 'daily1',
    hour1: hours[0] || 9,
    hour2: hours[1] || 15,
  };
}

function describeCronSimple({ frequency, hour1, hour2 }) {
  const h1 = parseInt(hour1) || 0;
  const h2 = parseInt(hour2) || 15;
  switch (frequency) {
    case 'daily2':
      return `毎日 ${h1}:00 と ${h2}:00 に自動投稿`;
    case 'weekday':
      return `平日 ${h1}:00 に自動投稿`;
    default:
      return `毎日 ${h1}:00 に自動投稿`;
  }
}
