/**
 * 商品・店舗の「使用停止」「削除」操作（編集フォームの下部に表示）。
 * 過去の価格履歴を壊さないよう、履歴があるものは削除できず、使用停止だけを選べる。
 */
export function ArchiveControls({
  kind,
  name,
  archived,
  usedCount,
  onArchive,
  onDelete,
}: {
  kind: '商品' | '店舗';
  name: string;
  archived: boolean;
  usedCount: number;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
}) {
  function archive() {
    const ok = window.confirm(
      `${kind}「${name}」を使用停止にします。\n\n` +
        `・価格登録の選択肢、価格比較、買い物候補に表示されなくなります\n` +
        `・これまでの価格履歴（${usedCount}件）は残ります\n` +
        `・あとから「使用を再開する」で戻せます\n\nよろしいですか？`,
    );
    if (ok) onArchive(true);
  }

  function remove() {
    const ok = window.confirm(`${kind}「${name}」を削除します。\n価格履歴はありません。削除すると元に戻せません。\n\n本当に削除しますか？`);
    if (ok) onDelete();
  }

  return (
    <div className="archive-controls" aria-label={`${kind}の使用停止・削除`}>
      <h3>使用停止・削除</h3>
      {archived ? (
        <>
          <p className="muted small">この{kind}は使用停止中です。価格履歴は残っています。</p>
          <button type="button" className="button button-outline button-sm" onClick={() => onArchive(false)}>
            使用を再開する
          </button>
        </>
      ) : (
        <>
          <p className="muted small">使わなくなった{kind}は「使用停止」にしてください。価格履歴は残ります。</p>
          <button type="button" className="button button-ghost button-sm" onClick={archive}>
            使用停止にする
          </button>
        </>
      )}
      {usedCount > 0 ? (
        <p className="muted small" data-testid="delete-blocked">
          価格履歴が{usedCount}件あるため、この{kind}は削除できません（履歴を守るため）。
        </p>
      ) : (
        <button type="button" className="button button-danger button-sm" onClick={remove}>
          この{kind}を削除
        </button>
      )}
    </div>
  );
}
