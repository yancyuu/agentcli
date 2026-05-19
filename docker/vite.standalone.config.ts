/**
 * Vite build config for the standalone web server.
 *
 * Produces a single CJS bundle at dist-standalone/index.cjs that can be
 * run with `node dist-standalone/index.cjs`.
 */

import { resolve } from 'path'
import { defineConfig } from 'vite'

import type { Plugin } from 'vite'

const ROOT = resolve(__dirname, '..')

const nodeBuiltins = new Set([
  'fs', 'path', 'os', 'events', 'stream', 'util', 'net', 'tls',
  'http', 'https', 'crypto', 'zlib', 'url', 'querystring',
  'child_process', 'buffer', 'dns', 'dgram', 'assert', 'constants',
  'readline', 'string_decoder', 'timers', 'tty', 'worker_threads'
])

const externalPackages = [
  'fastify', '@fastify/cors', '@fastify/static',
  'ssh2', 'cpu-features',
  'protobufjs', '@protobufjs/aspromise', '@protobufjs/base64',
  '@protobufjs/codegen', '@protobufjs/eventemitter', '@protobufjs/fetch',
  '@protobufjs/float', '@protobufjs/inquire', '@protobufjs/path',
  '@protobufjs/pool', '@protobufjs/utf8',
  'agent-teams-controller'
]

function nativeModuleStub(): Plugin {
  const STUB_ID = '\0native-stub'
  return {
    name: 'native-module-stub',
    resolveId(source) {
      if (source.endsWith('.node')) return STUB_ID
      return null
    },
    load(id) {
      if (id === STUB_ID) return 'export default {}'
      return null
    }
  }
}

export default defineConfig({
  root: ROOT,
  plugins: [nativeModuleStub()],
  resolve: {
    alias: {
      '@main': resolve(ROOT, 'src/main'),
      '@shared': resolve(ROOT, 'src/shared'),
      '@features': resolve(ROOT, 'src/features')
    }
  },
  ssr: {
    noExternal: true
  },
  build: {
    outDir: 'dist-standalone',
    target: 'node20',
    ssr: true,
    rollupOptions: {
      input: {
        index: resolve(ROOT, 'src/main/standalone.ts')
      },
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs'
      },
      external: (id) => {
        if (id.startsWith('node:')) return true
        if (nodeBuiltins.has(id)) return true
        if (externalPackages.some(pkg => id === pkg || id.startsWith(pkg + '/'))) return true
        return false
      }
    },
    minify: false,
    sourcemap: true
  }
})
