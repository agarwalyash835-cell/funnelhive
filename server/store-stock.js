// Stock back from a store order (store.js takes it as SALE moves tagged "Order <id>"): on a refund, a cancelled COD order
// or a return to origin (RTO), what left for each item goes back — to the godown it left from, never more than left, so a
// refund after an RTO (or a second refund call) adds nothing twice. Kept apart from store.js so sales.js / fulfilment.js
// can call it without importing the store (and its checkout) into the payment code.
import { T } from './db.js';
import { addMove } from './inventory-core.js';

export function returnStock(order, items, why = 'returned') {
  if (!order?.id) return 0;
  const ref = `Order ${order.id}`;
  let moved = 0;
  for (const it of items || []) {
    if (!it?.itemId || !(Number(it.qty) > 0)) continue;
    const moves = T.imoves.all({ itemId: it.itemId }).filter((m) => m.userId === order.userId && m.ref === ref);
    const out = -moves.filter((m) => m.kind === 'SALE').reduce((s, m) => s + (Number(m.qty) || 0), 0);
    const back = moves.filter((m) => m.kind === 'RETURN_IN').reduce((s, m) => s + (Number(m.qty) || 0), 0);
    const qty = Math.min(Number(it.qty), Math.round((out - back) * 1000) / 1000);
    if (!(qty > 0)) continue;
    try {
      addMove(order.userId, { itemId: it.itemId, godownId: moves.find((m) => m.kind === 'SALE')?.godownId || null, kind: 'RETURN_IN', qty, rate: it.unitPrice, party_name: order.name || order.email || order.phone || 'Store buyer', ref, note: why, source: 'MANUAL' });
      moved += qty;
    } catch (e) { console.error('store stock return failed', e.message); }
  }
  return moved;
}
