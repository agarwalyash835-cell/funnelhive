// Production entry point. Runs one app process per CPU core (WEB_CONCURRENCY, default: cores, max 4);
// they share the SQLite database. Process 0 also runs the background jobs (automations, webhook
// retries, domain checks, backups). A process that crashes is restarted.
//   WEB_CONCURRENCY=1 → a single process (same as `node index.js`)
import cluster from 'node:cluster';
import os from 'node:os';

const n = Math.max(1, Number(process.env.WEB_CONCURRENCY) || Math.min(os.availableParallelism?.() || os.cpus().length, 4));

if (cluster.isPrimary && n > 1) {
  // database upgrades run here once, before any worker opens the database
  process.env.FF_JOBS = '0';
  process.env.FF_PRIMARY = '1';
  const { sql, dir } = await import('./db.js');
  sql.close();
  // one sign-in secret for every process (created here, before any of them starts)
  (await import('./security.js')).loadSecret(dir);
  const index = new Map(); // worker id → its slot (slot 0 runs the jobs)
  const fork = (slot) => {
    const w = cluster.fork({ WORKER_INDEX: String(slot), WEB_CONCURRENCY: String(n), FF_JOBS: slot === 0 ? '1' : '0', FF_PRIMARY: '' });
    index.set(w.id, slot);
  };
  for (let i = 0; i < n; i++) fork(i);
  let stopping = false;
  cluster.on('exit', (w, code, signal) => {
    const slot = index.get(w.id);
    index.delete(w.id);
    // shutting down: done once every app process has finished its requests and closed the database
    if (stopping) { if (Object.values(cluster.workers).every((x) => x.isDead())) process.exit(0); return; }
    console.error(`App process ${slot} exited (${signal || code}) — restarting`);
    setTimeout(() => fork(slot), 1000);
  });
  // docker stop / a deploy: each app process stops taking requests and finishes the ones in flight (db.js); any
  // still running after 10 s is stopped hard (docker-compose gives the container 20 s)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    for (const w of Object.values(cluster.workers)) w.process.kill(sig);
    setTimeout(() => { for (const w of Object.values(cluster.workers)) w.process.kill('SIGKILL'); process.exit(0); }, 10000).unref();
  });
} else {
  await import('./index.js');
}
