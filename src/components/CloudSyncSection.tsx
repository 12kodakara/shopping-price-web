import { useState, type FormEvent } from 'react';
import { sendMagicLink, setAuthMessage, signOut, useAuthMessage, useAuthState, validateEmail } from '../cloud/auth';
import { getCloudData, getCloudStatus, replaceCloudData } from '../cloud/cloudRepository';
import { countsOf, EMPTY_COUNTS, fingerprint, type DataCounts } from '../cloud/cloudRows';
import { backupRequiredBeforeDownload, planDownload, planUpload, type SyncPlan } from '../cloud/cloudSync';
import { repository } from '../data/repository';
import { useRepoSnapshot } from '../data/useAppData';
import { downloadBackup } from '../lib/download';
import { errorProps, FieldError } from './ui';

/**
 * データ管理の「アカウント・クラウド同期」欄。
 *
 * 第11回：ログイン・ログアウト
 * 第12回：クラウドとのデータのやりとり（手動・確認つき）
 *
 * 大前提として、データの正本はこの端末（localStorage）。
 *   ・ログインしただけでは何も送受信しない
 *   ・送る／取り込むのは、この画面のボタンを押して内容を確認したときだけ
 *   ・取り込みでこの端末のデータを置き換える前に、必ずバックアップを保存してもらう
 */
export function CloudSyncSection() {
  const auth = useAuthState();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // お知らせ（ログインできた・ログアウトした など）は cloud/auth が持つ
  const notice = useAuthMessage();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateEmail(email);
    setError(invalid ?? undefined);
    if (invalid) return;
    setSending(true);
    const result = await sendMagicLink(email);
    setSending(false);
    if (result.ok) {
      setSentTo(email.trim());
      setAuthMessage(null);
    } else {
      setError(result.error);
    }
  }

  async function handleSignOut() {
    const result = await signOut();
    setAuthMessage(result.ok ? { kind: 'success', text: 'ログアウトしました' } : { kind: 'error', text: result.error });
    setSentTo(null);
  }

  return (
    <section className="card" aria-labelledby="cloud-heading" data-testid="cloud-sync">
      <h2 id="cloud-heading">アカウント・クラウド同期</h2>

      {notice && (
        <p className={notice.kind === 'error' ? 'cloud-error' : 'cloud-success'} role="status" data-testid="cloud-notice">
          {notice.text}
        </p>
      )}

      {auth.status === 'disabled' && (
        <p className="muted small" data-testid="cloud-status">
          クラウド同期はまだ設定されていません。このアプリはこの端末（ブラウザ）に保存して動作します。
          端末をまたいでデータを移すときは、下の「バックアップを保存」と「バックアップから復元」をお使いください。
        </p>
      )}

      {auth.status === 'loading' && (
        <p className="muted small" data-testid="cloud-status">ログイン状態を確認しています…</p>
      )}

      {auth.status === 'signed-out' && (
        <>
          <p className="muted small" data-testid="cloud-status">
            ログインすると、この端末のデータをクラウドに保存したり、別の端末へ移したりできます。
            パスワードは使わず、入力したメールアドレスにログイン用のリンクを送ります。
          </p>
          {sentTo ? (
            <div className="cloud-sent" data-testid="cloud-sent">
              <p><strong>{sentTo}</strong> にログイン用のリンクを送りました。</p>
              <p className="muted small">
                メールのリンクをこの端末で開くとログインが完了します。届かない場合は迷惑メールもご確認ください。
              </p>
              <button type="button" className="button button-ghost button-sm" onClick={() => setSentTo(null)}>
                別のメールアドレスで送る
              </button>
            </div>
          ) : (
            <form className="cloud-form" onSubmit={handleSubmit} noValidate aria-label="ログイン">
              <div className="field">
                <label htmlFor="cloud-email">メールアドレス</label>
                <input
                  id="cloud-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="例: you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  {...errorProps('cloud-email', error)}
                />
                <FieldError id="cloud-email-error" message={error} />
              </div>
              <button type="submit" className="button button-primary" disabled={sending}>
                {sending ? '送信中…' : 'ログイン用のリンクを送る'}
              </button>
            </form>
          )}
        </>
      )}

      {auth.status === 'signed-in' && (
        <>
          <dl className="kv" data-testid="cloud-account">
            <div>
              <dt>ログイン中</dt>
              <dd>{auth.email ?? '（メールアドレス不明）'}</dd>
            </div>
          </dl>
          <CloudDataPanel />
          <button type="button" className="button button-ghost button-sm" onClick={handleSignOut}>
            ログアウト
          </button>
        </>
      )}
    </section>
  );
}

type Mode = 'upload' | 'download';

/** ログイン中に表示する、クラウドとのやりとり（件数の確認・保存・取得） */
function CloudDataPanel() {
  const { data } = useRepoSnapshot();
  const local = data ? countsOf(data) : EMPTY_COUNTS;

  const [cloud, setCloud] = useState<DataCounts | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  /** クラウドに最後に保存した日時（クラウド側に記録されているもの） */
  const [cloudSavedAt, setCloudSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  /** クラウドと端末の内容が同じだと分かっている場合 true（取得の下調べで判明する） */
  const [identical, setIdentical] = useState(false);

  /** クラウドの件数を読み直す。失敗したら理由を表示するだけで、端末のデータは触らない */
  async function refresh(): Promise<DataCounts | null> {
    setBusy(true);
    const result = await getCloudStatus();
    setBusy(false);
    if (!result.ok) {
      setCloud(null);
      setMessage({ kind: 'error', text: result.error });
      return null;
    }
    setCloud(result.value.counts);
    setCloudSavedAt(result.value.lastSyncedAt);
    setCheckedAt(new Date());
    setIdentical(false);
    return result.value.counts;
  }

  async function openPreview(next: Mode) {
    setMessage(null);
    setConfirmed(false);
    setBackedUp(false);
    const counts = cloud ?? (await refresh());
    if (!counts) return;
    setMode(next);
  }

  function closePreview() {
    setMode(null);
    setConfirmed(false);
    setBackedUp(false);
  }

  function handleBackup() {
    const result = downloadBackup();
    if (result.ok) {
      setBackedUp(true);
      setMessage({ kind: 'success', text: `バックアップを保存しました（${result.value}）` });
    } else {
      setMessage({ kind: 'error', text: result.error });
    }
  }

  /** この端末のデータをクラウドへ保存する */
  async function runUpload() {
    if (!data) return;
    setBusy(true);
    const result = await replaceCloudData(data);
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    setCloud(result.value);
    setCheckedAt(new Date());
    setCloudSavedAt(new Date().toISOString());
    setIdentical(true);
    closePreview();
    setMessage({ kind: 'success', text: 'この端末のデータをクラウドへ保存しました（端末のデータはそのままです）' });
  }

  /** クラウドのデータをこの端末へ取り込む（置き換える前に必ずバックアップを保存してもらう） */
  async function runDownload() {
    setBusy(true);
    const fetched = await getCloudData();
    if (!fetched.ok) {
      setBusy(false);
      setMessage({ kind: 'error', text: fetched.error });
      return;
    }
    // 取り込む直前にもう一度確認：クラウドが空なら、この端末のデータを消さずに中止する
    const incoming = countsOf(fetched.value);
    if (incoming.products === 0 && incoming.stores === 0 && incoming.priceRecords === 0 && incoming.shoppingList === 0) {
      setBusy(false);
      setMessage({ kind: 'error', text: 'クラウドにデータがありません。この端末のデータはそのままにしました。' });
      return;
    }
    const restored = repository.restore(fetched.value);
    setBusy(false);
    if (!restored.ok) {
      setMessage({ kind: 'error', text: restored.error });
      return;
    }
    setCloud(incoming);
    setCheckedAt(new Date());
    setIdentical(true);
    closePreview();
    setMessage({
      kind: 'success',
      text: 'クラウドのデータをこの端末へ取り込みました。元に戻したいときは、下の「1つ前の状態に戻す」が使えます。',
    });
  }

  /** 取得の前に、内容が同じかどうかを調べる（同じなら置き換えても変わらないと案内できる） */
  async function checkIdentical() {
    if (!data) return;
    setBusy(true);
    const fetched = await getCloudData();
    setBusy(false);
    if (!fetched.ok) {
      setMessage({ kind: 'error', text: fetched.error });
      return;
    }
    const same = fingerprint(fetched.value) === fingerprint(data);
    setIdentical(same);
    setCloud(countsOf(fetched.value));
    setCheckedAt(new Date());
    setMessage({
      kind: 'info',
      text: same ? 'クラウドとこの端末の内容は同じです。' : 'クラウドとこの端末で内容が違います。どちらを残すか選んでください。',
    });
  }

  const plan: SyncPlan | null =
    mode === null || cloud === null ? null : mode === 'upload' ? planUpload(local, cloud, identical) : planDownload(local, cloud, identical);
  const needBackup = mode === 'download' && backupRequiredBeforeDownload(local);
  const canRun = !!plan?.allowed && (!plan.needsConfirm || confirmed) && (!needBackup || backedUp) && !busy;

  return (
    <div className="cloud-data" data-testid="cloud-data">
      <p className="muted small" data-testid="cloud-status">
        データの正本はこの端末です。下のボタンを押したときだけクラウドとやりとりします（自動では送受信しません）。
      </p>

      <table className="cloud-counts" data-testid="cloud-counts">
        <thead>
          <tr>
            <th scope="col">項目</th>
            <th scope="col">この端末</th>
            <th scope="col">クラウド</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['商品', local.products, cloud?.products],
              ['店舗', local.stores, cloud?.stores],
              ['価格履歴', local.priceRecords, cloud?.priceRecords],
              ['買い物リスト', local.shoppingList, cloud?.shoppingList],
            ] as const
          ).map(([label, localCount, cloudCount]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{localCount}件</td>
              <td>{cloudCount === undefined ? '—' : `${cloudCount}件`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted small" data-testid="cloud-checked-at">
        {checkedAt ? `クラウドの確認：${checkedAt.toLocaleString('ja-JP')}` : 'クラウドの状態はまだ確認していません'}
      </p>

      {cloud !== null && (
        <p className="muted small" data-testid="cloud-updated-at">
          {cloudSavedAt
            ? `クラウドの最終保存：${new Date(cloudSavedAt).toLocaleString('ja-JP')}`
            : 'クラウドにはまだ一度も保存していません'}
        </p>
      )}

      {message && (
        <p
          className={message.kind === 'error' ? 'cloud-error' : message.kind === 'success' ? 'cloud-success' : 'muted small'}
          role="status"
          data-testid="cloud-message"
        >
          {message.text}
        </p>
      )}

      {mode === null ? (
        <div className="cloud-actions">
          <button type="button" className="button button-ghost button-sm" onClick={() => void refresh()} disabled={busy} data-testid="cloud-check">
            {busy ? '確認中…' : 'クラウドの状態を確認'}
          </button>
          <button type="button" className="button button-sm" onClick={() => void openPreview('upload')} disabled={busy} data-testid="cloud-upload">
            この端末のデータをクラウドへ保存
          </button>
          <button type="button" className="button button-sm" onClick={() => void openPreview('download')} disabled={busy} data-testid="cloud-download">
            クラウドのデータをこの端末へ取得
          </button>
        </div>
      ) : (
        <div className="cloud-preview" data-testid="cloud-preview">
          <h3>{mode === 'upload' ? 'この端末のデータをクラウドへ保存します' : 'クラウドのデータをこの端末へ取得します'}</h3>

          <p className="cloud-plan" data-testid="cloud-plan">{plan?.message}</p>

          <p className="muted small">
            {mode === 'upload'
              ? `クラウドは、この端末の内容（商品 ${local.products}件 / 店舗 ${local.stores}件 / 価格履歴 ${local.priceRecords}件 / 買い物リスト ${local.shoppingList}件）になります。この端末のデータは変わりません。`
              : `この端末は、クラウドの内容（商品 ${cloud?.products ?? 0}件 / 店舗 ${cloud?.stores ?? 0}件 / 価格履歴 ${cloud?.priceRecords ?? 0}件 / 買い物リスト ${cloud?.shoppingList ?? 0}件）に置き換わります。`}
          </p>

          {mode === 'download' && (
            <p className="muted small">
              {cloudSavedAt
                ? `クラウドのデータは ${new Date(cloudSavedAt).toLocaleString('ja-JP')} に保存されたものです。`
                : 'クラウドのデータの保存日時は記録されていません。'}
            </p>
          )}

          {mode === 'download' && (
            <button type="button" className="button button-ghost button-sm" onClick={checkIdentical} disabled={busy} data-testid="cloud-compare">
              クラウドと内容を見比べる
            </button>
          )}

          {needBackup && (
            <div className="cloud-backup">
              <p className="muted small">
                置き換える前に、いまのデータをファイルに保存します（あとからこのファイルで戻せます）。
              </p>
              <button type="button" className="button button-sm" onClick={handleBackup} disabled={busy} data-testid="cloud-backup">
                {backedUp ? 'バックアップを保存しました（もう一度保存）' : 'この端末のデータをバックアップ'}
              </button>
            </div>
          )}

          {plan?.needsConfirm && (
            <label className="cloud-confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="cloud-confirm" />
              {mode === 'upload' ? 'クラウドの内容が置き換わることを理解しました' : 'この端末の内容が置き換わることを理解しました'}
            </label>
          )}

          <div className="cloud-actions">
            <button
              type="button"
              className="button button-primary button-sm"
              onClick={() => void (mode === 'upload' ? runUpload() : runDownload())}
              disabled={!canRun}
              data-testid="cloud-run"
            >
              {busy ? '実行中…' : mode === 'upload' ? 'クラウドへ保存する' : 'この端末へ取得する'}
            </button>
            <button type="button" className="button button-ghost button-sm" onClick={closePreview} disabled={busy} data-testid="cloud-cancel">
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
