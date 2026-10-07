import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { loggedIn } from './api';
import { Toaster } from './ui';
import Auth from './pages/Auth';
import { Verify, Reset } from './pages/AuthLinks';
import Dashboard from './pages/Dashboard';
import Funnels from './pages/Funnels';
import Editor from './pages/Editor';
import Analytics from './pages/Analytics';
import Contacts from './pages/Contacts';
import Orders from './pages/Orders';
import Settings from './pages/Settings';
import Hive from './pages/Hive';
import Automations from './pages/Automations';
import Billing from './pages/Billing';
import Invoice from './pages/Invoice';
import Admin from './pages/Admin';
import Landing from './pages/Landing';
import { Terms, Privacy, Refunds, Contact } from './pages/Legal';
import Public from './pages/Public';
import { TemplateGallery, TemplatePreview } from './pages/Templates';
import './styles.css';
import './page-variants.css';

const Private = ({ children }) => (loggedIn() ? children : <Navigate to="/login" />);

// A seller's own domain only ever shows their funnel
const onDomain = typeof window !== 'undefined' && !!window.__FF_DOMAIN__;

createRoot(document.getElementById('root')).render(onDomain ? (
  <BrowserRouter>
    <Routes>
      <Route path="/:step?" element={<Public />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
) : (
  <BrowserRouter>
    <Toaster />
    <Routes>
      <Route path="/login" element={<Auth />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="/" element={loggedIn() ? <Dashboard /> : <Landing />} />
      <Route path="/pricing" element={<Landing />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/refunds" element={<Refunds />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/funnels" element={<Private><Funnels /></Private>} />
      <Route path="/funnels/:id" element={<Private><Editor /></Private>} />
      <Route path="/funnels/:id/analytics" element={<Private><Analytics /></Private>} />
      <Route path="/contacts/:key?" element={<Private><Contacts /></Private>} />
      <Route path="/orders" element={<Private><Orders /></Private>} />
      <Route path="/settings" element={<Private><Settings /></Private>} />
      <Route path="/hive" element={<Private><Hive /></Private>} />
      <Route path="/billing" element={<Private><Billing /></Private>} />
      <Route path="/billing/invoices/:id" element={<Private><Invoice /></Private>} />
      <Route path="/admin" element={<Private><Admin /></Private>} />
      <Route path="/admin/invoices/:id" element={<Private><Invoice admin /></Private>} />
      <Route path="/ai" element={<Navigate to="/hive" replace />} />
      <Route path="/automations/:id?" element={<Private><Automations /></Private>} />
      <Route path="/templates" element={<Private><TemplateGallery /></Private>} />
      <Route path="/t/:id" element={<TemplatePreview />} />
      <Route path="/f/:slug" element={<Public />} />
      <Route path="/f/:slug/:step" element={<Public />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
));
