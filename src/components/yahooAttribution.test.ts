import { describe, expect, it } from 'vitest';
import { YAHOO_ATTRIBUTION_HTML } from './YahooAttribution';

// Yahoo! のクレジット表示は、公式ガイドラインで「HTMLをそのまま使う」と決められている。
// うっかり書き換えてしまわないよう、内容を固定して確認する。
// 参照: https://developer.yahoo.co.jp/attribution/

describe('Yahoo! のクレジット表示（改変禁止）', () => {
  it('★指定された文言・リンク先・余白のとおりであること', () => {
    expect(YAHOO_ATTRIBUTION_HTML).toBe(
      '<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet -->\n' +
        '<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>\n' +
        '<!-- End Yahoo! JAPAN Web Services Attribution Snippet -->',
    );
  });

  it('リンク先はAPIの説明ページ（sitemap）', () => {
    expect(YAHOO_ATTRIBUTION_HTML).toContain('href="https://developer.yahoo.co.jp/sitemap/"');
  });

  it('色や文字サイズを変える指定を混ぜていない', () => {
    expect(YAHOO_ATTRIBUTION_HTML).not.toMatch(/class=|color|font-size/);
  });
});
