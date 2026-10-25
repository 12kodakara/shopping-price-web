// Yahoo! JAPAN Web サービスのクレジット表示。
//
// JANコード検索で Yahoo!ショッピング商品検索API を使うため、公式のガイドラインに従って
// アプリの一番下に表示する（https://developer.yahoo.co.jp/attribution/）。
//
// ガイドラインの決まり
//   ・指定のHTMLをそのまま使う（文言・リンク先・余白を変えない）
//   ・色を変えたり、極端に小さくしたりしない
//   ・ウェブサイトの場合はアプリの下部に置く
//   ・サイトの中で最も目立つ要素にしない
//
// そのため、このHTMLには独自のCSSクラスを当てていない。
// 文字列をそのまま埋め込むのは、公式のコメント行も含めて原文どおりにするため。

/** 公式ガイドラインで指定されているHTML（改変禁止） */
export const YAHOO_ATTRIBUTION_HTML =
  '<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet -->\n' +
  '<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>\n' +
  '<!-- End Yahoo! JAPAN Web Services Attribution Snippet -->';

export function YahooAttribution() {
  return (
    <footer className="app-attribution" data-testid="yahoo-attribution">
      {/* 配置のための入れ物だけを用意し、中身（指定HTML）には手を加えない */}
      <div dangerouslySetInnerHTML={{ __html: YAHOO_ATTRIBUTION_HTML }} />
    </footer>
  );
}
