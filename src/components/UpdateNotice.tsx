import { applyUpdate, useUpdateAvailable } from '../pwa/register';

/**
 * 新しいバージョンの案内。自動では再読み込みせず、利用者が「更新する」を押したときだけ切り替える。
 * 登録したデータは端末に保存済みなので更新で消えないが、入力途中のフォームの内容は消えるため、その旨を添える。
 */
export function UpdateNotice() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      <div>
        <strong>新しいバージョンがあります</strong>
        <p>登録したデータはそのまま残ります。入力途中の内容は消えるので、区切りのよいときに更新してください。</p>
      </div>
      <button type="button" className="button button-primary button-sm" onClick={applyUpdate}>
        更新する
      </button>
    </div>
  );
}
