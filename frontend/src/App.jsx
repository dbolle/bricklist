import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import HomePage from './pages/HomePage.jsx'
import SearchPage from './pages/SearchPage.jsx'
import FindPage from './pages/FindPage.jsx'
import BinsPage from './pages/BinsPage.jsx'
import BinPage from './pages/BinPage.jsx'
import ProjectPage from './pages/ProjectPage.jsx'
import GroupPage from './pages/GroupPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/find" element={<FindPage />} />
          <Route path="/bins" element={<BinsPage />} />
          <Route path="/bins/:id" element={<BinPage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/groups/:id" element={<GroupPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
