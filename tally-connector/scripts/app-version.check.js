// Run: node scripts/app-version.check.js
// The version the agent reports to the backend must be the version in package.json (they had drifted apart).
const assert = require("node:assert/strict");
const pkg = require("../package.json");
const { APP_VERSION } = require("../src/agent/constants");

assert.equal(APP_VERSION, pkg.version);
assert.match(APP_VERSION, /^\d+\.\d+\.\d+/, "must be a semver the backend can compare");
console.log(`app version check passed (${APP_VERSION}).`);
