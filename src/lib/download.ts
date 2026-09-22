import { repository, type Result } from '../data/repository';

/** 文字列をファイルとしてダウンロードさせる */
export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 現在の保存データをバックアップファイルとして保存する。成功したらファイル名を返す */
export function downloadBackup(): Result<string> {
  const backup = repository.createBackup();
  if (!backup.ok) return backup;
  downloadText(backup.value.filename, backup.value.json);
  return { ok: true, value: backup.value.filename };
}

/** 壊れた保存データを、そのままの形でファイルに書き出す（復旧の相談・調査用） */
export function downloadRaw(): boolean {
  const raw = repository.exportRaw();
  if (raw === null) return false;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  downloadText(`shopping-price-raw-${stamp}.json`, raw);
  return true;
}
