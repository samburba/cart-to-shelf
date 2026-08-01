import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.js';

const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));

// These drifted apart once already. The manifest is what ships, so it is the
// one that matters — but a package.json claiming a different release is a
// reliable way to mislabel a build.
test('the manifest and the package agree on the version', () => {
  assert.equal(pkg.version, manifest.version);
});

test('host permissions are https-only and limited to the two sites', () => {
  const hosts = manifest.host_permissions;
  for (const pattern of hosts) {
    assert.ok(pattern.startsWith('https://'), `${pattern} should be https-only`);
  }
  assert.ok(hosts.includes('https://*.amazon.com/*'));
  assert.ok(hosts.includes('https://*.goodreads.com/*'));
});
