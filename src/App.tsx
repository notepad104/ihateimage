import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
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

export default function App() {
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
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
