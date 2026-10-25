import { useState } from 'react';
import { useAuthState } from '../cloud/auth';
import { lookupJan, normalizeJan, type JanCandidate } from '../cloud/janLookup';

/**
 * JANコードで商品を探して、商品名・メーカーを入力欄へ入れる（商品登録・編集の中で使う）。
 *
 * ・ログイン中だけ使える（Yahoo! の Client ID はサーバー側にあり、ブラウザには無い）
 * ・見つからない・使えないときも、これまでどおり手で入力して登録できる
 * ・勝手に書き換えない。候補の「この内容を使う」を押したときだけ入力欄へ反映する
 *   （すでに入っている内容と違う場合は、置き換えてよいか確認する）
 * ・商品画像は確認用に表示するだけで、保存はしない（第22回時点）
 * ・反映するときは、探したJANコードも一緒に渡す（商品に保存できるようにするため）
 */
export function JanSearch({
  currentName,
  currentMaker,
  onApply,
}: {
  currentName: string;
  currentMaker: string;
  onApply: (picked: { name: string; maker: string; jan: string }) => void;
}) {
  const auth = useAuthState();
  const [jan, setJan] = useState('');
  /** 検索に成功したJANコード（半角の数字だけにそろえたもの）。反映するときに商品へ渡す */
  const [foundJan, setFoundJan] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<JanCandidate[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const usable = auth.status === 'signed-in';

  async function handleSearch() {
    setMessage(null);
    setCandidates(null);
    setFoundJan(normalizeJan(jan) ?? '');
    setSearching(true);
    const result = await lookupJan(jan).finally(() => setSearching(false));
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    if (result.candidates.length === 0) {
      setMessage('この JANコードの商品は見つかりませんでした。下の欄に手で入力してください。');
      return;
    }
    setCandidates(result.candidates);
  }

  function handleApply(candidate: JanCandidate) {
    // すでに入っている内容と違うときは、置き換えてよいか確かめる（勝手に上書きしない）
    const willChange =
      (currentName.trim() !== '' && currentName.trim() !== candidate.name) ||
      (currentMaker.trim() !== '' && currentMaker.trim() !== candidate.brand);
    if (willChange && !window.confirm(`入力済みの内容を「${candidate.name}」に置き換えますか？`)) return;
    onApply({ name: candidate.name, maker: candidate.brand, jan: candidate.jan || foundJan });
    setMessage(`「${candidate.name}」を入力欄に入れました。内容を確認してから登録してください。`);
    setCandidates(null);
  }

  return (
    <div className="jan-search" data-testid="jan-search">
      <label htmlFor="jan-code">JANコードで探す（任意）</label>
      {!usable ? (
        <p className="muted small" data-testid="jan-search-disabled">
          JANコード検索はログイン中だけ使えます。ログインしなくても、下の欄に手で入力すれば登録できます。
        </p>
      ) : (
        <>
          <div className="jan-search-row">
            <input
              id="jan-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="例: 4902102072618"
              value={jan}
              onChange={(e) => setJan(e.target.value)}
            />
            <button
              type="button"
              className="button button-sm"
              onClick={() => void handleSearch()}
              disabled={searching || jan.trim() === ''}
              data-testid="jan-search-button"
            >
              {searching ? '検索中…' : 'JANで検索'}
            </button>
          </div>
          <p className="muted small">パッケージのバーコードの数字です。見つからないときは手入力でも登録できます。</p>
        </>
      )}

      {message && (
        <p className="muted small" role="status" data-testid="jan-search-message">
          {message}
        </p>
      )}

      {candidates && (
        <ul className="jan-candidates" data-testid="jan-candidates">
          {candidates.map((c) => (
            <li key={`${c.name}-${c.brand}`} className="jan-candidate">
              {c.imageUrl ? (
                // 画像は確認用の表示だけ（保存しない）
                <img className="jan-candidate-image" src={c.imageUrl} alt="" width={56} height={56} loading="lazy" />
              ) : (
                <span className="jan-candidate-image jan-candidate-noimage" aria-hidden="true">
                  画像なし
                </span>
              )}
              <span className="jan-candidate-text">
                <span className="jan-candidate-name">{c.name}</span>
                {c.brand && <span className="muted small">{c.brand}</span>}
              </span>
              <button
                type="button"
                className="button button-sm button-primary"
                onClick={() => handleApply(c)}
                data-testid={`jan-apply-${c.name}`}
              >
                この内容を使う
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
