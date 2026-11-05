// Versions: every change to a Studio item is undoable. Before an edit is applied (studio/edit.js, the Reel and redo
// routes, Hive), the item is snapshotted — its own fields and, for a Reel, the state of every shot's picture and clip.
// "Undo" puts the last snapshot back; any snapshot can be brought back, and the newest is shown beside the current one
// to compare. Files are never deleted by an edit (a redo writes a new file), so a snapshot's links stay good — only a
// design's slides are re-drawn on restore (they're free and the old ones are removed when re-drawn).
//   row.versions = [{ n, at, label, by, data, kids }]  (oldest first, at most MAX_VERSIONS)
// Rows a Reel no longer uses and no kept version needs (a clip made again, a scene dropped) are removed with their
// files when versions roll off: the storage is given back.
import { T } from '../db.js';
import { dropAsset, dropFiles } from './jobs.js';

export const MAX_VERSIONS = 8;
const ACTIVE = ['queued', 'rendering', 'checking'];
// what a snapshot keeps, by kind
const KEYS = {
  reel: ['script', 'shots', 'lines', 'captions', 'sizes', 'voice', 'music', 'musicUrl', 'musicDb', 'grade', 'logoOpts', 'cardStyle', 'cardColour', 'outputs', 'url', 'poster', 'duration', 'lufs', 'status', 'review', 'standard', 'gate', 'qa', 'autoFixed', 'words'],
  image: ['url', 'poster', 'bytes', 'prompt', 'basePrompt', 'edits', 'ref', 'refs', 'status', 'qa', 'fix', 'notes', 'enhanced', 'res', 'doneAt'],
  clip: ['url', 'poster', 'bytes', 'prompt', 'ref', 'status', 'qa', 'fix', 'notes', 'enhanced', 'res', 'seconds', 'doneAt'],
  design: ['slides', 'colours', 'family', 'format', 'photo', 'photo2', 'bg', 'bgUrl', 'bgPrompt', 'bgId', 'brand', 'status', 'typography'],
};
const KID = ['url', 'poster', 'bytes', 'prompt', 'basePrompt', 'edits', 'ref', 'status', 'qa', 'fix', 'notes', 'doneAt'];
const pick = (x, keys) => Object.fromEntries(keys.filter((k) => x[k] !== undefined).map((k) => [k, structuredClone(x[k])]));
const kidIds = (shots = []) => shots.flatMap((s) => [s.imageId, s.endId, s.clipId]).filter(Boolean);

// busy: something of it is still being made — it can't be snapshotted consistently or put back yet
export function busyOf(row) {
  if (!row) return true;
  if (row.kind === 'reel') return ['producing', 'editing'].includes(row.status) || kidIds(row.shots).some((id) => ACTIVE.includes(T.studio.get(id)?.status));
  return ACTIVE.includes(row.status) || row.status === 'producing';
}

// keep the item as it is now, labelled with the change about to be made → the row
export function snapshot(id, label = 'Before a change', by = null) {
  const row = T.studio.get(id);
  if (!row || !KEYS[row.kind]) return row;
  const kids = row.kind === 'reel' ? Object.fromEntries(kidIds(row.shots).map((k) => [k, T.studio.get(k)]).filter(([, a]) => a).map(([k, a]) => [k, pick(a, KID)])) : null;
  let gone = [];
  const out = T.studio.update(id, (x) => {
    const n = (x.versionNo || 0) + 1;
    x.versionNo = n;
    const all = [...(x.versions || []), { n, at: Date.now(), label: String(label).slice(0, 120), by, data: pick(x, KEYS[x.kind]), ...(kids ? { kids } : {}) }];
    gone = all.slice(0, Math.max(0, all.length - MAX_VERSIONS));
    x.versions = all.slice(-MAX_VERSIONS);
  });
  // the oldest version rolled off: its files go (unless still used), and a Reel's shots no version needs
  if (gone.length) release(out, gone, out.versions);
  if (row.kind === 'reel') prune(out);
  return out;
}

// a version → { n, at, label, by, url, poster, outputs } as the seller sees it (newest first)
export const versionsOf = (row) => (row?.versions || []).slice().reverse().map((v) => ({ n: v.n, at: v.at, label: v.label, by: v.by || null, url: v.data.url || v.data.outputs?.[0]?.url || null, poster: v.data.poster || null, ...(v.data.outputs && !Array.isArray(v.data.outputs) ? { outputs: v.data.outputs } : {}) }));

// bring a version back (the last one when n is left out); the current state is snapshotted first, so going back can
// itself be undone. → { row } | { error }. A design is re-drawn by the caller (renderDesign) — `redraw: true`.
export function restore(id, n = null, by = null) {
  const row = T.studio.get(id);
  if (!row?.versions?.length) return { error: 'There’s nothing to go back to' };
  if (busyOf(row)) return { error: 'It’s still being made — go back once it’s finished' };
  const v = n == null ? row.versions.at(-1) : row.versions.find((x) => x.n === Number(n));
  if (!v) return { error: 'That version isn’t kept any more' };
  // a Reel's pictures and clips go back too: every one the version used must still be there
  if (v.kids && Object.keys(v.kids).some((k) => !T.studio.get(k))) return { error: 'Part of that version isn’t kept any more' };
  snapshot(id, `Before going back to version ${v.n}`, by);
  for (const [k, data] of Object.entries(v.kids || {})) T.studio.update(k, (y) => { for (const key of KID) delete y[key]; Object.assign(y, structuredClone(data)); delete y.taskId; y.attempts = 0; });
  const out = T.studio.update(id, (x) => {
    for (const key of KEYS[x.kind]) delete x[key];
    Object.assign(x, structuredClone(v.data));
    // the version brought back is still in the list (it can be compared again); the newest snapshot is "before going back"
    x.restoredFrom = v.n; delete x.error; delete x.reviewing;
  });
  return { row: out, redraw: row.kind === 'design' };
}

// a Reel's pictures and clips that neither the Reel nor any kept version uses: removed (with their files)
// (jobs.js dropAsset removes the row and its files, keeps a file another row still uses, and waits for a busy row)
export function prune(reel) {
  if (!reel || reel.kind !== 'reel') return 0;
  const keep = new Set([...kidIds(reel.shots), ...(reel.versions || []).flatMap((v) => [...kidIds(v.data.shots), ...Object.keys(v.kids || {})])]);
  const rows = T.studio.all({ userId: reel.userId });
  // variations share their parent's shots (variations.js): a row another Reel (or its versions) still uses stays
  for (const o of rows) if (o.kind === 'reel' && o.id !== reel.id) for (const k of [...kidIds(o.shots), ...(o.versions || []).flatMap((v) => kidIds(v.data.shots))]) keep.add(k);
  let n = 0;
  for (const a of rows) {
    if (a.reelId !== reel.id || keep.has(a.id) || ACTIVE.includes(a.status) || a.kind === 'reel') continue;
    dropAsset(a);
    n++;
  }
  return n;
}

// the files a version points at: the item's own picture or clip, a Reel's finished videos, its shots' pictures and clips
const filesOf = (v) => [v.data.url, v.data.poster, ...Object.values(v.data.outputs && !Array.isArray(v.data.outputs) ? v.data.outputs : {}), ...Object.values(v.kids || {}).flatMap((k) => [k.url, k.poster])].filter(Boolean);
// versions let go (rolled off, or the item deleted): the files only they pointed at are removed — anything the item, a
// kept version or another row still uses stays
function release(row, gone, keepVersions = []) {
  const now = T.studio.get(row.id) || row;
  const keep = new Set([now.url, now.poster, ...Object.values(now.outputs && !Array.isArray(now.outputs) ? now.outputs : {}), ...keepVersions.flatMap(filesOf)].filter(Boolean));
  for (const x of T.studio.all({ userId: row.userId })) if (x.id !== row.id) for (const u of [x.url, x.poster, x.ref, x.bgUrl, x.audio, ...(x.refs || [])]) if (u) keep.add(u);
  const files = [...new Set(gone.flatMap(filesOf))].filter((u) => !keep.has(u));
  if (files.length) dropFiles(row.userId, files).catch((e) => console.error('studio version files not removed', row.id, e.message));
}
// an item going for good: the files only its old versions still point at go with it
export const dropVersionFiles = (row) => { if (row?.versions?.length) release(row, row.versions); };
