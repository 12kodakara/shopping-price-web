import { useEffect, useState, type FormEvent } from 'react';
import { sendMagicLink, setAuthMessage, signOut, useAuthMessage, useAuthState, validateEmail } from '../cloud/auth';
import { getCloudData, getCloudStatus, replaceCloudData } from '../cloud/cloudRepository';
import { countsOf, EMPTY_COUNTS, fingerprint, type DataCounts } from '../cloud/cloudRows';
import {
  backupRequiredBeforeDownload,
  describeSyncDifference,
  planDownload,
  planUpload,
  runBlockedReason,
  type ContentMatch,
  type SyncPlan,
} from '../cloud/cloudSync';
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
 *   ・取り込みでこの端末のデータを置き換える前に、必ず「復元前バックアップ」として端末内に退避する（ファイルへの保存は任意・第13回）
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
  /**
   * クラウドと端末の「内容」が同じかどうか。
   * 件数が同じでも中身が同じとは限らないため、未確認（unknown）を区別する。
   */
  const [contentMatch, setContentMatch] = useState<ContentMatch>('unknown');
  /** 照合したときの端末データの指紋。端末側を編集したら照合結果を無効に戻すために使う */
  const [verifiedFingerprint, setVerifiedFingerprint] = useState<string | null>(null);

  // 端末のデータを編集したら、前回の照合結果は当てにならないので未確認へ戻す
  const localFingerprint = data ? fingerprint(data) : null;
  useEffect(() => {
    if (verifiedFingerprint !== null && localFingerprint !== verifiedFingerprint) {
      setContentMatch('unknown');
      setVerifiedFingerprint(null);
    }
  }, [localFingerprint, verifiedFingerprint]);

  /** クラウドの件数を読み直す。失敗したら理由を表示するだけで、端末のデータは触らない */
  async function refresh(): Promise<DataCounts | null> {
    setBusy(true);
    const result = await getCloudStatus().finally(() => setBusy(false));
    if (!result.ok) {
      setCloud(null);
      setMessage({ kind: 'error', text: result.error });
      return null;
    }
    setCloud(result.value.counts);
    setCloudSavedAt(result.value.lastSyncedAt);
    setCheckedAt(new Date());
    // 件数を見ただけでは内容が同じかどうかは分からない
    setContentMatch('unknown');
    setVerifiedFingerprint(null);
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
    const result = await replaceCloudData(data).finally(() => setBusy(false));
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    setCloud(result.value);
    setCheckedAt(new Date());
    // 「クラウドの最終保存」はクラウドへ保存できたときだけ進める
    setCloudSavedAt(new Date().toISOString());
    setContentMatch('same');
    setVerifiedFingerprint(data ? fingerprint(data) : null);
    closePreview();
    setMessage({ kind: 'success', text: 'この端末のデータをクラウドへ保存しました（端末のデータはそのままです）' });
  }

  /**
   * クラウドのデータをこの端末へ取り込む。
   * 置き換える前の端末のデータは repository.restore が「復元前バックアップ」として必ず退避し、
   * 退避や保存に失敗したときは何も変えずに中止する。どこで失敗しても理由を表示する。
   */
  async function runDownload() {
    setBusy(true);
    setMessage(null);
    try {
      const fetched = await getCloudData();
      if (!fetched.ok) {
        setMessage({ kind: 'error', text: `${fetched.error}（この端末のデータはそのままです）` });
        return;
      }
      // 取り込む直前にもう一度確認：クラウドが空なら、この端末のデータを消さずに中止する
      const incoming = countsOf(fetched.value);
      if (incoming.products === 0 && incoming.stores === 0 && incoming.priceRecords === 0 && incoming.shoppingList === 0) {
        setMessage({ kind: 'error', text: 'クラウドにデータがありません。この端末のデータはそのままにしました。' });
        return;
      }
      const restored = repository.restore(fetched.value);
      if (!restored.ok) {
        setMessage({ kind: 'error', text: `この端末へ取り込めませんでした：${restored.error}` });
        return;
      }
      setCloud(incoming);
      setCheckedAt(new Date());
      // 取得はクラウドを変更しないので、クラウドの最終保存日時はそのまま
      setContentMatch('same');
      setVerifiedFingerprint(fingerprint(fetched.value));
      closePreview();
      setMessage({
        kind: 'success',
        text:
          `クラウドのデータをこの端末へ取り込みました（商品 ${incoming.products}件 / 店舗 ${incoming.stores}件 / ` +
          `価格履歴 ${incoming.priceRecords}件 / 買い物リスト ${incoming.shoppingList}件）。` +
          '元に戻したいときは、下の「1つ前の状態に戻す」が使えます。',
      });
    } catch (e) {
      // 想定外の例外も握りつぶさずに表示する（端末のデータは restore の中で守られている）
      const detail = e instanceof Error && e.message ? `（${e.message}）` : '';
      setMessage({ kind: 'error', text: `取り込みの途中で問題が起きたため、中止しました${detail}。この端末のデータはそのままです。` });
    } finally {
      setBusy(false);
    }
  }

  /**
   * クラウドのデータを取り寄せて、この端末と内容が同じかどうかを確かめる。
   * 件数だけでは分からない違い（同じ5件でも名前や価格が違う）を見つけるための操作で、
   * 端末のデータもクラウドのデータも一切変更しない。
   */
  async function verifyContent() {
    if (!data) return;
    setBusy(true);
    const fetched = await getCloudData().finally(() => setBusy(false));
    if (!fetched.ok) {
      setMessage({ kind: 'error', text: fetched.error });
      return;
    }
    const same = fingerprint(fetched.value) === fingerprint(data);
    setContentMatch(same ? 'same' : 'different');
    setVerifiedFingerprint(fingerprint(data));
    setCloud(countsOf(fetched.value));
    setCheckedAt(new Date());
    setMessage({
      kind: 'info',
      text: same
        ? 'クラウドとこの端末の内容は同じでした。'
        : '件数が同じでも内容が違うことがあります。今回は内容が違いました。どちらを残すか選んでください。',
    });
  }

  const plan: SyncPlan | null =
    mode === null || cloud === null
      ? null
      : mode === 'upload'
        ? planUpload(local, cloud, contentMatch === 'same')
        : planDownload(local, cloud, contentMatch === 'same');
  /** ファイルへのバックアップを勧めるか（取得の条件にはしない。理由は backupRequiredBeforeDownload を参照） */
  const suggestBackup = mode === 'download' && backupRequiredBeforeDownload(local);
  const confirmLabel = mode === 'upload' ? 'クラウドの内容が置き換わることを理解しました' : 'この端末の内容が置き換わることを理解しました';
  const blockedReason = runBlockedReason(plan, confirmed, confirmLabel);
  /** 件数と内容の違い（「件数は同じだが内容が違う」を言い分けるため） */
  const difference = describeSyncDifference(local, cloud, contentMatch);
  const canRun = blockedReason === null && !busy;

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

      {cloud !== null && (
        <p
          className={difference.kind === 'different' ? 'cloud-diff-warn' : 'muted small'}
          data-testid="cloud-diff"
          data-match={contentMatch}
        >
          {difference.text}
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
          {cloud !== null && (
            <button type="button" className="button button-ghost button-sm" onClick={() => void verifyContent()} disabled={busy} data-testid="cloud-verify">
              {busy ? '照合中…' : '内容まで照合する'}
            </button>
          )}
          <button type="button" className="button button-sm" onClick={() => void openPreview('upload')} disabled={busy} data-testid="cloud-upload">
            この端末のデータをクラウドへ保存
            <small className="cloud-direction">この端末 → クラウド</small>
          </button>
          <button type="button" className="button button-sm" onClick={() => void openPreview('download')} disabled={busy} data-testid="cloud-download">
            クラウドのデータをこの端末へ取得
            <small className="cloud-direction">クラウド → この端末</small>
          </button>
        </div>
      ) : (
        <div className="cloud-preview" data-testid="cloud-preview">
          <h3>{mode === 'upload' ? 'この端末のデータをクラウドへ保存します' : 'クラウドのデータをこの端末へ取得します'}</h3>

          <p className="cloud-flow" data-testid="cloud-flow">
            {mode === 'upload' ? (
              <>
                <span className="cloud-from">この端末（そのまま残ります）</span>
                <span className="cloud-arrow" aria-hidden="true">→</span>
                <span className="cloud-to">クラウド（置き換わります）</span>
              </>
            ) : (
              <>
                <span className="cloud-from">クラウド（そのまま残ります）</span>
                <span className="cloud-arrow" aria-hidden="true">→</span>
                <span className="cloud-to">この端末（置き換わります）</span>
              </>
            )}
          </p>

          <p className="cloud-plan" data-testid="cloud-plan">{plan?.message}</p>

          <p
            className={difference.kind === 'different' ? 'cloud-diff-warn' : 'muted small'}
            data-testid="cloud-diff-preview"
            data-match={contentMatch}
          >
            {difference.text}
            {contentMatch === 'same' && (mode === 'download' ? ' 取得しなくても変わりません。' : ' 保存しなおしても変わりません。')}
          </p>

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

          <button type="button" className="button button-ghost button-sm" onClick={() => void verifyContent()} disabled={busy} data-testid="cloud-compare">
            {busy ? '照合中…' : 'クラウドと内容を見比べる'}
          </button>

          {mode === 'download' && (
            <p className="muted small" data-testid="cloud-undo-note">
              置き換える前に、この端末の現在のデータは「復元前バックアップ」として自動で退避されます。
              取り込んだあとでも、下の「1つ前の状態に戻す」で1回だけ元に戻せます。
            </p>
          )}

          {suggestBackup && (
            <div className="cloud-backup">
              <p className="muted small">
                さらに念のため、いまのデータをファイルにも保存できます（任意。この端末以外からでも戻せます）。
              </p>
              <button type="button" className="button button-sm" onClick={handleBackup} disabled={busy} data-testid="cloud-backup">
                {backedUp ? 'バックアップを保存しました（もう一度保存）' : 'この端末のデータをバックアップ'}
              </button>
            </div>
          )}

          {plan?.needsConfirm && (
            <label className="cloud-confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="cloud-confirm" />
              {confirmLabel}
            </label>
          )}

          {blockedReason && !busy && (
            <p className="cloud-run-hint" data-testid="cloud-run-hint">
              {blockedReason}
            </p>
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
