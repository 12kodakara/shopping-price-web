import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { formatYen } from '../lib/price';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
}

/** 価格表示（数字を大きく、単位を小さく） */
export function Price({ value, unit, size = 'md' }: { value: number | null; unit?: string; size?: 'sm' | 'md' | 'lg' }) {
  if (value === null) return <span className="price price-empty">—</span>;
  return (
    <span className={`price price-${size}`}>
      <span className="price-num">{formatYen(value)}</span>
      <span className="price-unit">円{unit ? `/${unit}` : ''}</span>
    </span>
  );
}

/** 目安との差（マイナス＝安い）。hasTarget=false なら「目安未設定」、差が出せなければ「価格未登録」 */
export function DiffBadge({ diff, hasTarget = true }: { diff: number | null; hasTarget?: boolean }) {
  if (!hasTarget) return <span className="badge badge-neutral">目安未設定</span>;
  if (diff === null) return <span className="badge badge-neutral">価格未登録</span>;
  if (diff < 0) return <span className="badge badge-good">目安より{formatYen(-diff)}円安い</span>;
  if (diff === 0) return <span className="badge badge-good">目安と同じ</span>;
  return <span className="badge badge-warn">目安より{formatYen(diff)}円高い</span>;
}

export function Badge({ kind, children }: { kind: 'good' | 'best' | 'warn' | 'neutral' | 'sale'; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

type NoticeKind = 'success' | 'error' | 'info';

/** 画面下部に数秒だけ出る一時メッセージ */
export function useNotice() {
  const [notice, setNotice] = useState<{ message: string; kind: NoticeKind; key: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.kind === 'error' ? 5000 : 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const show = useCallback((message: string, kind: NoticeKind = 'info') => setNotice({ message, kind, key: Date.now() }), []);
  const node = notice ? (
    <div key={notice.key} className={`notice notice-${notice.kind}`} role="status">
      {notice.message}
    </div>
  ) : null;
  return { show, node };
}

/** 入力欄の下に出すエラー表示 */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  );
}

/** 入力欄に付ける aria 属性（エラー時に読み上げ・強調される） */
export function errorProps(id: string, message?: string) {
  return message ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};
}
