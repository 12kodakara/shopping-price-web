import { useRef, useState, type ChangeEvent } from 'react';
import { repository } from '../data/repository';
import type { AppData, DataSummary } from '../data/types';
import { downloadBackup } from '../lib/download';

interface Preview {
  fileName: string;
  data: AppData;
  summary: DataSummary;
  exportedAt: string | null;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 件数の比較表（現在のデータ ↔ 復元するデータ） */
export function SummaryTable({ current, next, nextLabel }: { current: DataSummary | null; next: DataSummary; nextLabel: string }) {
  const rows: [string, keyof DataSummary][] = [
    ['商品', 'products'],
    ['店舗', 'stores'],
    ['価格履歴', 'priceRecords'],
    ['買い物リスト', 'shoppingList'],
  ];
  return (
    <table className="summary-table">
      <thead>
        <tr>
          <th></th>
          <th className="num">現在</th>
          <th className="num">{nextLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, key]) => (
          <tr key={key} data-testid={`summary-${key}`}>
            <th>{label}</th>
            <td className="num">{current ? `${current[key]}件` : '—'}</td>
            <td className="num">
              <strong>{next[key]}件</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * バックアップからの復元。
 * ファイル選択 → 内容の検証 → 概要の表示 → 確認 → 復元 の順に進み、確認するまで保存データは変更しない。
 */
export function RestorePanel({ current, onDone }: { current: DataSummary | null; onDone: (message: string, kind: 'success' | 'error') => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function clear() {
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview(null);
    setError(null);
    if (!file) return;
    setReading(true);
    try {
      const text = await file.text();
      const result = repository.previewRestore(text);
      if (!result.ok) setError(result.error);
      else setPreview({ fileName: file.name, ...result.value });
    } catch {
      setError('ファイルを読み込めませんでした');
    } finally {
      setReading(false);
    }
  }

  function handleRestore() {
    if (!preview) return;
    const s = preview.summary;
    const ok = window.confirm(
      `バックアップ「${preview.fileName}」の内容で復元します。\n\n` +
        `商品 ${s.products}件 / 店舗 ${s.stores}件 / 価格履歴 ${s.priceRecords}件 / 買い物リスト ${s.shoppingList}件\n\n` +
        `現在のデータはこの内容に置き換わります（「1つ前の状態に戻す」で1回だけ戻せます）。\n復元しますか？`,
    );
    if (!ok) return;
    const result = repository.restore(preview.data);
    if (!result.ok) {
      onDone(result.error, 'error');
      return;
    }
    clear();
    onDone(`バックアップから復元しました（商品${s.products}件・店舗${s.stores}件・価格履歴${s.priceRecords}件）`, 'success');
  }

  return (
    <div className="restore-panel">
      <label className="button button-outline file-button" htmlFor="restore-file">
        バックアップファイルを選ぶ
      </label>
      <input
        ref={inputRef}
        id="restore-file"
        className="visually-hidden"
        type="file"
        accept=".json,application/json"
        onChange={handleFile}
        data-testid="restore-file"
      />
      <p className="muted small">ファイルを選んでも、すぐには復元しません。内容を確認してから復元できます。</p>
      {reading && <p className="muted small">読み込み中…</p>}

      {error && (
        <div className="restore-error" role="alert" data-testid="restore-error">
          <strong>このファイルは復元できません</strong>
          <p>{error}</p>
          <p className="muted small">現在のデータは変更していません。</p>
        </div>
      )}

      {preview && (
        <div className="restore-preview" data-testid="restore-preview">
          <h3>復元する内容の確認</h3>
          <p className="small">
            ファイル：{preview.fileName}
            {preview.exportedAt && <>／保存日時：{formatDateTime(preview.exportedAt)}</>}
            {preview.summary.firstDate && <>／記録の期間：{preview.summary.firstDate} 〜 {preview.summary.lastDate}</>}
          </p>
          <SummaryTable current={current} next={preview.summary} nextLabel="バックアップ" />
          <p className="warning-text">
            復元すると、現在のデータはバックアップの内容に置き換わります。
            現在のデータは「1つ前の状態に戻す」で1回だけ戻せますが、念のため先に現在のデータをバックアップしておくと安心です。
          </p>
          <div className="card-actions">
            {current && (
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  const r = downloadBackup();
                  onDone(r.ok ? `現在のデータを ${r.value} に保存しました` : r.error, r.ok ? 'success' : 'error');
                }}
              >
                先に現在のデータを保存
              </button>
            )}
            <button type="button" className="button button-primary" onClick={handleRestore}>
              この内容で復元する
            </button>
            <button type="button" className="button button-ghost" onClick={clear}>
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
