import { useState, type FormEvent } from 'react';
import { sendMagicLink, setAuthMessage, signOut, useAuthMessage, useAuthState, validateEmail } from '../cloud/auth';
import { errorProps, FieldError } from './ui';

/**
 * データ管理の「アカウント・クラウド同期」欄。
 * 第11回ではログイン・ログアウトだけを行い、データの送受信は行わない。
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
            ログインすると、将来、PCとスマホでデータを共有できるようになります（同期機能は準備中で、まだデータは送受信しません）。
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
          <p className="muted small" data-testid="cloud-status">
            同期機能は準備中です。この画面でログインしても、商品・店舗・価格履歴は送受信されません（この端末に保存したままです）。
          </p>
          <button type="button" className="button button-ghost button-sm" onClick={handleSignOut}>
            ログアウト
          </button>
        </>
      )}
    </section>
  );
}
