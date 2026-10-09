// Time display for funnel pages and the dashboard. A "zone" is an IANA name (Europe/London) or, for older
// calendars and webinars, a fixed offset in minutes (330 = India).
import { useEffect, useState } from 'react';

export const viewerTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch { return 'Asia/Kolkata'; } };
// the visitor's zone once the page is running in their browser (the server render uses the host's zone)
export function useViewerTz() {
  const [z, setZ] = useState(null);
  useEffect(() => { setZ(viewerTz()); }, []);
  return z;
}
const fixed = (z) => typeof z === 'number' || /^-?\d+$/.test(String(z));
const shifted = (t, z) => new Date(t + Number(z) * 60000);
export function zoneLabel(z, t = Date.now()) {
  if (fixed(z)) { const off = Number(z); return off === 330 ? 'IST' : `UTC${off >= 0 ? '+' : '−'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${String(Math.abs(off) % 60).padStart(2, '0')}` : ''}`; }
  if (z === 'Asia/Kolkata' || z === 'Asia/Calcutta') return 'IST';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'short' }).formatToParts(new Date(t)).find((x) => x.type === 'timeZoneName')?.value || z; } catch { return z; }
}
export const zoneCity = (z) => (fixed(z) ? zoneLabel(z) : String(z).split('/').pop().replace(/_/g, ' '));
export function dayKey(t, z) {
  if (fixed(z)) return shifted(t, z).toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}
export const fmtDay = (t, z) => (fixed(z) ? shifted(t, z).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }) : new Date(t).toLocaleDateString('en-IN', { timeZone: z, weekday: 'short', day: 'numeric', month: 'short' }));
export const fmtTime = (t, z) => (fixed(z) ? shifted(t, z).toLocaleTimeString('en-IN', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true }) : new Date(t).toLocaleTimeString('en-IN', { timeZone: z, hour: 'numeric', minute: '2-digit', hour12: true }));
export const fmtWhenShort = (t, z) => `${fmtDay(t, z)}, ${fmtTime(t, z)} ${zoneLabel(z, t)}`;
// every zone the browser knows (for pickers), common ones first
export const COMMON_TZ = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Karachi', 'Asia/Colombo', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland', 'Europe/London', 'Europe/Dublin', 'Europe/Berlin', 'Europe/Paris', 'Europe/Amsterdam', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo', 'America/Mexico_City', 'UTC'];
export function allZones() { let all = []; try { all = Intl.supportedValuesOf('timeZone'); } catch {} return [...COMMON_TZ, ...all.filter((z) => !COMMON_TZ.includes(z))]; }
export const zoneOption = (z) => `${z.replace(/_/g, ' ')} (${zoneLabel(z)})`;

// the seller's business time zone (Settings → Business profile), loaded once
let bizTz = null, bizP = null;
export function useBizTz() {
  const [z, setZ] = useState(bizTz || 'Asia/Kolkata');
  useEffect(() => {
    if (bizTz) return;
    bizP ||= import('./api').then(({ api }) => api('/me')).then((m) => (bizTz = m.settings?.timezone || 'Asia/Kolkata')).catch(() => 'Asia/Kolkata');
    bizP.then(setZ);
  }, []);
  return z;
}
