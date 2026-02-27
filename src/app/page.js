'use client';

import { useState, useEffect } from 'react';
import StatusBadge from '@/components/StatusBadge';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recentPosts, setRecentPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data.stats);
      setRecentPosts(data.recentPosts || []);
    } catch (err) {
      console.error('データ取得エラー:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">ダッシュボード</h1>

      {/* 統計カード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="全キーワード" value={stats?.total || 0} color="blue" />
        <StatCard label="未投稿" value={stats?.pending || 0} color="yellow" />
        <StatCard label="投稿済" value={stats?.posted || 0} color="green" />
        <StatCard label="失敗" value={stats?.failed || 0} color="red" />
      </div>

      {/* 最近の投稿 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">最近の投稿</h2>
        </div>

        {recentPosts.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            <p>まだ投稿がありません</p>
            <p className="text-sm mt-2">
              キーワードを追加して、パイプラインを実行してください
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentPosts.map((post, i) => (
              <div key={i} className="px-6 py-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {post.title || '(タイトルなし)'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {post.keyword} ・ {post.elapsedSeconds ? `${post.elapsedSeconds}秒` : ''}
                    {post.dryRun ? ' (ドライラン)' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <span className="text-xs text-gray-400">
                    {post.timestamp ? new Date(post.timestamp).toLocaleDateString('ja-JP') : ''}
                  </span>
                  <StatusBadge status={post.error ? 'failed' : 'posted'} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
