import { TorrentState } from '@ctrl/shared-torrent';
import { describe, expect, it } from 'vitest';

import { normalizeTorrentData, type TorrentStats, type TorrentWithStats } from '../src/index.js';

const torrent = {
  id: 0,
  info_hash: 'e84213a794f3ccd890382a54a64ca68b7e925433',
  name: 'ubuntu-18.04.1-desktop-amd64.iso',
  output_folder: '/home/rqbit/downloads/',
  total_pieces: 3726,
};

// captured from GET /torrents/{id}/stats/v1 on rqbit 9.0.1
const downloading: TorrentStats = {
  state: 'live',
  file_progress: [39_698_432],
  error: null,
  progress_bytes: 39_698_432,
  uploaded_bytes: 0,
  total_bytes: 1_953_349_632,
  finished: false,
  live: {
    snapshot: {
      downloaded_and_checked_bytes: 39_698_432,
      fetched_bytes: 40_304_640,
      uploaded_bytes: 0,
      downloaded_and_checked_pieces: 76,
      total_piece_download_ms: 48_978,
      peer_stats: {
        queued: 0,
        connecting: 0,
        live: 3,
        live_tcp: 3,
        live_utp: 0,
        live_socks: 0,
        seen: 20,
        dead: 17,
        not_needed: 0,
        steals: 5,
      },
    },
    average_piece_download_time: { secs: 0, nanos: 644_447_368 },
    download_speed: { mbps: 7.562351226806641, human_readable: '7.56 MiB/s' },
    upload_speed: { mbps: 0, human_readable: '0.00 MiB/s' },
    time_remaining: { duration: { secs: 241, nanos: 393_000_000 }, human_readable: '4m 1s' },
  },
};

// captured from GET /torrents/{id}/stats/v1 on rqbit 9.0.1
const paused: TorrentStats = {
  state: 'paused',
  file_progress: [184_401_920],
  error: null,
  progress_bytes: 184_401_920,
  uploaded_bytes: 0,
  total_bytes: 1_953_349_632,
  finished: false,
  live: null,
};

const withStats = (stats: TorrentStats): TorrentWithStats => ({ ...torrent, stats });

describe('normalizeTorrentData', () => {
  it('should normalize a downloading torrent', () => {
    const result = normalizeTorrentData(withStats(downloading));
    expect(result).toMatchObject({
      id: torrent.info_hash,
      name: torrent.name,
      state: TorrentState.downloading,
      isCompleted: false,
      savePath: '/home/rqbit/downloads/',
      // 7.56 MiB/s in bytes per second
      downloadSpeed: 7_929_700,
      uploadSpeed: 0,
      eta: 241,
      connectedPeers: 3,
      totalPeers: 20,
      totalSize: 1_953_349_632,
      totalDownloaded: 39_698_432,
    });
    expect(result.progress).toBeCloseTo(0.0203, 4);
  });

  it('should normalize a paused torrent without live stats', () => {
    const result = normalizeTorrentData(withStats(paused));
    expect(result.state).toBe(TorrentState.paused);
    expect(result.downloadSpeed).toBe(0);
    expect(result.eta).toBe(-1);
    expect(result.connectedPeers).toBe(0);
  });

  it('should treat a torrent paused while initializing as paused', () => {
    const initializing: TorrentStats = {
      ...paused,
      state: 'initializing',
      file_progress: [],
      progress_bytes: 0,
    };
    expect(normalizeTorrentData(withStats(initializing)).state).toBe(TorrentState.checking);
    expect(
      normalizeTorrentData(withStats({ ...initializing, initializing_paused: true })).state,
    ).toBe(TorrentState.paused);
  });

  it('should normalize a finished live torrent as seeding', () => {
    // captured from the 3 file test torrent after it finished checking
    const seeding: TorrentStats = {
      state: 'live',
      file_progress: [40_000, 20_000, 10_000],
      error: null,
      progress_bytes: 70_000,
      uploaded_bytes: 0,
      total_bytes: 70_000,
      finished: true,
      live: {
        snapshot: {
          downloaded_and_checked_bytes: 0,
          fetched_bytes: 0,
          uploaded_bytes: 0,
          downloaded_and_checked_pieces: 0,
          total_piece_download_ms: 0,
          peer_stats: {
            queued: 0,
            connecting: 0,
            live: 0,
            live_tcp: 0,
            live_utp: 0,
            live_socks: 0,
            seen: 0,
            dead: 0,
            not_needed: 0,
            steals: 0,
          },
        },
        average_piece_download_time: null,
        download_speed: { mbps: 0, human_readable: '0.00 MiB/s' },
        upload_speed: { mbps: 0, human_readable: '0.00 MiB/s' },
        time_remaining: null,
      },
    };
    const result = normalizeTorrentData(withStats(seeding));
    expect(result.state).toBe(TorrentState.seeding);
    expect(result.isCompleted).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.ratio).toBe(0);
    expect(result.eta).toBe(0);
    // uploaded half of what was downloaded
    expect(normalizeTorrentData(withStats({ ...seeding, uploaded_bytes: 35_000 })).ratio).toBe(0.5);
  });

  it('should use the file list for total size', () => {
    const files = [40_000, 20_000, 10_000].map((length, index) => ({
      name: `${index}.txt`,
      components: [`${index}.txt`],
      length,
      included: index === 1,
      attributes: { symlink: false, hidden: false, padding: false, executable: false },
    }));
    // only b.txt selected, total_bytes counts the pieces it touches
    const result = normalizeTorrentData(withStats({ ...paused, total_bytes: 32_768 }), files);
    expect(result.totalSize).toBe(70_000);
    expect(result.totalSelected).toBe(32_768);
  });

  // rqbit fails the add instead of creating an errored torrent for bad paths, so this one is not captured
  it('should pass through the error message', () => {
    const result = normalizeTorrentData(
      withStats({ ...paused, state: 'error', error: 'error opening files' }),
    );
    expect(result.state).toBe(TorrentState.error);
    expect(result.stateMessage).toBe('error opening files');
  });

  it('should fall back to the info hash before metadata is resolved', () => {
    const result = normalizeTorrentData({
      ...torrent,
      name: null,
      stats: { ...paused, progress_bytes: 0, total_bytes: 0 },
    });
    expect(result.name).toBe(torrent.info_hash);
    expect(result.progress).toBe(0);
  });
});
