import { describe, expect, it } from 'vitest';
import { validateEmail } from './auth';
import { looksLikeSecretKey, readCloudConfig } from './config';

// クラウド接続設定の読み取り（第11回）。実際のキーは使わない。

const url = 'https://example-project.supabase.co';
const publishable = 'sb_publishable_testtesttest';

describe('接続設定の読み取り', () => {
  it('未設定なら null（クラウド機能は無効）', () => {
    expect(readCloudConfig({})).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' })).toBeNull();
  });

  it('新しい名前・従来の名前のどちらでも読める', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: publishable })).toEqual({ url, key: publishable });
    expect(readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'anon-key' })).toEqual({ url, key: 'anon-key' });
    // 前後の空白は無視する
    expect(readCloudConfig({ VITE_SUPABASE_URL: ` ${url} `, VITE_SUPABASE_ANON_KEY: ' anon-key ' })).toEqual({ url, key: 'anon-key' });
  });

  it('片方だけ・URLの形式が不正なら無効（アプリは通常どおり動く）', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: url })).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_ANON_KEY: 'anon-key' })).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'not-a-url', VITE_SUPABASE_ANON_KEY: 'anon-key' })).toBeNull();
    // http は localhost（開発・テスト）だけ許す
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:5399/mock', VITE_SUPABASE_ANON_KEY: 'k' })).not.toBeNull();
  });

  it('管理用の秘密キーが設定されていたら使わない（誤設定の検出）', () => {
    const jwt = (role: string) => `header.${btoa(JSON.stringify({ role }))}.signature`;
    expect(looksLikeSecretKey('sb_secret_abc')).toBe(true);
    expect(looksLikeSecretKey(jwt('service_role'))).toBe(true);
    expect(looksLikeSecretKey(jwt('anon'))).toBe(false);
    expect(looksLikeSecretKey(publishable)).toBe(false);
    expect(readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: jwt('service_role') })).toBeNull();
  });
});

describe('メールアドレスの確認', () => {
  it('空欄・形式不正を弾く', () => {
    expect(validateEmail('')).toBe('メールアドレスを入力してください');
    expect(validateEmail('   ')).toBe('メールアドレスを入力してください');
    expect(validateEmail('abc')).toBe('メールアドレスの形式が正しくありません');
    expect(validateEmail('abc@example')).toBe('メールアドレスの形式が正しくありません');
  });

  it('正しい形式なら null', () => {
    expect(validateEmail('user@example.com')).toBeNull();
    expect(validateEmail('  user@example.co.jp  ')).toBeNull();
  });
});
