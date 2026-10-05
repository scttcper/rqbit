# rqbit [![npm](https://img.shields.io/npm/v/@ctrl/rqbit.svg?maxAge=3600)](https://www.npmjs.com/package/@ctrl/rqbit)

> TypeScript api wrapper for [rqbit](https://github.com/ikatson/rqbit) using [ofetch](https://github.com/unjs/ofetch)

### Install

```sh
npm install @ctrl/rqbit
```

Requires Node.js 24 or newer.

### Use

```ts
import { Rqbit } from '@ctrl/rqbit';

const client = new Rqbit({
  baseUrl: 'http://localhost:3030/',
  // only needed when rqbit is started with RQBIT_HTTP_BASIC_AUTH_USERPASS
  username: 'admin',
  password: 'adminadmin',
});

async function main() {
  const res = await client.getAllData();
  console.log(res);
}
```

### API

Docs: https://rqbit.ep.workers.dev

rqbit has no published api reference, `GET /` on the server lists every endpoint (`client.getApiInfo()`). The types here are based on responses from rqbit 9.0.1 and its [http api source](https://github.com/ikatson/rqbit/tree/v9.0.1/crates/librqbit/src/http_api).

Things that work differently from the other clients:

- Adding a magnet does not respond until rqbit resolves the metadata from peers. Adds use `addTimeout` (default 60 seconds) instead of `timeout`.
- rqbit has no labels, queue, or added/completed dates. `label` is ignored, `queueUp`/`queueDown` throw, and `dateAdded` is an empty string.
- `createTorrent` needs rqbit started with `RQBIT_HTTP_API_ALLOW_CREATE=true`, and `getStreamUrl`/`getPlaylistUrl` urls need the same basic auth as the api.
- Speeds are reported in MiB/s and converted to bytes per second when normalized.
- Torrents are added with `overwrite: true` by default, like Radarr does. rqbit refuses to add a torrent whose files already exist on disk otherwise.
- Failed requests throw `RqbitApiError` with the http `status` and rqbit's error `kind`, ex - `torrent_not_found`. Timeouts and network errors are also `RqbitApiError` with no `status`.
- rqbit's `total_bytes` only counts the pieces of selected files. `getTorrent` uses the file list for `totalSize`, `getAllData` skips the extra request per torrent so its `totalSize` is the selected size.

### Normalized API

These functions are normalized through [@ctrl/shared-torrent](https://github.com/scttcper/shared-torrent), which makes it easier to support multiple torrent clients. See [below](#see-also) for alternative supported torrent clients.

##### getAllData

Returns all torrent data and an array of label objects. Data has been normalized and does not match the output of native `listTorrents()`. rqbit has no labels so labels is always empty.

```ts
const data = await client.getAllData();
console.log(data.torrents);
```

##### getTorrent

Returns one torrent data from torrent hash

```ts
const data = await client.getTorrent('torrent-hash');
console.log(data);
```

##### pauseTorrent and resumeTorrent

Pause or resume one or more torrents

```ts
await client.pauseTorrent('torrent-hash');
await client.resumeTorrent(['torrent-hash', 'other-torrent-hash']);
```

##### removeTorrent

Remove one or more torrents, throws if a torrent doesn't exist. Does not remove data on disk by default.

```ts
// does not remove data on disk
await client.removeTorrent('torrent-hash', false);

// remove data on disk
await client.removeTorrent(['torrent-hash', 'other-torrent-hash'], true);
```

##### addTorrent

Add a torrent from a magnet link or torrent file, has client specific options. Also see normalizedAddTorrent

```ts
import { readFileSync } from 'node:fs';

const result = await client.addTorrent(new Uint8Array(readFileSync('./linux.torrent')), {
  output_folder: '/downloads/linux',
});
console.log(result.details.info_hash);
```

##### normalizedAddTorrent

Add a torrent and return normalized torrent data. rqbit cannot add a torrent paused, `startPaused` pauses it right after adding.

```ts
const result = await client.normalizedAddTorrent('magnet:?xt=urn:btih:...', {
  startPaused: true,
});
console.log(result);
```

##### export and create from state

rqbit uses basic auth on every request so there is no session to save, this exists to match the other clients.

```ts
const state = client.exportState();
const restored = Rqbit.createFromState(config, state);
```

### See Also

All of the following npm modules provide the same normalized functions along with supporting the unique apis for each client.

- shared types - [@ctrl/shared-torrent](https://github.com/scttcper/shared-torrent)
- deluge - [@ctrl/deluge](https://github.com/scttcper/deluge)
- transmission - [@ctrl/transmission](https://github.com/scttcper/transmission)
- qbittorrent - [@ctrl/qbittorrent](https://github.com/scttcper/qbittorrent)
- utorrent - [@ctrl/utorrent](https://github.com/scttcper/utorrent)
- rtorrent - [@ctrl/rtorrent](https://github.com/scttcper/rtorrent)

Usenet clients with the same normalized approach:

- usenet shared types - [@ctrl/shared-usenet](https://github.com/scttcper/shared-usenet)
- nzbget - [@ctrl/nzbget](https://github.com/scttcper/nzbget)
- sabnzbd - [@ctrl/sabnzbd](https://github.com/scttcper/sabnzbd)

### Start a test docker container

```
docker run -d \
  --name=rqbit \
  -e RQBIT_HTTP_BASIC_AUTH_USERPASS=admin:adminadmin \
  -e RQBIT_HTTP_API_ALLOW_CREATE=true \
  -p 3030:3030 \
  -p 4240:4240 \
  -v ~/Documents/rqbit/downloads:/home/rqbit/downloads \
  --restart unless-stopped \
  ikatson/rqbit:latest
```
