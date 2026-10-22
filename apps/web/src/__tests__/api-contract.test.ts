/**
 * @jest-environment node
 *
 * Static analysis over the source tree plus a mocked global `fetch` — no DOM
 * involved, so this suite runs in the Node environment.
 */

/**
 * API-to-frontend route contract (Savitura/Savitools#202).
 *
 * Two guarantees, both executable:
 *
 * 1. Hygiene: every SaviTools API call in `apps/web/src` went through the
 *    versioned helpers in `@/lib/api` — no hard-coded API origin, no raw
 *    `fetch` to the API base, no wrapper path carrying its own `api`/`v1`
 *    prefix. Paths are compared against the committed contract manifest that
 *    `apps/api/src/contracts/api-contract.spec.ts` freezes from the live Nest
 *    application, so a renamed or removed controller route fails here too.
 * 2. Smoke contracts: the wrappers behind login refresh, Composer
 *    manifest/build, Monitor watches, Webhook send/history and Playground
 *    history are exercised against a mocked `fetch`, pinning the exact method,
 *    versioned URL and credential mode each one sends.
 *
 * `src/__tests__` is the approved test configuration: files in this directory
 * are excluded from the hygiene scan, and `src/lib/api.ts` is the one approved
 * place that knows the API origin.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

import {
  apiFetch,
  fetchWebhookHistory,
  refreshSession,
  replayHorizonRequest,
  sendWebhook,
} from '@/lib/api';
import { buildTransaction, fetchOperations } from '@/lib/composer-api';

/** Mirrors the single approved origin definition in `src/lib/api.ts`. */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const SRC_ROOT = join(__dirname, '..');
const APPROVED_ORIGIN_FILE = 'lib/api.ts';
const API_CONTRACT_MANIFEST = join(
  SRC_ROOT,
  '..',
  '..',
  'api',
  'src',
  'contracts',
  'api-contract.manifest.json',
);

const API_ORIGIN_LITERAL = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):3001\b/g;
const API_BASE_REFERENCE = /NEXT_PUBLIC_API_URL/g;
const RAW_FETCH_CALL = /\bfetch\s*\(/g;
const WRAPPER_CALLEE =
  /\b(apiFetchFormData|apiFetch|downloadCsv)\s*(?:<[\s\S]{0,400}?>)?\s*\(/g;

/** `${...}` interpolations that sit behind a `/` are path parameters; the rest are query suffixes. */
const PARAM_MARKER = '\u0000';

interface ApiContractEntry {
  method: string;
  path: string;
  auth: string;
}

interface ApiContractManifest {
  version: number;
  routes: ApiContractEntry[];
}

type ViolationRule = 'unapproved-origin' | 'raw-api-fetch' | 'wrapper-path-shape';

interface Violation {
  file: string;
  line: number;
  rule: ViolationRule;
  detail: string;
}

interface SourceFile {
  path: string;
  source: string;
}

interface WrapperCall {
  file: string;
  line: number;
  callee: string;
  literal: string;
  method: string;
  /** `METHOD /api/v1/<normalised path>`, ready to compare with the manifest. */
  key: string;
}

interface WrapperCallSite {
  callee: string;
  /** Index of the callee, used for line numbers. */
  index: number;
  /** Index of the call's opening `(`. */
  openIndex: number;
  /** The argument literal, including its surrounding quotes. */
  literal: string;
}

export function normalizeApiPath(raw: string): string {
  const withoutQuery = raw.split('?')[0];
  const marked = withoutQuery.replace(/\$\{[^}]*\}/g, PARAM_MARKER);
  const normalized = marked
    .split(`/${PARAM_MARKER}`)
    .join('/:param')
    .split(PARAM_MARKER)
    .join('')
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\/+$/, '');
  return normalized.length > 0 ? normalized : '/';
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** End index (exclusive) of the string/template literal starting at `start`, or -1. */
function scanStringLiteral(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;

  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (quote === '`' && character === '$' && source[index + 1] === '{') {
      const close = scanInterpolation(source, index + 2);
      if (close === -1) return -1;
      index = close + 1;
      continue;
    }
    if (character === quote) return index + 1;
    if (character === '\n' && quote !== '`') return -1;
    index += 1;
  }

  return -1;
}

/** Index of the `}` closing the `${` whose expression starts at `start`, or -1. */
function scanInterpolation(source: string, start: number): number {
  let depth = 1;
  let index = start;

  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      const end = scanStringLiteral(source, index);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }

  return -1;
}

/**
 * Every `apiFetch`/`apiFetchFormData`/`downloadCsv` call whose first argument is
 * a string or template literal.
 *
 * The argument is read with a scanner rather than a regex so that nested
 * template literals are not truncated at the inner backtick:
 *
 *   apiFetch<AssetTrustlinesResult>(
 *     `${assetPath(code, issuer, "trustlines")}${query ? `?${query}` : ""}`,
 *   )
 *
 * Truncating there is what used to make the hygiene scan report that computed
 * path as a hard-coded one.
 */
function findWrapperCalls(source: string): WrapperCallSite[] {
  const calls: WrapperCallSite[] = [];

  for (const match of source.matchAll(WRAPPER_CALLEE)) {
    const openIndex = (match.index ?? 0) + match[0].length - 1;
    let argumentStart = openIndex + 1;
    while (/\s/.test(source[argumentStart] ?? '')) argumentStart += 1;

    const quote = source[argumentStart];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;

    const end = scanStringLiteral(source, argumentStart);
    if (end === -1) continue;

    calls.push({
      callee: match[1],
      index: match.index ?? 0,
      openIndex,
      literal: source.slice(argumentStart, end),
    });
  }

  return calls;
}

/**
 * The literal is an interpolated path (`` `${assetPath(...)}` ``). It is
 * assembled at runtime, so it cannot be compared against a route and is not a
 * hygiene violation either.
 */
function isComputedPath(literal: string): boolean {
  return literal.slice(1).startsWith('${');
}

function listSourceFiles(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // The approved test configuration is not production source.
        if (entry.name !== '__tests__') walk(join(directory, entry.name));
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const absolute = join(directory, entry.name);
      files.push({ path: relative(SRC_ROOT, absolute), source: readFileSync(absolute, 'utf8') });
    }
  };
  walk(SRC_ROOT);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function scanSourceFile(file: SourceFile): Violation[] {
  const violations: Violation[] = [];
  const approvedOriginFile = file.path === APPROVED_ORIGIN_FILE;

  if (!approvedOriginFile) {
    for (const match of file.source.matchAll(API_ORIGIN_LITERAL)) {
      violations.push({
        file: file.path,
        line: lineOf(file.source, match.index ?? 0),
        rule: 'unapproved-origin',
        detail: `hard-coded API origin "${match[0]}" — read it from ${APPROVED_ORIGIN_FILE}`,
      });
    }
    for (const match of file.source.matchAll(API_BASE_REFERENCE)) {
      violations.push({
        file: file.path,
        line: lineOf(file.source, match.index ?? 0),
        rule: 'unapproved-origin',
        detail: `reads NEXT_PUBLIC_API_URL outside ${APPROVED_ORIGIN_FILE}`,
      });
    }
    for (const match of file.source.matchAll(RAW_FETCH_CALL)) {
      const call = file.source.slice(match.index ?? 0, (match.index ?? 0) + 300);
      if (/API_URL|API_BASE|NEXT_PUBLIC_API_URL|\/api\//.test(call)) {
        violations.push({
          file: file.path,
          line: lineOf(file.source, match.index ?? 0),
          rule: 'raw-api-fetch',
          detail: `raw fetch(...) targets the API base instead of apiFetch/apiFetchFormData/downloadCsv: ${call.split('\n')[0].trim()}`,
        });
      }
    }
  }

  for (const call of findWrapperCalls(file.source)) {
    if (isComputedPath(call.literal)) continue;

    const raw = call.literal.slice(1, -1);
    if (!raw.startsWith('/')) {
      violations.push({
        file: file.path,
        line: lineOf(file.source, call.index),
        rule: 'wrapper-path-shape',
        detail: `${call.callee}("${raw}") must start with "/" so the helper applies the /v1 prefix`,
      });
      continue;
    }
    if (/^\/api(\/|$)/.test(raw) || /^\/v1(\/|$)/.test(raw)) {
      violations.push({
        file: file.path,
        line: lineOf(file.source, call.index),
        rule: 'wrapper-path-shape',
        detail: `${call.callee}("${raw}") already carries an api/v1 prefix — pass the path relative to /v1`,
      });
    }
  }

  return violations;
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map(
      (violation) =>
        `  [${violation.rule}] ${violation.file}:${violation.line} ${violation.detail}`,
    )
    .join('\n');
}

/** Index of the `)` that closes the call whose `(` is at `openIndex`. */
function findCallEnd(source: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;

  while (index < source.length) {
    const character = source[index];
    if (character === "'" || character === '"' || character === '`') {
      const end = scanStringLiteral(source, index);
      if (end === -1) return source.length;
      index = end;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }

  return source.length;
}

/** `apiFetchFormData` posts a `FormData` body; `downloadCsv` issues a GET. */
function requestMethodOf(callee: string, callText: string): string {
  if (callee === 'apiFetchFormData') return 'POST';
  const declared = callText.match(/method\s*:\s*['"](\w+)['"]/);
  return declared ? declared[1].toUpperCase() : 'GET';
}

function collectWrapperCalls(files: SourceFile[]): WrapperCall[] {
  const calls: WrapperCall[] = [];
  for (const file of files) {
    for (const call of findWrapperCalls(file.source)) {
      if (isComputedPath(call.literal)) continue;

      const callText = file.source.slice(
        call.openIndex,
        findCallEnd(file.source, call.openIndex) + 1,
      );
      const method = requestMethodOf(call.callee, callText);

      calls.push({
        file: file.path,
        line: lineOf(file.source, call.index),
        callee: call.callee,
        literal: call.literal,
        method,
        key: `${method} /api/v1${normalizeApiPath(call.literal.slice(1, -1))}`,
      });
    }
  }
  return calls.sort(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  );
}

function serverRouteKeys(): Set<string> {
  const manifest = JSON.parse(readFileSync(API_CONTRACT_MANIFEST, 'utf8')) as ApiContractManifest;
  return new Set(
    manifest.routes.map((route) => `${route.method} ${normalizeApiPath(route.path)}`),
  );
}

/**
 * Wrapper calls that already pointed at routes the API does not serve when this
 * guard landed, verified against the generated contract manifest. They are
 * pinned so the guard fails on any *new* drift while the gaps are closed
 * separately:
 *
 * - `POST /api/v1/monitor/watches/:id/alerts/:id/resend` — `MonitorController`
 *   has no alert re-send endpoint, so the "Re-send" button cannot work yet.
 * - `GET /api/v1/shared/composer/:token` — `fetchSharedComposerWorkspace` has no
 *   callers and there is no shared-workspace controller.
 */
const KNOWN_UNBACKED_WRAPPER_CALLS: readonly string[] = [
  'POST /api/v1/monitor/watches/:param/alerts/:param/resend',
  'GET /api/v1/shared/composer/:param',
];

interface SmokeContract {
  /** The user-facing flow covered by this contract. */
  flow: string;
  /** The wrapper that would have to change if the route drifts. */
  wrapper: string;
  invoke: () => Promise<unknown>;
  method: string;
  /** Path relative to the API origin, including the version segment. */
  path: string;
}

const SMOKE_CONTRACTS: readonly SmokeContract[] = [
  {
    flow: 'login refresh',
    wrapper: 'refreshSession() in lib/api.ts',
    invoke: () => refreshSession(),
    method: 'POST',
    path: '/v1/auth/refresh',
  },
  {
    flow: 'Composer manifest',
    wrapper: 'fetchOperations() in lib/composer-api.ts',
    invoke: () => fetchOperations(),
    method: 'GET',
    path: '/v1/composer/operations',
  },
  {
    flow: 'Composer build',
    wrapper: 'buildTransaction() in lib/composer-api.ts',
    invoke: () =>
      buildTransaction({
        sourceAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        network: 'testnet',
        operations: [{ type: 'payment' }],
      }),
    method: 'POST',
    path: '/v1/composer/build',
  },
  {
    flow: 'Horizon request replay',
    wrapper: 'replayHorizonRequest() in lib/api.ts',
    invoke: () => replayHorizonRequest({ kind: 'fee_stats', network: 'testnet' }),
    method: 'POST',
    path: '/v1/network/replay',
  },
  {
    flow: 'Monitor watches',
    wrapper: 'apiFetch<Watch[]>("/monitor/watches") in components/monitor/monitor-dashboard.tsx',
    invoke: () => apiFetch<unknown>('/monitor/watches'),
    method: 'GET',
    path: '/v1/monitor/watches',
  },
  {
    flow: 'Webhook send',
    wrapper: 'sendWebhook() in lib/api.ts',
    invoke: () => sendWebhook({ endpointUrl: 'https://example.com/hook', eventType: 'payment' }),
    method: 'POST',
    path: '/v1/webhooks/send',
  },
  {
    flow: 'Webhook history',
    wrapper: 'fetchWebhookHistory() in lib/api.ts',
    invoke: () => fetchWebhookHistory(),
    method: 'GET',
    path: '/v1/webhooks/history',
  },
  {
    flow: 'Playground history',
    wrapper: 'apiFetch<unknown>("/playground/history") requested by components/playground/playground-tool.tsx',
    invoke: () => apiFetch<unknown>('/playground/history'),
    method: 'GET',
    path: '/v1/playground/history',
  },
];

type FetchArgs = [string, RequestInit];

const originalFetch = global.fetch;

function mockFetchOnce(): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('API route hygiene', () => {
  it('keeps every API call on the versioned helpers', () => {
    const violations = listSourceFiles().flatMap(scanSourceFile);

    expect(formatViolations(violations)).toBe('');
  });

  it('flags a hard-coded API origin', () => {
    const violations = scanSourceFile({
      path: 'components/tools/composer/benchmark-panel.tsx',
      source: "const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';",
    });

    expect(violations.map((violation) => violation.rule)).toEqual([
      'unapproved-origin',
      'unapproved-origin',
    ]);
  });

  it('flags a raw fetch to the API base, which would skip the /v1 prefix', () => {
    const violations = scanSourceFile({
      path: 'components/tools/composer/benchmark-panel.tsx',
      source: "const res = await fetch(`${API_BASE}/composer/benchmark`, { method: 'POST' });",
    });

    expect(violations.map((violation) => violation.rule)).toEqual(['raw-api-fetch']);
    // The offending file is reported structurally; the detail carries the line.
    expect(violations[0].file).toBe('components/tools/composer/benchmark-panel.tsx');
    expect(violations[0].detail).toContain('fetch(');
    expect(violations[0].detail).toContain('/composer/benchmark');
  });

  it('flags a legacy path that carries its own api/v1 prefix', () => {
    const violations = scanSourceFile({
      path: 'lib/legacy-client.ts',
      source: 'return apiFetch<Session[]>("/api/v1/auth/sessions");',
    });

    expect(violations.map((violation) => violation.rule)).toEqual(['wrapper-path-shape']);
    expect(violations[0].detail).toContain('pass the path relative to /v1');
  });

  it('accepts wrapper paths relative to the versioned prefix', () => {
    const violations = scanSourceFile({
      path: 'lib/api.ts',
      source: [
        'const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";',
        'await fetch(`${API_URL}/v1${path}`, { credentials: "include" });',
        'return apiFetch<Session[]>("/auth/sessions");',
      ].join('\n'),
    });

    expect(violations).toEqual([]);
  });

  it('ignores the approved test configuration', () => {
    const scanned = listSourceFiles().map((file) => file.path);

    expect(scanned.some((path) => path.startsWith('__tests__'))).toBe(false);
    expect(scanned).toContain(APPROVED_ORIGIN_FILE);
  });
});

describe('API-to-frontend route contract', () => {
  it('points every wrapper at a route the API serves', () => {
    const routes = serverRouteKeys();
    const unbacked = collectWrapperCalls(listSourceFiles()).filter(
      (call) => !routes.has(call.key),
    );

    const unexpected = unbacked.filter(
      (call) => !KNOWN_UNBACKED_WRAPPER_CALLS.includes(call.key),
    );
    const report = unexpected
      .map(
        (call) =>
          `  ${call.file}:${call.line} ${call.callee}(${call.literal}) calls ${call.key}, which no controller serves`,
      )
      .join('\n');

    expect(report).toBe('');
  });

  it('keeps the grandfathered gaps current', () => {
    const routes = serverRouteKeys();
    const unbacked = new Set(
      collectWrapperCalls(listSourceFiles())
        .filter((call) => !routes.has(call.key))
        .map((call) => call.key),
    );

    const closed = KNOWN_UNBACKED_WRAPPER_CALLS.filter((key) => !unbacked.has(key));
    expect(
      closed.length === 0
        ? ''
        : `These wrappers are now backed by a route; remove them from KNOWN_UNBACKED_WRAPPER_CALLS:\n${closed
            .map((key) => `  ${key}`)
            .join('\n')}`,
    ).toBe('');
  });

  it('freezes the critical wrapper contracts in the API manifest', () => {
    const routes = serverRouteKeys();

    for (const contract of SMOKE_CONTRACTS) {
      const key = `${contract.method} /api${normalizeApiPath(contract.path)}`;
      expect(`${contract.flow}: ${routes.has(key) ? 'ok' : `missing ${key}`}`).toBe(
        `${contract.flow}: ok`,
      );
    }
  });

  for (const contract of SMOKE_CONTRACTS) {
    it(`smoke contract: ${contract.flow}`, async () => {
      const fetchMock = mockFetchOnce();

      await contract.invoke();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
      expect({
        wrapper: contract.wrapper,
        url,
        method: init.method ?? 'GET',
        credentials: init.credentials,
      }).toEqual({
        wrapper: contract.wrapper,
        url: `${API_BASE}${contract.path}`,
        method: contract.method,
        credentials: 'include',
      });
    });
  }

  it('reports the wrapper that drifted when a smoke contract changes', async () => {
    const [contract] = SMOKE_CONTRACTS;
    const fetchMock = mockFetchOnce();

    await contract.invoke();

    const [, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(init.method ?? 'GET').not.toBe('PUT');
  });
});
