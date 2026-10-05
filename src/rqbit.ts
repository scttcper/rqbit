import type {
  AddTorrentOptions as NormalizedAddTorrentOptions,
  AllClientData,
  NormalizedTorrent,
  TorrentClient,
  TorrentClientConfig,
  TorrentClientState,
} from '@ctrl/shared-torrent';
import {
  FetchError,
  ofetch,
  type FetchOptions,
  type MappedResponseType,
  type ResponseType,
} from 'ofetch';
import type { Jsonify } from 'type-fest';
import { joinURL } from 'ufo';
import { base64ToUint8Array, stringToBase64 } from 'uint8array-extras';

import { normalizeTorrentData } from './normalizeTorrentData.js';
import type {
  AddTorrentOptions,
  AddTorrentResponse,
  ApiRootResponse,
  CreateTorrentOptions,
  CreateTorrentResponse,
  DhtStats,
  EmptyResponse,
  ListTorrentsResponse,
  PeerStatsResponse,
  RateLimits,
  RqbitErrorResponse,
  SessionStats,
  TorrentDetails,
  TorrentIdOrHash,
  TorrentListItem,
  TorrentStats,
  TorrentWithStats,
} from './types.js';

/**
 * rqbit uses basic auth on every request, there is no session to keep
 */
export type RqbitState = TorrentClientState;

export interface RqbitConfig extends TorrentClientConfig {
  /**
   * How long to wait when adding a torrent, in milliseconds.
   * rqbit does not respond to an add until magnet metadata is resolved from peers, so adds need much longer than `timeout`.
   * default: 60_000
   */
  addTimeout?: number;
}

export type ResolvedConfig = RqbitConfig & { path: string; addTimeout: number };

const defaults: ResolvedConfig = {
  baseUrl: 'http://localhost:3030/',
  path: '/',
  username: '',
  password: '',
  timeout: 5000,
  addTimeout: 60_000,
};

/**
 * Error thrown when a request to rqbit fails, either an error response or a timeout/network error
 */
export class RqbitApiError extends Error {
  override name = 'RqbitApiError';
  /**
   * HTTP status code, undefined when no response was received (timeout or network error)
   */
  status?: number;
  /**
   * rqbit error kind, ex - `torrent_not_found`. Undefined when rqbit returned a plain text error.
   */
  kind?: string;
  response?: RqbitErrorResponse;

  constructor(
    status: number | undefined,
    message: string,
    response?: RqbitErrorResponse,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.status = status;
    this.kind = response?.error_kind;
    this.response = response;
  }
}

/**
 * rqbit has no published api reference. `GET /` on the server lists every endpoint, see {@link Rqbit.getApiInfo}.
 * Routes {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/http_api/handlers/mod.rs}
 * Response types {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/api.rs}
 */
export class Rqbit implements TorrentClient {
  static createFromState(
    config: Readonly<Partial<RqbitConfig>>,
    state: Readonly<Jsonify<RqbitState>>,
  ): Rqbit {
    const client = new Rqbit(config);
    client.state = { ...state };
    return client;
  }

  config: ResolvedConfig;
  state: RqbitState = {};

  constructor(options: Partial<RqbitConfig> = {}) {
    this.config = { ...defaults, ...options };
  }

  exportState(): Jsonify<RqbitState> {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Lists the available api endpoints and the rqbit version
   */
  async getApiInfo(): Promise<ApiRootResponse> {
    return this.request<ApiRootResponse>('/');
  }

  /**
   * rqbit version, ex - `9.0.1`
   */
  async getVersion(): Promise<string> {
    const res = await this.getApiInfo();
    return res.version;
  }

  /**
   * Session wide download/upload speed, peer and connection stats
   */
  async getSessionStats(): Promise<SessionStats> {
    return this.request<SessionStats>('/stats');
  }

  async getDhtStats(): Promise<DhtStats> {
    return this.request<DhtStats>('/dht/stats');
  }

  async getRateLimits(): Promise<RateLimits> {
    return this.request<RateLimits>('/torrents/limits');
  }

  /**
   * Set session wide rate limits in bytes per second, null removes the limit
   */
  async setRateLimits(limits: RateLimits): Promise<EmptyResponse> {
    return this.request<EmptyResponse>('/torrents/limits', { method: 'POST', body: limits });
  }

  async listTorrents(withStats: true): Promise<ListTorrentsResponse<TorrentWithStats>>;
  async listTorrents(withStats?: false): Promise<ListTorrentsResponse<TorrentListItem>>;
  async listTorrents(withStats = false): Promise<ListTorrentsResponse> {
    return this.request<ListTorrentsResponse>('/torrents', {
      query: withStats ? { with_stats: true } : undefined,
    });
  }

  /**
   * Torrent details including the file list
   */
  async getTorrentDetails(id: TorrentIdOrHash): Promise<TorrentDetails> {
    return this.request<TorrentDetails>(`/torrents/${id}`);
  }

  async getTorrentStats(id: TorrentIdOrHash): Promise<TorrentStats> {
    return this.request<TorrentStats>(`/torrents/${id}/stats/v1`);
  }

  /**
   * Per peer stats, defaults to only live peers
   */
  async getTorrentPeerStats(
    id: TorrentIdOrHash,
    state: 'live' | 'all' = 'live',
  ): Promise<PeerStatsResponse> {
    return this.request<PeerStatsResponse>(`/torrents/${id}/peer_stats`, { query: { state } });
  }

  /**
   * Download the .torrent file for a torrent
   */
  async getTorrentMetadata(id: TorrentIdOrHash): Promise<Uint8Array<ArrayBuffer>> {
    const res = await this.request<ArrayBuffer, 'arrayBuffer'>(`/torrents/${id}/metadata`, {
      responseType: 'arrayBuffer',
    });
    return new Uint8Array(res);
  }

  /**
   * Url to stream a file from a torrent, supports range requests. rqbit requires basic auth on this url when it is enabled.
   * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/http_api/handlers/streaming.rs}
   * @param fileIndex index into the torrent's file list
   */
  getStreamUrl(id: TorrentIdOrHash, fileIndex: number): string {
    return this.url(`/torrents/${id}/stream/${fileIndex}`);
  }

  /**
   * Url to an m3u8 playlist of a torrent's playable files, or every torrent's when no id is passed.
   * rqbit requires basic auth on this url when it is enabled.
   */
  getPlaylistUrl(id?: TorrentIdOrHash): string {
    return this.url(id === undefined ? '/torrents/playlist' : `/torrents/${id}/playlist`);
  }

  async pauseTorrent(id: TorrentIdOrHash | TorrentIdOrHash[]): Promise<void> {
    for (const i of Array.isArray(id) ? id : [id]) {
      await this.request<EmptyResponse>(`/torrents/${i}/pause`, { method: 'POST' });
    }
  }

  async resumeTorrent(id: TorrentIdOrHash | TorrentIdOrHash[]): Promise<void> {
    for (const i of Array.isArray(id) ? id : [id]) {
      await this.request<EmptyResponse>(`/torrents/${i}/start`, { method: 'POST' });
    }
  }

  /**
   * Remove a torrent
   * @param removeData (default: false) If true, remove the downloaded files.
   * @throws {RqbitApiError} when a torrent doesn't exist
   */
  async removeTorrent(id: TorrentIdOrHash | TorrentIdOrHash[], removeData = false): Promise<void> {
    const action = removeData ? 'delete' : 'forget';
    for (const i of Array.isArray(id) ? id : [id]) {
      await this.request<EmptyResponse>(`/torrents/${i}/${action}`, { method: 'POST' });
    }
  }

  /**
   * Change which files are downloaded
   * @param fileIds indexes into the torrent's file list
   */
  async setTorrentFiles(id: TorrentIdOrHash, fileIds: number[]): Promise<EmptyResponse> {
    return this.request<EmptyResponse>(`/torrents/${id}/update_only_files`, {
      method: 'POST',
      body: { only_files: fileIds },
    });
  }

  /**
   * Connect to additional peers
   * @param peers ex - `['1.2.3.4:6881']`
   */
  async addPeers(id: TorrentIdOrHash, peers: string[]): Promise<{ added: number }> {
    return this.request<{ added: number }>(`/torrents/${id}/add_peers`, {
      method: 'POST',
      body: peers.join('\n'),
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  /**
   * rqbit does not support queueing
   */
  async queueUp(_id: TorrentIdOrHash | TorrentIdOrHash[]): Promise<never> {
    throw new Error('rqbit does not support queueing');
  }

  /**
   * rqbit does not support queueing
   */
  async queueDown(_id: TorrentIdOrHash | TorrentIdOrHash[]): Promise<never> {
    throw new Error('rqbit does not support queueing');
  }

  /**
   * Add a magnet link or a url to a .torrent file.
   * rqbit resolves magnet metadata from peers before it responds, so this can take a while, see {@link RqbitConfig.addTimeout}
   * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/http_api/handlers/torrents.rs}
   */
  async addMagnet(
    url: string,
    options: Partial<AddTorrentOptions> = {},
  ): Promise<AddTorrentResponse> {
    return this.postTorrent(url, true, options);
  }

  /**
   * Add a torrent
   * @param torrent .torrent file contents, or the file contents as a base64 string. Magnet links and urls are passed to {@link Rqbit.addMagnet}
   */
  async addTorrent(
    torrent: string | Uint8Array<ArrayBuffer>,
    options: Partial<AddTorrentOptions> = {},
  ): Promise<AddTorrentResponse> {
    if (typeof torrent === 'string') {
      if (isUrl(torrent)) {
        return this.addMagnet(torrent, options);
      }

      return this.postTorrent(base64ToUint8Array(torrent), false, options);
    }

    return this.postTorrent(torrent, false, options);
  }

  /**
   * Resolve a magnet link to .torrent file contents without adding it.
   * Like adding, rqbit fetches the metadata from peers before it responds, see {@link RqbitConfig.addTimeout}
   */
  async resolveMagnet(
    magnet: string,
    options: Partial<Pick<AddTorrentOptions, 'timeout_ms'>> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    const timeoutMs = options.timeout_ms ?? this.config.addTimeout;
    const res = await this.request<ArrayBuffer, 'arrayBuffer'>('/torrents/resolve_magnet', {
      method: 'POST',
      query: { timeout_ms: timeoutMs },
      body: magnet,
      // rqbit returns the torrent decoded as json when asked for json
      headers: { 'Content-Type': 'text/plain', Accept: 'application/x-bittorrent' },
      responseType: 'arrayBuffer',
      timeout: timeoutMs + 5000,
    });
    return new Uint8Array(res);
  }

  /**
   * Create a torrent from a folder on the rqbit server and start seeding it.
   * rqbit must be started with `--http-api-allow-create` or `RQBIT_HTTP_API_ALLOW_CREATE=true`.
   * @param folder path to the folder on the rqbit server
   */
  async createTorrent(
    folder: string,
    options: Partial<CreateTorrentOptions> = {},
  ): Promise<CreateTorrentResponse> {
    const magnet = await this.request<string, 'text'>('/torrents/create', {
      method: 'POST',
      // repeated trackers=a&trackers=b
      query: { output: 'magnet', ...options },
      body: folder,
      headers: { 'Content-Type': 'text/plain' },
      responseType: 'text',
    });
    // rqbit only sends the info hash in the magnet
    const infoHash = new URL(magnet).searchParams.get('xt')!.replace('urn:btih:', '');
    return { magnet, info_hash: infoHash };
  }

  /**
   * Add a torrent and return normalized torrent data.
   * The add endpoint has no paused option, `startPaused` pauses the torrent after adding.
   * rqbit does not support labels, `label` is ignored.
   * {@link https://github.com/ikatson/rqbit/blob/v9.0.1/crates/librqbit/src/http_api_types.rs}
   */
  async normalizedAddTorrent(
    torrent: string | Uint8Array<ArrayBuffer>,
    options: Partial<NormalizedAddTorrentOptions> = {},
  ): Promise<NormalizedTorrent> {
    const res = await this.addTorrent(torrent);
    const hash = res.details.info_hash;

    if (options.startPaused) {
      await this.pauseTorrent(hash);
    }

    return this.getTorrent(hash);
  }

  async getTorrent(id: TorrentIdOrHash): Promise<NormalizedTorrent> {
    const [details, stats] = await Promise.all([
      this.getTorrentDetails(id),
      this.getTorrentStats(id),
    ]);
    return normalizeTorrentData(
      {
        id: details.id,
        info_hash: details.info_hash,
        name: details.name,
        output_folder: details.output_folder,
        total_pieces: details.total_pieces,
        stats,
      },
      details.files,
    );
  }

  /**
   * rqbit does not support labels so labels is always empty
   */
  async getAllData(): Promise<AllClientData> {
    const res = await this.listTorrents(true);
    return {
      torrents: res.torrents.map(torrent => normalizeTorrentData(torrent)),
      labels: [],
      raw: res,
    };
  }

  async request<T, R extends ResponseType = 'json'>(
    path: string,
    options: FetchOptions<R> = {},
  ): Promise<MappedResponseType<R, T>> {
    const url = this.url(path);
    const headers = new Headers(options.headers);
    if (this.config.username || this.config.password) {
      const auth = stringToBase64(`${this.config.username}:${this.config.password}`);
      headers.set('Authorization', `Basic ${auth}`);
    }

    try {
      return await ofetch<T, R>(url, {
        timeout: this.config.timeout,
        dispatcher: this.config.dispatcher,
        retry: false,
        ...options,
        headers,
      });
    } catch (error) {
      if (!(error instanceof FetchError)) {
        throw error;
      }

      if (!error.response) {
        // ofetch aborted (timeout) or the request never reached rqbit
        throw new RqbitApiError(undefined, error.message, undefined, error);
      }

      const data: unknown = error.data;
      if (isRqbitError(data)) {
        throw new RqbitApiError(error.response.status, data.human_readable, data, error);
      }

      // rqbit returns plain text for routing and query string errors
      const message = typeof data === 'string' && data ? data : error.message;
      throw new RqbitApiError(error.response.status, message, undefined, error);
    }
  }

  private url(path: string): string {
    return joinURL(this.config.baseUrl, this.config.path, path);
  }

  private async postTorrent(
    body: string | Uint8Array<ArrayBuffer>,
    isUrlBody: boolean,
    options: Partial<AddTorrentOptions>,
  ): Promise<AddTorrentResponse> {
    const { only_files, initial_peers, ...rest } = options;
    const timeoutMs = options.timeout_ms ?? this.config.addTimeout;
    const query: Record<string, string | number | boolean> = {
      overwrite: true,
      is_url: isUrlBody,
      ...rest,
      timeout_ms: timeoutMs,
    };
    if (only_files) {
      query.only_files = only_files.join(',');
    }

    if (initial_peers) {
      query.initial_peers = initial_peers.join(',');
    }

    return this.request<AddTorrentResponse>('/torrents', {
      method: 'POST',
      query,
      body,
      headers: {
        'Content-Type': isUrlBody ? 'text/plain' : 'application/x-bittorrent',
      },
      // leave room for rqbit to respond with its own timeout error
      timeout: timeoutMs + 5000,
    });
  }
}

function isUrl(str: string): boolean {
  return /^(magnet:|https?:\/\/)/i.test(str);
}

function isRqbitError(data: unknown): data is RqbitErrorResponse {
  return typeof data === 'object' && data !== null && 'error_kind' in data;
}
