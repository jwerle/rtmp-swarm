rtmp-swarm
==========

Publish, consume, and discover RTMP streams in a network swarm.

## Install

```sh
$ npm install rtmp-swarm
```

## Example

Start a RTMP network daemon belonging to a network swarm specified
by a key.

```js
const discovery = require('./')

const port = process.argv[2] || 0
const key = process.argv[3] || 'rtmp-swarm'

const node = discovery()

node.join(key).listen(port)

node.on('listening', () => {
  const { port } = node.address()
  console.log("onlistening: rtmp://localhost:%s/%s", port, key)
})

node.on('peer', (peer) => {
  console.log('onpeer:', peer);
})

node.on('connection', () => {
  console.log('onconnection');
})
```

Publish video on demand with `ffmpeg` to the rtmp endpoint logged above:

```sh
$ ffmpeg -re -i 2k.mp4 \
  -c:v libx264 \
  -c:a aac \
  -preset superfast \
  -tune zerolatency \
  -ar 44100 \
  -f flv 'rtmp://localhost:40523/rtmp-stream'
```

Start another network swarm with the same key, but with a different
port and then access the stream with `mpv` or `ffplay`:

```sh
$ mpv 'rtmp://localhost:42583/rtmp-stream'
```

## API

### `const swarm = discovery(opts)`

where `opts` is

```js
{
  id: cuid(), // id for this peer
  net: require('net') // network interface
  maxConnections: 0, // max peering connections
}
```

which are passed directly to
[discovery-channel](https://github.com/maxogden/discovery-channel).

### `swarm.address()`

Returns the server address of this network swarm.

### `swarm.listen(port, address, cb)`

Bind a RTMP server to an optionally specified port and address. Will
call `cb(err)` when listening.

### `swarm.join(key, cb)`

Join a network swarm by key. Will call `cb(err)` after joining.

### `swarm.destroy(cb)`
### `swarm.close(cb)`

Close and destroy the network swarm.

## License

MIT
