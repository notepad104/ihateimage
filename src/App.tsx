import { Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useSeo } from './components/Seo'
import { AspectRatioPage } from './pages/AspectRatioPage'
import { BeautifyPage } from './pages/BeautifyPage'
import { CompressPage } from './pages/CompressPage'
import { ConvertPage } from './pages/ConvertPage'
import { Home } from './pages/Home'
import { MetadataPage } from './pages/MetadataPage'
import { NotFound } from './pages/NotFound'
import { RemoveBackgroundPage } from './pages/RemoveBackgroundPage'
import { RemoveObjectsPage } from './pages/RemoveObjectsPage'
import { ResizePage } from './pages/ResizePage'
import { RotatePage } from './pages/RotatePage'
import { WatermarkPage } from './pages/WatermarkPage'

export default function App() {
  const { pathname } = useLocation()
  useSeo(pathname)
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/compress" element={<CompressPage />} />
        <Route path="/resize" element={<ResizePage />} />
        <Route path="/aspect-ratio" element={<AspectRatioPage />} />
        <Route path="/convert" element={<ConvertPage />} />
        <Route path="/rotate" element={<RotatePage />} />
        <Route path="/remove-background" element={<RemoveBackgroundPage />} />
        <Route path="/beautify" element={<BeautifyPage />} />
        <Route path="/remove-objects" element={<RemoveObjectsPage />} />
        <Route path="/metadata" element={<MetadataPage />} />
        <Route path="/watermark" element={<WatermarkPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
