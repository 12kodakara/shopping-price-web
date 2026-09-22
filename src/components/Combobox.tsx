import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { matchesQuery } from '../lib/search';
import { PC_QUERY } from '../lib/useMediaQuery';

export interface ComboOption {
  /** 保存に使う値（商品ID・店舗ID） */
  value: string;
  /** 表示名 */
  label: string;
  /** 補足（ID・カテゴリ・種類など）。検索の対象にもなる */
  detail?: string;
}

/** 候補を一度に表示する上限（商品が数百件あっても重くならないように。残りは入力で絞り込む） */
const MAX_VISIBLE = 50;

/**
 * 入力して絞り込みながら選ぶ欄（商品・店舗の選択用）。外部ライブラリを使わない軽量な実装。
 *   ・タップ（クリック）で候補を表示、文字を入力すると部分一致で絞り込み（英字の大小・全角半角・前後の空白は無視）
 *   ・候補をタップ、または ↑↓ と Enter で決定。Esc で閉じる
 *   ・決めた後も、もう一度タップすれば選び直せる
 *   ・保存するのは value（ID）。表示名では保存しない
 * 候補は入力欄のすぐ下に表示するので、スマホで画面下からキーボードが出ても候補が隠れにくい。
 */
export function Combobox({
  id,
  value,
  options,
  onChange,
  placeholder,
  emptyText,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder: string;
  emptyText: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = `${useId()}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);
  const selectedText = selected ? `${selected.label}（${selected.value}）` : '';
  const matches = open ? options.filter((o) => matchesQuery(query, [o.label, o.value, o.detail])) : [];
  const visible = matches.slice(0, MAX_VISIBLE);

  function openList() {
    if (open) return;
    setOpen(true);
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    // スマホ: 項目名（「商品」など）ごと画面の上の方へ動かし、その下の候補がキーボードに隠れないようにする
    if (!window.matchMedia(PC_QUERY).matches) {
      requestAnimationFrame(() => {
        const target = inputRef.current?.closest('.field') ?? inputRef.current;
        target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  }

  function close() {
    setOpen(false);
    setQuery('');
  }

  function choose(option: ComboOption) {
    onChange(option.value);
    close();
    // 決めたらキーボードを閉じる（スマホ）
    inputRef.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && visible[active]) {
        e.preventDefault();
        choose(visible[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        close();
      }
    }
  }

  const activeOption = open ? visible[active] : undefined;

  return (
    <div className={`combobox${open ? ' is-open' : ''}`} data-testid={`${id}-combobox`}>
      <div className="combobox-field">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          enterKeyHint="done"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${listId}-${activeOption.value}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-value={value}
          value={open ? query : selectedText}
          placeholder={open && selectedText ? selectedText : placeholder}
          // 指が触れた瞬間に開く。別の選択欄の候補が開いていると、押した瞬間にそれが閉じて画面の位置がずれるため、
          // クリック（指を離したとき）まで待つと、押したつもりの欄が開かないことがある
          onPointerDown={openList}
          onClick={openList}
          onChange={(e) => {
            if (!open) openList();
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={close}
        />
        <span className="combobox-caret" aria-hidden="true">▾</span>
      </div>
      {open && (
        // mousedown を止めて、候補を押したときに入力欄のフォーカスが外れて閉じてしまうのを防ぐ
        <ul className="combobox-list" id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {visible.length === 0 ? (
            <li className="combobox-empty" role="presentation">{emptyText}</li>
          ) : (
            visible.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${o.value}`}
                role="option"
                aria-selected={o.value === value}
                data-value={o.value}
                className={`combobox-option${i === active ? ' is-active' : ''}${o.value === value ? ' is-selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <span className="combobox-label">{o.label}</span>
                {o.detail && <span className="combobox-detail">{o.detail}</span>}
              </li>
            ))
          )}
          {matches.length > MAX_VISIBLE && (
            <li className="combobox-more" role="presentation">
              ほか{matches.length - MAX_VISIBLE}件。名前やIDを入力して絞り込んでください
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
