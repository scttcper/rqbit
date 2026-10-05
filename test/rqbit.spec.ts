import { readFileSync } from 'node:fs';
import path from 'node:path';

import { TorrentState } from '@ctrl/shared-torrent';
import pWaitFor from 'p-wait-for';
import { afterEach, describe, expect, it } from 'vitest';

import { Rqbit, RqbitApiError } from '../src/index.js';

const baseUrl = 'http://localhost:3030/';
const username = 'admin';
const password = 'adminadmin';
const torrentName = 'ubuntu-18.04.1-desktop-amd64.iso';
const torrentHash = 'e84213a794f3ccd890382a54a64ca68b7e925433';
const magnet = `magnet:?xt=urn:btih:${torrentHash}&dn=${torrentName}&tr=${encodeURIComponent(
  'http://torrent.ubuntu.com:6969/announce',
)}`;
const __dirname = new URL('.', import.meta.url).pathname;
const torrentFilePath = path.join(__dirname, 'ubuntu-18.04.1-desktop-amd64.iso.torrent');
const torrentFile = new Uint8Array(readFileSync(torrentFilePath));
// private 3 file torrent of zero filled files, a.txt 40000, b.txt 20000, sub/c.txt 10000 bytes.
// No peers needed, rqbit creates the zero filled files so re-adding it finds every piece and seeds.
const multiFile = new Uint8Array(readFileSync(path.join(__dirname, 'multi-file.torrent')));
const multiFileHash = '893b9365ee2b98751c41a2b59296bef747532221';

const magnetTimeoutMs = 20_000;

const createClient = () => new Rqbit({ baseUrl, username, password });

async function setupTorrent(client: Rqbit): Promise<string> {
  const res = await client.addTorrent(torrentFile);
  await pWaitFor(
    async () => {
      const stats = await client.getTorrentStats(res.details.info_hash);
      return stats.state !== 'initializing';
    },
    { timeout: 15_000, interval: 200 },
  );
  return res.details.info_hash;
}

/**
 * Add the multi file torrent, forget it and add it again so rqbit finds the zero filled files and seeds
 */
async function seedMultiFile(client: Rqbit): Promise<void> {
  await client.addTorrent(multiFile);
  await client.removeTorrent(multiFileHash, false);
  await client.addTorrent(multiFile);
  await pWaitFor(async () => (await client.getTorrentStats(multiFileHash)).finished, {
    timeout: 15_000,
    interval: 200,
  });
}

describe('Rqbit', () => {
  afterEach(async () => {
    const client = createClient();
    const res = await client.listTorrents();
    for (const torrent of res.torrents) {
      await client.removeTorrent(torrent.info_hash, true);
    }
  });

  it('should be instantiable', () => {
    const client = createClient();
    expect(client).toBeTruthy();
  });

  it('should get api info and version', async () => {
    const client = createClient();
    const info = await client.getApiInfo();
    expect(info.server).toBe('rqbit');
    expect(info.apis['GET /torrents']).toBeTruthy();
    const version = await client.getVersion();
    expect(version).toBe(info.version);
  });

  it('should reject bad credentials', async () => {
    const client = new Rqbit({ baseUrl, username, password: 'wrong' });
    const err = await client.getApiInfo().catch((error: unknown) => error);
    expect(err).toBeInstanceOf(RqbitApiError);
    expect((err as RqbitApiError).status).toBe(401);
  });

  it('should add torrent from file', async () => {
    const client = createClient();
    const res = await client.addTorrent(torrentFile);
    expect(res.id).toBeTypeOf('number');
    expect(res.details.info_hash).toBe(torrentHash);
    expect(res.details.name).toBe(torrentName);
    expect(res.details.files).toHaveLength(1);
    expect(res.details.files[0]!.included).toBe(true);
  });

  it('should add torrent from base64 file contents', async () => {
    const client = createClient();
    const res = await client.addTorrent(Buffer.from(torrentFile).toString('base64'));
    expect(res.details.info_hash).toBe(torrentHash);
  });

  // magnet links are resolved over the public network, retry slow resolves
  it('should add magnet link', { retry: 2 }, async () => {
    const client = createClient();
    const res = await client.addMagnet(magnet, { timeout_ms: magnetTimeoutMs });
    expect(res.details.info_hash).toBe(torrentHash);
    expect(res.details.name).toBe(torrentName);
  });

  it('should time out resolving a magnet without peers', async () => {
    const client = createClient();
    const deadMagnet = 'magnet:?xt=urn:btih:B0B81206633C42874173D22E564D293DAEFC45E2&dn=dead';
    const err = await client
      .addMagnet(deadMagnet, { timeout_ms: 2000 })
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(RqbitApiError);
    expect((err as RqbitApiError).message).toContain('timeout');
  });

  it('should add torrent into output folder', async () => {
    const client = createClient();
    const res = await client.addTorrent(torrentFile, {
      output_folder: '/home/rqbit/downloads/linux',
    });
    expect(res.output_folder).toBe('/home/rqbit/downloads/linux');
  });

  it('should list torrent without adding with list_only', async () => {
    const client = createClient();
    const res = await client.addTorrent(torrentFile, { list_only: true });
    expect(res.id).toBeNull();
    expect(res.details.info_hash).toBe(torrentHash);
    const list = await client.listTorrents();
    expect(list.torrents).toHaveLength(0);
  });

  it('should list torrents with and without stats', async () => {
    const client = createClient();
    await setupTorrent(client);
    const res = await client.listTorrents();
    expect(res.torrents).toHaveLength(1);
    expect(res.torrents[0]!.info_hash).toBe(torrentHash);
    expect(res.torrents[0]!.stats).toBeUndefined();
    const withStats = await client.listTorrents(true);
    expect(withStats.torrents[0]!.stats.total_bytes).toBe(1_953_349_632);
  });

  it('should get torrent details and stats', async () => {
    const client = createClient();
    const hash = await setupTorrent(client);
    const details = await client.getTorrentDetails(hash);
    expect(details.files[0]!.components).toEqual([torrentName]);
    expect(details.total_pieces).toBe(3726);
    const stats = await client.getTorrentStats(details.id);
    expect(['live', 'paused']).toContain(stats.state);
    expect(stats.file_progress).toHaveLength(1);
  });

  it('should throw torrent_not_found for an unknown torrent', async () => {
    const client = createClient();
    const err = await client
      .getTorrentStats('ffffffffffffffffffffffffffffffffffffffff')
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(RqbitApiError);
    expect((err as RqbitApiError).status).toBe(404);
    expect((err as RqbitApiError).kind).toBe('torrent_not_found');
  });

  it('should pause and resume torrent', async () => {
    const client = createClient();
    const hash = await setupTorrent(client);
    await client.pauseTorrent(hash);
    let stats = await client.getTorrentStats(hash);
    expect(stats.state).toBe('paused');
    expect(stats.live).toBeNull();
    await client.resumeTorrent(hash);
    stats = await client.getTorrentStats(hash);
    expect(stats.state).toBe('live');
  });

  it('should remove torrent', async () => {
    const client = createClient();
    const hash = await setupTorrent(client);
    await client.removeTorrent(hash, false);
    const res = await client.listTorrents();
    expect(res.torrents).toHaveLength(0);
  });

  it('should download the torrent metadata', async () => {
    const client = createClient();
    const hash = await setupTorrent(client);
    const metadata = await client.getTorrentMetadata(hash);
    expect(metadata).toEqual(torrentFile);
  });

  it('should change selected files', async () => {
    const client = createClient();
    await client.addTorrent(multiFile);
    await client.setTorrentFiles(multiFileHash, [1]);
    const details = await client.getTorrentDetails(multiFileHash);
    expect(details.files.map(file => file.included)).toEqual([false, true, false]);
    // total_bytes counts the pieces b.txt touches
    const stats = await client.getTorrentStats(multiFileHash);
    expect(stats.total_bytes).toBe(32_768);
  });

  it('should add only selected files', async () => {
    const client = createClient();
    const res = await client.addTorrent(multiFile, { only_files: [0, 2] });
    expect(res.details.files.map(file => file.included)).toEqual([true, false, true]);
    expect(res.details.files.map(file => file.components)).toEqual([
      ['a.txt'],
      ['b.txt'],
      ['sub', 'c.txt'],
    ]);
  });

  it('should normalize total size from the file list', async () => {
    const client = createClient();
    await client.addTorrent(multiFile);
    await client.setTorrentFiles(multiFileHash, [1]);
    const torrent = await client.getTorrent(multiFileHash);
    expect(torrent.totalSize).toBe(70_000);
    expect(torrent.totalSelected).toBe(32_768);
  });

  it('should seed a torrent whose files are complete on disk', async () => {
    const client = createClient();
    await seedMultiFile(client);
    const torrent = await client.getTorrent(multiFileHash);
    expect(torrent.state).toBe(TorrentState.seeding);
    expect(torrent.isCompleted).toBe(true);
    expect(torrent.progress).toBe(1);
    expect(torrent.totalDownloaded).toBe(70_000);
  });

  it('should wrap network errors in RqbitApiError', async () => {
    // nothing listens on port 1
    const client = new Rqbit({ baseUrl: 'http://127.0.0.1:1/', username, password });
    const err = await client.getSessionStats().catch((error: unknown) => error);
    expect(err).toBeInstanceOf(RqbitApiError);
    expect((err as RqbitApiError).status).toBeUndefined();
  });

  it('should add peers', async () => {
    const client = createClient();
    const hash = await setupTorrent(client);
    const res = await client.addPeers(hash, ['127.0.0.1:6881']);
    expect(res.added).toBe(1);
    const peers = await client.getTorrentPeerStats(hash, 'all');
    expect(peers.peers['127.0.0.1:6881']).toBeDefined();
  });

  it('should get dht stats', async () => {
    const client = createClient();
    const stats = await client.getDhtStats();
    expect(stats.id).toMatch(/^[\da-f]{40}$/);
    expect(stats.routing_table_size).toBeTypeOf('number');
  });

  it('should stream a file with range requests', async () => {
    const client = createClient();
    await seedMultiFile(client);
    const res = await fetch(client.getStreamUrl(multiFileHash, 0), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        Range: 'bytes=0-9',
      },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-9/40000');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(10));
  });

  it('should build playlist urls', async () => {
    const client = createClient();
    await seedMultiFile(client);
    expect(client.getPlaylistUrl()).toBe('http://localhost:3030/torrents/playlist');
    const res = await fetch(client.getPlaylistUrl(multiFileHash), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
    });
    expect(res.headers.get('content-type')).toContain('mpegurl');
    // no playable files in the test torrent
    expect((await res.text()).trim()).toBe('#EXTM3U');
  });

  it('should create a torrent from a folder', async () => {
    const client = createClient();
    await seedMultiFile(client);
    const res = await client.createTorrent('/home/rqbit/downloads/ctrl-rqbit-multi/sub', {
      name: 'created',
      trackers: ['http://127.0.0.1:1/announce'],
    });
    expect(res.magnet).toContain(`xt=urn:btih:${res.info_hash}`);
    expect(res.info_hash).toMatch(/^[\da-f]{40}$/);
    const details = await client.getTorrentDetails(res.info_hash);
    expect(details.name).toBe('created');
    expect(details.files.map(file => file.length)).toEqual([10_000]);
  });

  it('should resolve a magnet without adding it', { retry: 2 }, async () => {
    const client = createClient();
    const torrent = await client.resolveMagnet(magnet, { timeout_ms: magnetTimeoutMs });
    const res = await client.addTorrent(torrent, { list_only: true });
    expect(res.details.info_hash).toBe(torrentHash);
    expect((await client.listTorrents()).torrents).toHaveLength(0);
  });

  it('should get session stats', async () => {
    const client = createClient();
    const stats = await client.getSessionStats();
    expect(stats.uptime_seconds).toBeTypeOf('number');
    expect(stats.download_speed.human_readable).toContain('MiB/s');
    expect(stats.connections.tcp.v4.attempts).toBeTypeOf('number');
  });

  it('should get and set rate limits', async () => {
    const client = createClient();
    await client.setRateLimits({ upload_bps: 1_000_000, download_bps: null });
    expect(await client.getRateLimits()).toEqual({ upload_bps: 1_000_000, download_bps: null });
    await client.setRateLimits({ upload_bps: null, download_bps: null });
    expect(await client.getRateLimits()).toEqual({ upload_bps: null, download_bps: null });
  });

  it('should throw for queueUp and queueDown', async () => {
    const client = createClient();
    await expect(client.queueUp(torrentHash)).rejects.toThrow('does not support queueing');
    await expect(client.queueDown(torrentHash)).rejects.toThrow('does not support queueing');
  });

  it('should get normalized all torrent data', async () => {
    const client = createClient();
    await setupTorrent(client);
    const res = await client.getAllData();
    expect(res.torrents).toHaveLength(1);
    expect(res.labels).toEqual([]);
    const torrent = res.torrents[0]!;
    expect(torrent.id).toBe(torrentHash);
    expect(torrent.name).toBe(torrentName);
    expect(torrent.isCompleted).toBe(false);
    expect(torrent.totalSize).toBe(1_953_349_632);
    expect(torrent.savePath).toBe('/home/rqbit/downloads/');
    expect(torrent.progress).toBeGreaterThanOrEqual(0);
    expect(torrent.progress).toBeLessThan(1);
    expect(torrent.raw.info_hash).toBe(torrentHash);
  });

  it('should get normalized torrent', async () => {
    const client = createClient();
    const hash = await setupTorrent(client);
    const torrent = await client.getTorrent(hash);
    expect(torrent.id).toBe(torrentHash);
    expect([TorrentState.downloading, TorrentState.paused]).toContain(torrent.state);
  });

  it('should add normalized torrent from file', async () => {
    const client = createClient();
    const torrent = await client.normalizedAddTorrent(torrentFile);
    expect(torrent.id).toBe(torrentHash);
    expect(torrent.name).toBe(torrentName);
  });

  it('should add normalized magnet paused', { retry: 2 }, async () => {
    const client = new Rqbit({ baseUrl, username, password, addTimeout: magnetTimeoutMs });
    const torrent = await client.normalizedAddTorrent(magnet, { startPaused: true });
    expect(torrent.id).toBe(torrentHash);
    await pWaitFor(
      async () => (await client.getTorrent(torrentHash)).state === TorrentState.paused,
      { timeout: 15_000, interval: 200 },
    );
  });

  it('should restore from exported state', async () => {
    const client = createClient();
    const restored = Rqbit.createFromState({ baseUrl, username, password }, client.exportState());
    const res = await restored.getAllData();
    expect(res.torrents).toHaveLength(0);
  });
});
