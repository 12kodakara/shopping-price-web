import { useSyncExternalStore } from 'react';
import { repository, type RepoSnapshot } from './repository';
import type { AppData } from './types';

/** 保存状態を含むスナップショット。保存データが変わると再描画される */
export function useRepoSnapshot(): RepoSnapshot {
  return useSyncExternalStore(repository.subscribe, repository.getSnapshot);
}

/**
 * 保存データ。データが壊れている間は各ページが表示されない（DataGate が復旧画面を出す）ため、
 * ページ内では常にデータがある前提で使える。
 */
export function useAppData(): AppData {
  const { data } = useRepoSnapshot();
  if (!data) throw new Error('保存データを読み込めません');
  return data;
}
