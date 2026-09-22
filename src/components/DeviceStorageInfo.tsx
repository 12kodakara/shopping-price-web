import { useEffect, useState } from 'react';

/** ホーム画面のアプリとして開いているか（ブラウザの枠なし） */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iPhone の Safari（ホーム画面から開いたとき）
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * データ管理画面の「この端末での保存」欄。
 * ・ホーム画面のアプリとして開いているかどうか
 * ・データを消えにくくする設定（ブラウザが対応している場合のみ。navigator.storage.persist）
 * ・iPhone ではブラウザとホーム画面のアプリでデータが別になる注意
 * データの保存先（localStorage）や形式は変えない。
 */
export function DeviceStorageInfo() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const supported = typeof navigator !== 'undefined' && !!navigator.storage?.persisted;

  useEffect(() => {
    if (!supported) return;
    navigator.storage.persisted().then(setPersisted, () => setPersisted(null));
  }, [supported]);

  async function requestPersist() {
    try {
      setPersisted(await navigator.storage.persist());
    } catch {
      setPersisted(false);
    }
  }

  return (
    <section className="card" aria-labelledby="device-heading" data-testid="device-storage">
      <h2 id="device-heading">この端末での保存</h2>
      <dl className="kv">
        <div>
          <dt>開き方</dt>
          <dd data-testid="display-mode">{isStandalone() ? 'ホーム画面のアプリ' : 'ブラウザ'}</dd>
        </div>
        {supported && (
          <div>
            <dt>消えにくい保存</dt>
            <dd data-testid="persist-status">{persisted === null ? '確認中' : persisted ? '有効' : '未設定'}</dd>
          </div>
        )}
      </dl>
      {supported && persisted === false && (
        <div className="card-actions">
          <button type="button" className="button button-ghost button-sm" onClick={requestPersist}>
            データを消えにくくする
          </button>
        </div>
      )}
      <p className="muted small">
        「消えにくい保存」を有効にすると、端末の空き容量が少なくなったときにブラウザがデータを自動で消しにくくなります（ブラウザによっては、ホーム画面に追加すると自動で有効になります）。
      </p>
      <p className="muted small">
        iPhone では、Safari で開いたときと、ホーム画面に追加したアプリで開いたときのデータが別々に保存されます。
        Safari で入力したデータをアプリで使うときは、Safari で「バックアップを保存」し、アプリ側で「バックアップから復元」してください。
      </p>
    </section>
  );
}
