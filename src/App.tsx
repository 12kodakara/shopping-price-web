import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { ComparePage } from './pages/ComparePage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { PriceNewPage } from './pages/PriceNewPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProductsPage } from './pages/ProductsPage';
import { ShoppingPage } from './pages/ShoppingPage';
import { StoresPage } from './pages/StoresPage';

/**
 * 公開先のパス（例: GitHub Pages なら /<リポジトリ名>/）。通常は /。
 * 末尾の / を残すことで、ホームへの移動が /<リポジトリ名>/ になる（Service Worker の範囲 /<リポジトリ名>/ の内側）。
 */
const basename = import.meta.env.BASE_URL;

export function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/prices/new" element={<PriceNewPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/shopping" element={<ShoppingPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/stores" element={<StoresPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <div className="card">
                <h1>ページが見つかりません</h1>
                <Link to="/" className="text-link">ホームへ戻る</Link>
              </div>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
