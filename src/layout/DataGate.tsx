import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RestorePanel } from '../components/RestorePanel';
import { useNotice } from '../components/ui';
import { useRepoSnapshot } from '../data/useAppData';
import { confirmAndReset, downloadRaw } from '../pages/SettingsPage';

/**
 * 保存データの状態に応じて、ページ本体か復旧画面を出す。
 * データが壊れていても、ナビゲーションを含むアプリ全体は表示されたままにする。
 */
export function DataGate({ children }: { children: ReactNode }) {
  const { status } = useRepoSnapshot();
  const notice = useNotice();

  if (status.kind === 'corrupt') {
    return (
      <section className="card recovery-card" role="alert" data-testid="data-error">
        <h1>保存データを読み込めませんでした</h1>
        <p>理由：{status.reason}</p>
        <p className="muted small">
          保存データはそのまま残してあり、自動で削除はしていません。
          バックアップファイルがあれば、そこから復元できます。ない場合は、先にデータを書き出してからサンプルデータに戻してください。
        </p>
        {notice.node}
        <div className="card-actions">
          <button type="button" className="button button-ghost" onClick={() => downloadRaw()}>
            保存データを書き出す
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={() => {
              const r = confirmAndReset();
              if (r.message) notice.show(r.message);
            }}
          >
            サンプルデータに戻す
          </button>
        </div>
        <h2 className="recovery-subheading">バックアップから復元</h2>
        <RestorePanel current={null} onDone={(m, k) => notice.show(m, k)} />
      </section>
    );
  }

  return (
    <>
      {status.kind === 'memory-only' && (
        <p className="warning-bar" role="status" data-testid="memory-only">
          {status.reason}。入力した内容は、画面を閉じると消えます。
        </p>
      )}
      {children}
    </>
  );
}

/** 表示中に予期しないエラーが起きても真っ白にせず、メッセージを出す */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="card recovery-card" role="alert" data-testid="page-error">
          <h1>画面を表示できませんでした</h1>
          <p className="muted small">{this.state.error.message}</p>
          <Link to="/" className="text-link">ホームへ戻る</Link>
        </section>
      );
    }
    return this.props.children;
  }
}
