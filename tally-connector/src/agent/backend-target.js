// Which backend this agent talks to, and whether that is probably a mistake.
//
// The address comes from the TALLY_BACKEND_URL environment variable and falls back to PRODUCTION. Starting the agent
// from a source checkout with a plain `npm start` (instead of `npm run start:dev`) therefore connects a developer's
// machine to production without any sign of it: the only symptoms were "This connect code is wrong" and "Invalid Tally connector
// token" for a code and token that only exist on the local backend.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "10.0.2.2"]);

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * @param {string} url the effective API base URL
 * @param {{ envUrlSet?: boolean, isPackaged?: boolean }} opts envUrlSet: TALLY_BACKEND_URL was provided explicitly;
 *   isPackaged: running as the installed app (not from a source checkout).
 */
function describeBackendTarget(url, { envUrlSet = false, isPackaged = false } = {}) {
  const host = hostOf(url);
  const environment = LOCAL_HOSTS.has(host) ? "local" : host === "app.getaihive.in" || host.endsWith(".getaihive.in") ? "production" : "custom";
  // Only the unintended case is worth a warning: a source checkout that fell back to production because nothing was set.
  const fellBackToProduction = environment === "production" && !envUrlSet && !isPackaged;
  return {
    url,
    environment,
    warning: fellBackToProduction
      ? "This agent is running from source but is connected to PRODUCTION (TALLY_BACKEND_URL is not set). For a local backend start it with: npm run start:dev"
      : null,
  };
}

module.exports = { describeBackendTarget };
