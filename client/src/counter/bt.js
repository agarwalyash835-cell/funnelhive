// Bluetooth (BLE) thermal printers through Web Bluetooth — Chrome on Android (and desktop Chrome / Edge). iOS Safari
// has no Web Bluetooth: there, and wherever pairing fails, the counter prints through the browser's print view.
// Pair once: the printer is remembered (its id in localStorage; Chrome's getDevices() gives it back after a reload
// where supported). Common printer services are listed so Chrome lets us use them; the first writable characteristic wins.
import { sendChunks } from './escpos';

const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // most 58 / 80 mm ESC/POS printers (char 2af1)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // many "BlueTooth Printer" / MTP / Goojprt
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC transparent UART
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style serial
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb', // cat / mini printers
];
const KEY = 'ff_counter_printer';
export const btSupported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;
export const savedPrinter = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const remember = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };
export const forgetPrinter = () => { try { localStorage.removeItem(KEY); } catch {} device = null; ch = null; };
export const setPrinterWidth = (width) => { const p = savedPrinter(); if (p) remember({ ...p, width }); };

let device = null, ch = null;
async function writable(server) {
  for (const uuid of SERVICES) {
    let svc;
    try { svc = await server.getPrimaryService(uuid); } catch { continue; }
    for (const c of await svc.getCharacteristics()) if (c.properties.writeWithoutResponse || c.properties.write) return c;
  }
  throw new Error('This printer has no print channel we know — try another printer, or print from the browser');
}
async function connect() {
  if (ch && device?.gatt?.connected) return ch;
  if (!device) {
    const p = savedPrinter();
    if (p && navigator.bluetooth.getDevices) device = (await navigator.bluetooth.getDevices().catch(() => [])).find((d) => d.id === p.id) || null;
  }
  if (!device) throw Object.assign(new Error('Connect the printer first'), { code: 'NOT_PAIRED' });
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  ch = await writable(server);
  return ch;
}
// needs a tap (Chrome asks the person to pick the printer)
export async function pairPrinter(width = 58) {
  if (!btSupported()) throw new Error('Bluetooth printing needs Chrome on Android (or desktop Chrome)');
  device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  device.addEventListener('gattserverdisconnected', () => { ch = null; });
  ch = null;
  await connect();
  const p = { id: device.id, name: device.name || 'Printer', width: savedPrinter()?.width || width, chunk: savedPrinter()?.chunk || 180 };
  remember(p);
  return p;
}
export async function printBytes(bytes) {
  const c = await connect(), p = savedPrinter() || {};
  const write = (chunk) => (c.properties.writeWithoutResponse && c.writeValueWithoutResponse ? c.writeValueWithoutResponse(chunk) : c.writeValueWithResponse ? c.writeValueWithResponse(chunk) : c.writeValue(chunk));
  try {
    const r = await sendChunks(bytes, write, { size: p.chunk || 180 });
    if (r.size !== p.chunk) remember({ ...p, chunk: r.size });
  } catch (e) { ch = null; throw e; }
}
