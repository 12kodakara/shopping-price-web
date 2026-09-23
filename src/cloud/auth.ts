import { useSyncExternalStore } from 'react';
import { getSupabase } from './supabaseClient';

// ログイン（Supabase Auth・メールのリンク方式）。
//
// ・クラウド未設定なら何もしない（status: 'disabled'）。アプリは今までどおり localStorage だけで動く
// ・ログインしても、この回ではデータの送受信は一切行わない（認証だけ）
// ・トークンの保存・更新は supabase-js に任せる（自前で localStorage に書かない）

export type AuthState =
  /** クラウド未設定（環境変数なし） */
  | { status: 'disabled' }
  /** 起動直後。ログイン状態を確認中 */
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; email: string | null; userId: string };

export type AuthResult = { ok: true } | { ok: false; error: string };

let state: AuthState = { status: 'disabled' };
const listeners = new Set<() => void>();

function setState(next: AuthState) {
  state = next;
  for (const l of listeners) l();
}

export function getAuthState(): AuthState {
  return state;
}

/** 画面用。ログイン状態が変わると再描画される */
export function useAuthState(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getAuthState,
  );
}

/**
 * 画面に出す短いお知らせ（ログインできた・できなかった・ログアウトした）。
 * ログイン状態とは別に変わるので、これも購読できるようにしておく
 * （状態変化とお知らせの順番が前後しても、確実に表示されるようにするため）。
 */
export type AuthMessage = { kind: 'success' | 'error'; text: string } | null;

let message: AuthMessage = null;
const messageListeners = new Set<() => void>();

export function setAuthMessage(next: AuthMessage) {
  message = next;
  for (const l of messageListeners) l();
}

export function useAuthMessage(): AuthMessage {
  return useSyncExternalStore(
    (l) => {
      messageListeners.add(l);
      return () => {
        messageListeners.delete(l);
      };
    },
    () => message,
  );
}

/**
 * ログイン後に戻ってくるURL。
 * 「データ管理」の画面に戻すことで、ログインできたかどうかとログイン中のメールアドレスを
 * その場で確認できるようにする（公開先が /shopping-price-web/ の下でも同じ考え方）。
 */
export function authRedirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}settings`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return 'メールアドレスを入力してください';
  if (!EMAIL_RE.test(value)) return 'メールアドレスの形式が正しくありません';
  return null;
}

/** Supabase のエラーを日本語の短い説明にする */
function describeError(error: { message?: string; status?: number } | null, fallback: string): string {
  const message = error?.message ?? '';
  if (/rate limit|too many/i.test(message)) return 'メールの送信回数が上限に達しました。しばらく待ってからもう一度お試しください';
  if (/invalid email|email address/i.test(message)) return 'メールアドレスの形式が正しくありません';
  if (/signups not allowed|not authorized/i.test(message)) return 'このメールアドレスではログインできません（Supabase側の設定をご確認ください）';
  if (/fetch|network/i.test(message)) return '通信できませんでした。オフラインの可能性があります（アプリはこのまま使えます）';
  return message ? `${fallback}（${message}）` : fallback;
}

/**
 * 起動時に1回だけ呼ぶ。
 *   ・メールのリンクから戻ってきた場合は、URLの引数を使ってログインを完了する
 *   ・以後はログイン状態の変化を監視する
 */
export async function initAuth(): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) {
    setState({ status: 'disabled' });
    return;
  }
  setState({ status: 'loading' });

  supabase.auth.onAuthStateChange((_event, session) => {
    setState(session ? { status: 'signed-in', email: session.user.email ?? null, userId: session.user.id } : { status: 'signed-out' });
  });

  await handleAuthCallback(supabase);

  const { data } = await supabase.auth.getSession();
  setState(
    data.session
      ? { status: 'signed-in', email: data.session.user.email ?? null, userId: data.session.user.id }
      : { status: 'signed-out' },
  );
}

/** メールのリンクから戻ってきたとき（?code=... または ?error=...）の処理 */
async function handleAuthCallback(supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error_description') ?? params.get('error');
  if (!code && !error) return;

  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    setAuthMessage(
      exchangeError
        ? { kind: 'error', text: describeError(exchangeError, 'ログインを完了できませんでした') }
        : { kind: 'success', text: 'ログインしました' },
    );
  } else if (error) {
    setAuthMessage({ kind: 'error', text: `ログインできませんでした（${error}）` });
  }

  // URLに残った引数を消す（再読み込みで同じ処理が走らないように）。表示中の画面はそのまま
  params.delete('code');
  params.delete('error');
  params.delete('error_description');
  params.delete('error_code');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

/** ログイン用のリンクをメールで送る */
export async function sendMagicLink(email: string): Promise<AuthResult> {
  const invalid = validateEmail(email);
  if (invalid) return { ok: false, error: invalid };
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: 'クラウド同期が設定されていません' };

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: authRedirectUrl() },
  });
  return error ? { ok: false, error: describeError(error, 'メールを送信できませんでした') } : { ok: true };
}

export async function signOut(): Promise<AuthResult> {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: 'クラウド同期が設定されていません' };
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error: describeError(error, 'ログアウトできませんでした') };
  setState({ status: 'signed-out' });
  return { ok: true };
}
