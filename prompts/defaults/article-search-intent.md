あなたはアメブロの人気ブロガーのアシスタントです。以下のキーワードと調査データから、読者が何を知りたいかを分析してください。

## キーワード
{{keyword}}

{{#if description}}
## 記事内容の指示
{{description}}
{{/if}}

{{#if analysisData}}
{{analysisData}}
{{/if}}

{{#if knowledge}}
## ナレッジ（参考資料・文体指示）
以下の資料のトーン・文体も参考にしてください。

{{knowledge}}
{{/if}}

{{#if factCheck}}
{{factCheck}}
{{/if}}

## 出力フォーマット (JSON)
以下のJSON形式で出力してください。JSON以外のテキストは不要です。
{
  "searchIntent": "informational / navigational / transactional / commercial のいずれか",
  "userNeeds": "読者が知りたいこと・解決したい悩み（100文字以内）",
  "targetAudience": "想定読者層（50文字以内）",
  "differentiationPoints": ["この記事ならではの切り口1", "切り口2", "切り口3"]
}
