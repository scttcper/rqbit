import { TorrentState, type NormalizedTorrent } from '@ctrl/shared-torrent';

import type { TorrentFile, TorrentWithStats } from './types.js';

const MIB = 1024 * 1024;

/**
 * Convert a torrent with stats into the shared normalized format.
 * Speeds are MiB/s and the ETA is a `{ secs, nanos }` duration,
 * see {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/torrent_state/stats.rs}
 *
 * @param files file list from the torrent details, used for `totalSize`.
 * rqbit's `total_bytes` only counts the pieces of selected files, so without the file list `totalSize` is the selected size.
 */
export function normalizeTorrentData(
  torrent: TorrentWithStats,
  files?: TorrentFile[],
): NormalizedTorrent {
  const { stats } = torrent;
  const live = stats.live;

  let state = TorrentState.unknown;
  switch (stats.state) {
    case 'initializing': {
      // pausing during initialization keeps the torrent in initializing until it is started
      state = stats.initializing_paused ? TorrentState.paused : TorrentState.checking;
      break;
    }
    case 'live': {
      state = stats.finished ? TorrentState.seeding : TorrentState.downloading;
      break;
    }
    case 'paused': {
      state = TorrentState.paused;
      break;
    }
    case 'error': {
      state = TorrentState.error;
      break;
    }
  }

  const progress = stats.total_bytes > 0 ? stats.progress_bytes / stats.total_bytes : 0;
  const peerStats = live?.snapshot.peer_stats;

  return {
    id: torrent.info_hash,
    name: torrent.name ?? torrent.info_hash,
    state,
    stateMessage: stats.error ?? '',
    isCompleted: stats.finished,
    progress,
    ratio: stats.progress_bytes > 0 ? stats.uploaded_bytes / stats.progress_bytes : 0,
    // rqbit does not track when a torrent was added or completed
    dateAdded: '',
    dateCompleted: undefined,
    label: undefined,
    savePath: torrent.output_folder,
    uploadSpeed: live ? Math.round(live.upload_speed.mbps * MIB) : 0,
    downloadSpeed: live ? Math.round(live.download_speed.mbps * MIB) : 0,
    eta: live?.time_remaining?.duration.secs ?? 0,
    // rqbit has no queue
    queuePosition: 0,
    // rqbit does not report seeds separately from peers
    connectedPeers: peerStats?.live ?? 0,
    connectedSeeds: 0,
    totalPeers: peerStats?.seen ?? 0,
    totalSeeds: 0,
    totalSelected: stats.total_bytes,
    totalSize: files ? files.reduce((sum, file) => sum + file.length, 0) : stats.total_bytes,
    totalUploaded: stats.uploaded_bytes,
    totalDownloaded: stats.progress_bytes,
    raw: torrent,
  };
}
