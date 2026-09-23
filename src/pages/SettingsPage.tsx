import { CloudSyncSection } from '../components/CloudSyncSection';
import { DeviceStorageInfo } from '../components/DeviceStorageInfo';
import { formatDateTime, RestorePanel, SummaryTable } from '../components/RestorePanel';
import { PageHeader, useNotice } from '../components/ui';
import { repository, summarize } from '../data/repository';
import { useRepoSnapshot } from '../data/useAppData';
import { downloadBackup } from '../lib/download';

export { downloadRaw } from '../lib/download';

/** 確認ダイアログを出してからサンプルデータに戻す */
export function confirmAndReset(): { done: boolean; message?: string } {
  const ok = window.confirm(
    'すべての商品・店舗・価格履歴を消して、サンプルデータに戻します。\n' +
      '（現在のデータは「1つ前の状態に戻す」で1回だけ戻せます）\n\n本当に戻しますか？',
  );
  if (!ok) return { done: false };
  const result = repository.resetToSample();
  return result.ok ? { done: true, message: 'サンプルデータに戻しました' } : { done: true, message: result.error };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function SettingsPage() {
  const { status, data, undo } = useRepoSnapshot();
  const notice = useNotice();
  const summary = data ? summarize(data) : null;
  const usage = repository.storageUsage();

  const statusText =
    status.kind === 'ready'
      ? 'このブラウザ（localStorage）に保存しています'
      : status.kind === 'memory-only'
        ? `保存できません：${status.reason}（画面を閉じると入力内容は消えます）`
        : `保存データが壊れています：${status.reason}`;

  function handleUndo() {
    if (!undo) return;
    const s = undo.summary;
    const ok = window.confirm(
      `${formatDateTime(undo.savedAt)} に${undo.reason === 'restore' ? '復元' : 'サンプルデータに戻す操作'}をする前の状態に戻します。\n\n` +
        `商品 ${s.products}件 / 店舗 ${s.stores}件 / 価格履歴 ${s.priceRecords}件 / 買い物リスト ${s.shoppingList}件\n\n` +
        '現在のデータはこの内容に置き換わります。戻しますか？',
    );
    if (!ok) return;
    const r = repository.undoReplace();
    notice.show(r.ok ? '1つ前の状態に戻しました' : r.error, r.ok ? 'success' : 'error');
  }

  return (
    <>
      <PageHeader title="データ管理" description="データのバックアップと復元を行います。機種変更やブラウザのデータ削除に備えて、定期的にバックアップを保存してください。" />
      {notice.node}

      <section className="card" aria-labelledby="usage-heading">
        <h2 id="usage-heading">現在の保存状況</h2>
        <p className="muted" data-testid="storage-status">{statusText}</p>
        {summary && (
          <dl className="kv" data-testid="storage-summary">
            <div><dt>商品</dt><dd>{summary.products}件{summary.archivedProducts > 0 && <small>（使用停止 {summary.archivedProducts}）</small>}</dd></div>
            <div><dt>店舗</dt><dd>{summary.stores}件{summary.archivedStores > 0 && <small>（使用停止 {summary.archivedStores}）</small>}</dd></div>
            <div><dt>価格履歴</dt><dd>{summary.priceRecords}件</dd></div>
            <div><dt>買い物リスト</dt><dd>{summary.shoppingList}件{summary.purchased > 0 && <small>（購入済み {summary.purchased}）</small>}</dd></div>
          </dl>
        )}
        {usage !== null && (
          <p className="muted small" data-testid="storage-usage">
            使用量：約 {formatBytes(usage)}（このアプリが保存しているデータの目安です。保存できる上限はブラウザや端末によって異なります）
          </p>
        )}
        <p className="muted small">
          データはこのブラウザの中だけに保存されます。別のブラウザ・別の端末とは共有されません。
          ブラウザの「閲覧データの削除」を行うと消えることがあります。
        </p>
      </section>

      <DeviceStorageInfo />

      <CloudSyncSection />

      <section className="card" aria-labelledby="backup-heading">
        <h2 id="backup-heading">バックアップを保存</h2>
        <p className="muted small">すべての商品・店舗・価格履歴・買い物リストを1つのファイル（JSON形式）に保存します。</p>
        <button
          type="button"
          className="button button-primary"
          disabled={!data}
          onClick={() => {
            const r = downloadBackup();
            notice.show(r.ok ? `バックアップを保存しました（${r.value}）` : r.error, r.ok ? 'success' : 'error');
          }}
        >
          バックアップを保存
        </button>
      </section>

      <section className="card" aria-labelledby="restore-heading">
        <h2 id="restore-heading">バックアップから復元</h2>
        <RestorePanel current={summary} onDone={(m, k) => notice.show(m, k)} />
      </section>

      {undo && (
        <section className="card undo-card" aria-labelledby="undo-heading" data-testid="undo-card">
          <h2 id="undo-heading">1つ前の状態に戻す</h2>
          <p className="small">
            {formatDateTime(undo.savedAt)} に{undo.reason === 'restore' ? '復元' : 'サンプルデータに戻す操作'}をする前の状態を保管しています。
          </p>
          <SummaryTable current={summary} next={undo.summary} nextLabel="戻した後" />
          <button type="button" className="button button-outline" onClick={handleUndo}>
            1つ前の状態に戻す
          </button>
        </section>
      )}

      <section className="card danger-zone" aria-labelledby="danger-heading">
        <h2 id="danger-heading">開発・テスト用</h2>
        <p className="muted small">
          登録した商品・店舗・価格履歴をすべて消して、初回起動時のサンプルデータに戻します。通常は使いません。
        </p>
        <button
          type="button"
          className="button button-danger button-sm"
          onClick={() => {
            const r = confirmAndReset();
            if (r.message) notice.show(r.message, 'success');
          }}
        >
          サンプルデータに戻す
        </button>
      </section>
    </>
  );
}
