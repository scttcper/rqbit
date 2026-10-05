/**
 * Types are based on responses from rqbit 9.0.1.
 * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/api.rs}
 * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/webui/src/api-types.ts}
 *
 * Response from `GET /`
 */
export interface ApiRootResponse {
  /**
   * Map of `"METHOD /path"` to a description of the endpoint
   */
  apis: Record<string, string>;
  server: 'rqbit';
  /**
   * rqbit version, ex - `9.0.1`
   */
  version: string;
}

/**
 * Torrent id from rqbit, or the 40 character info hash
 */
export type TorrentIdOrHash = number | string;

/**
 * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/torrent_state/stats.rs}
 */
export interface Speed {
  /**
   * Speed in MiB/s (despite the name), multiply by 1024 * 1024 for bytes per second
   */
  mbps: number;
  /**
   * ex - `7.56 MiB/s`
   */
  human_readable: string;
}

export interface Duration {
  secs: number;
  nanos: number;
}

export interface DurationWithHumanReadable {
  duration: Duration;
  /**
   * ex - `4m 1s`
   */
  human_readable: string;
}

export interface AggregatePeerStats {
  queued: number;
  connecting: number;
  live: number;
  live_tcp: number;
  live_utp: number;
  live_socks: number;
  seen: number;
  dead: number;
  not_needed: number;
  steals: number;
}

export interface StatsSnapshot {
  downloaded_and_checked_bytes: number;
  fetched_bytes: number;
  uploaded_bytes: number;
  downloaded_and_checked_pieces: number;
  total_piece_download_ms: number;
  peer_stats: AggregatePeerStats;
}

/**
 * Only present while the torrent is live
 */
export interface LiveStats {
  snapshot: StatsSnapshot;
  average_piece_download_time: Duration | null;
  download_speed: Speed;
  upload_speed: Speed;
  time_remaining: DurationWithHumanReadable | null;
}

/**
 * A torrent paused while initializing stays `initializing` with `initializing_paused: true` until it is started.
 * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/torrent_state/stats.rs}
 */
export type TorrentStatsState = 'initializing' | 'live' | 'paused' | 'error';

/**
 * Response from `GET /torrents/{id}/stats/v1`
 */
export interface TorrentStats {
  state: TorrentStatsState;
  /**
   * Only present when state is `initializing`
   */
  initializing_paused?: boolean;
  /**
   * Bytes downloaded per file, in file order
   */
  file_progress: number[];
  error: string | null;
  progress_bytes: number;
  uploaded_bytes: number;
  /**
   * Total bytes of the selected files
   */
  total_bytes: number;
  finished: boolean;
  live: LiveStats | null;
}

export interface TorrentFileAttributes {
  symlink: boolean;
  hidden: boolean;
  padding: boolean;
  executable: boolean;
}

export interface TorrentFile {
  name: string;
  components: string[];
  length: number;
  /**
   * Whether the file is selected for download
   */
  included: boolean;
  attributes: TorrentFileAttributes;
}

/**
 * Response from `GET /torrents/{id}`
 */
export interface TorrentDetails {
  id: number;
  info_hash: string;
  /**
   * null until metadata is resolved
   */
  name: string | null;
  output_folder: string;
  total_pieces: number;
  files: TorrentFile[];
}

/**
 * Item from `GET /torrents`
 */
export interface TorrentListItem {
  id: number;
  info_hash: string;
  name: string | null;
  output_folder: string;
  total_pieces: number;
  /**
   * Only present when listing with stats
   */
  stats?: TorrentStats;
}

export interface TorrentWithStats extends TorrentListItem {
  stats: TorrentStats;
}

/**
 * Response from `GET /torrents`
 */
export interface ListTorrentsResponse<T extends TorrentListItem = TorrentListItem> {
  torrents: T[];
}

/**
 * Response from `POST /torrents`
 */
export interface AddTorrentResponse {
  /**
   * null when added with `list_only`
   */
  id: number | null;
  details: TorrentDetails;
  output_folder: string;
  seen_peers: string[] | null;
}

/**
 * Query options for `POST /torrents`
 * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/http_api_types.rs}
 */
export interface AddTorrentOptions {
  /**
   * Allow writing over existing files on disk, rqbit refuses to add a torrent whose files already exist without this.
   * default: true
   */
  overwrite: boolean;
  /**
   * Absolute folder to download into, defaults to the folder rqbit was started with
   */
  output_folder: string;
  /**
   * Folder inside the output folder to download into
   */
  sub_folder: string;
  /**
   * Only download files matching this regex
   */
  only_files_regex: string;
  /**
   * Only download these file indexes
   */
  only_files: number[];
  /**
   * Resolve the torrent and return its details without adding it
   */
  list_only: boolean;
  /**
   * Extra peers to connect to, ex - `['1.2.3.4:6881']`
   */
  initial_peers: string[];
  /**
   * Seconds
   */
  peer_connect_timeout: number;
  /**
   * Seconds
   */
  peer_read_write_timeout: number;
  /**
   * How long rqbit will wait to resolve magnet metadata before giving up, also used as the request timeout.
   * default: {@link RqbitConfig.addTimeout}
   */
  timeout_ms: number;
}

export interface PeerCounters {
  incoming_connections: number;
  fetched_bytes: number;
  uploaded_bytes: number;
  total_time_connecting_ms: number;
  connection_attempts: number;
  connections: number;
  errors: number;
  fetched_chunks: number;
  downloaded_and_checked_pieces: number;
  total_piece_download_ms: number;
  times_stolen_from_me: number;
  times_i_stole: number;
}

export type PeerState = 'queued' | 'connecting' | 'live' | 'dead' | 'not_needed';

export interface PeerStats {
  counters: PeerCounters;
  state: PeerState;
  conn_kind: 'tcp' | 'utp' | 'socks' | null;
  client_name: string | null;
}

/**
 * Response from `GET /torrents/{id}/peer_stats`
 */
export interface PeerStatsResponse {
  /**
   * Keyed by `ip:port`
   */
  peers: Record<string, PeerStats>;
}

export interface ConnectionStatSingle {
  attempts: number;
  successes: number;
  errors: number;
}

export interface ConnectionStatsPerFamily {
  v4: ConnectionStatSingle;
  v6: ConnectionStatSingle;
}

/**
 * Response from `GET /stats`
 */
export interface SessionStats {
  counters: {
    fetched_bytes: number;
    uploaded_bytes: number;
    blocked_incoming: number;
    blocked_outgoing: number;
  };
  download_speed: Speed;
  upload_speed: Speed;
  peers: AggregatePeerStats;
  uptime_seconds: number;
  connections: {
    tcp: ConnectionStatsPerFamily;
    utp: ConnectionStatsPerFamily;
    socks: ConnectionStatsPerFamily;
  };
}

/**
 * Session wide rate limits, null is unlimited
 */
export interface RateLimits {
  /**
   * bytes per second
   */
  upload_bps: number | null;
  /**
   * bytes per second
   */
  download_bps: number | null;
}

/**
 * JSON error body returned by rqbit
 */
export interface RqbitErrorResponse {
  /**
   * ex - `torrent_not_found`, `internal_error`
   */
  error_kind: string;
  human_readable: string;
  status: number;
  status_text: string;
  id?: string;
}

/**
 * Empty response from actions like pause, start, forget and delete
 */
export type EmptyResponse = Record<string, never>;

/**
 * Response from `GET /dht/stats`
 */
export interface DhtStats {
  /**
   * This node's DHT id
   */
  id: string;
  outstanding_requests: number;
  routing_table_size: number;
  routing_table_size_v6: number;
}

/**
 * Query options for `POST /torrents/create`
 * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/http_api/handlers/torrents.rs}
 */
export interface CreateTorrentOptions {
  /**
   * Torrent name, defaults to the folder name
   */
  name: string;
  /**
   * Announce urls
   */
  trackers: string[];
}

export interface CreateTorrentResponse {
  magnet: string;
  info_hash: string;
}
