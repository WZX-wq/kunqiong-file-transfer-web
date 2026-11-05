import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'vite'

const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
  name: 'avatar-navigation-fixture',
  resolveId(id) { if (id === 'avatar-fixture') return '\0avatar-fixture' },
  load(id) { if (id === '\0avatar-fixture') return `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PublicShell } from '/src/components/common.jsx';
    import { apiRequest, invalidateAccountSession } from '/src/lib/api.js';
    const root = createRoot(document.getElementById('root'));
    window.fixture = { apiRequest, invalidateAccountSession,
      render() { root.render(React.createElement(PublicShell)); },
      unmount() { root.unmount(); } };` },
}], build: { write: false, minify: false, rollupOptions: { input: 'avatar-fixture', output: { format: 'iife', inlineDynamicImports: true } } } })
const code = bundle.output.find(item => item.type === 'chunk').code
async function waitFor(fn, label) {
  for (let i = 0; i < 150; i++) { if (fn()) return; await delay(10) }
  assert.fail(label)
}
for (const avatar of ['https://example.invalid/provider.png', 'data:image/webp;base64,AAAA']) {
  const errors = [], vc = new VirtualConsole()
  vc.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.local/team', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc })
  const { window } = dom
  let user = { id: 'alice', nickname: 'Alice', avatar: null }
  window.fetch = async () => new Response(JSON.stringify({ user }), { headers: { 'content-type': 'application/json' } })
  window.eval(code)
  try {
    // Warm the identity cache before a richer profile request, as navigation does.
    await window.fixture.apiRequest('/api/auth/me', { authView: 'identity' })
    user = { ...user, avatar, avatarSource: avatar.startsWith('data:') ? 'custom' : '', providerAvatar: 'https://example.invalid/provider.png' }
    await window.fixture.apiRequest('/api/auth/me', { authView: 'full' })
    window.fixture.render()
    await waitFor(() => window.document.querySelector('.topbar [aria-label="个人中心"]'), 'team account header mounts')
    await delay(40)
    assert.equal(window.document.querySelector('.topbar .user-avatar')?.getAttribute('src'), avatar, 'cached identity cannot replace the profile avatar on team entry')
    window.fixture.invalidateAccountSession()
    await waitFor(() => !window.document.querySelector('.topbar img.user-avatar'), 'logout removes the previous avatar')
    user = { id: 'bob', nickname: 'Bob', avatar: 'https://example.invalid/bob.png' }
    await window.fixture.apiRequest('/api/auth/me', { authView: 'identity', force: true })
    await waitFor(() => window.document.querySelector('.topbar img.user-avatar')?.getAttribute('src') === user.avatar, 'a new account uses only its own avatar')
    assert.deepEqual(errors, [])
    console.log('PASS team header retains ' + (avatar.startsWith('data:') ? 'custom' : 'provider') + ' avatar and isolates account changes')
  } finally { window.fixture.unmount(); window.close() }
}
