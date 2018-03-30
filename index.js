const DiscoveryChannel = require('discovery-channel')
const { EventEmitter } = require('events')
const RTMPSession = require('node-media-server/node_rtmp_session')
const extend = require('extend')
const Batch = require('batch')
const debug = require('debug')('rtmp-swarm')
const pump = require('pump')
const cuid = require('cuid')
const net = require('net')

require('node-media-server/logger').setLogType(0)

const PEER_SEEN = 1
const PEER_BANNED = 2
const MAX_RETRIES = 16

function createRTMPDiscoverySwarm(opts) {
  return new DiscoverySwarm(opts)
}

class DiscoverySwarmSession extends RTMPSession {
  constructor(socket, opts) {
    opts = extend(true, opts || {}, {
      rtmp: {
        chunk_size: 60000, gop_cache: true,
        ping_timeout: 30, ping: 60
      }
    })

    super(opts, socket)
  }
}

class DiscoverySwarm extends EventEmitter {
  constructor(opts) {
    super()
    opts = extend(true, opts || {}, {
      hash: false
    }, opts)

    this.onpeer = this.onpeer.bind(this)
    this.onclose = this.onclose.bind(this)
    this.onerror = this.onerror.bind(this)
    this.onwhoami = this.onwhoami.bind(this)
    this.onlistening = this.onlistening.bind(this)
    this.onconnection = this.onconnection.bind(this)

    this.id = Buffer.from(opts.id || cuid())

    this.net = opts.net || net
    this.stream = opts.stream || null
    this.server = this.net.createServer(this.onconnection)
    this.channel = new DiscoveryChannel(opts)

    this.closed = false
    this.listening = false
    this.destroyed = false

    this.seen = {}
    this.peers = {}
    this.pending = []
    this.sessions = []
    this.connected = {}

    this.maxConnections = opts.maxConnections || 0
    this.totalConnections = 0

    this.server.on('close', this.onclose)
    this.server.on('listening', this.onlistening)

    this.channel.on('peer', this.onpeer)
    this.channel.on('close', this.onclose)
    this.channel.on('whoami', this.onwhoami)

    this.setMaxListeners(0)
  }

  onconnection(socket) {
    debug("onconnection")
    const { maxConnections, connected, onerror, stream, peers, seen, net } = this
    const swarm = this
    this.emit('connection', socket)
    this.session(socket)
    for (const k in peers) {
      const peer = peers[k]
      debug("onconnection: peer:", peer)
      connect()
      function connect() {
        if (PEER_BANNED == seen[k]) {
          debug("onconnection: connect: peer: banned:", peer)
          return
        }

        if (k in connected) {
          debug("onconnection: connect: peer: skipped:", peer)
          return
        }

        if (maxConnections && swarm.totalConnections >= maxConnections) {
          debug("onconnection: connect: peer: skipped:", peer)
          return
        }

        const sock = net.connect(peer.port, peer.host)

        connected[k] = sock
        socket.pipe(sock)

        sock.on('connect', () => {
          debug("onconnection: peer: connect:", peer)
          swarm.totalConnections++
        })

        sock.on('close', () => {
          debug("onconnection: peer: close:", peer)
          delete connected[k]
          swarm.totalConnections--
        })

        sock.on('error', (err) => {
          debug("onconnection: peer: error:", err)
          if (peer.retries++ <= MAX_RETRIES) {
            connect()
          } else {
            seen[k] = PEER_BANNED
            delete peers[k]
          }
        })
      }
    }
  }

  onlistening() {
    debug("onlistening")
    this.listening = true
    this.emit('listening')
  }

  onwhoami(me) {
    debug("onwhoami:", me)
    const key = `${me.host}:${port}`
    this.seen[key] = PEER_BANNED
    this.emit('whoami', me)
  }

  onerror(err) {
    debug("onerror:", err)
    this.emit('error', err)
  }

  onclose() {
    debug("onclose")
    this.emit('close')
  }

  onpeer(channel, peer, type) {
    debug("onpeer:", channel, peer, type)
    this.emit('discovery', channel, peer, type)
    const key = `${peer.host}:${peer.port}`
    if (false == key in this.seen) {
      peer = peerify(peer, channel, 0)
      this.peers[key] = peer
      this.seen[key] = PEER_SEEN
      this.pending.push(peer)
      this.emit('peer', peer)
    }
  }

  session(socket, opts) {
    const { sessions } = this
    const session = new DiscoverySwarmSession(socketify(socket), opts)
    session.run()
    sessions.push(session)
    socket.on('destroy', onclose)
    socket.on('close', onclose)
    socket.on('end', onclose)
    return session
    function onclose() {
      sessions.splice(sessions.indexOf(session), 1)
    }
  }

  address() {
    return this.server.address()
  }

  listen(port, address, cb) {
    debug("listen:", port)
    this.server.listen(port, address, cb)
    return this
  }

  join(key, cb) {
    debug("join:", key)
    if (false == this.listening) {
      return this.once('listening', () => this.join(key, cb))
    }

    const { port } = this.address()
    this.channel.join(key, port, {impliedPort: true}, cb)
    return this
  }

  close(cb) {
    debug("close")
    return this.destroy(cb)
  }

  destroy(cb) {
    debug("destroy")
    const batch = new Batch()
    for (const session of this.sessions) {
      try {
        session.socket.destroy()
        session.stop()
      } catch (err) {
        debug("destroy: error:", err)
      }
    }
    batch.push((done) => this.server.close(done))
    batch.push((done) => this.channel.destroy(done))
    batch.end((err) => {
      if (err) {
        this.onerror(err)
      } else {
        this.listening = false
        this.destroyed = true
        this.closed = true
      }
      if ('function' == typeof cb) {
        cb(er)
      }
    })
    return this
  }
}

// ported from: https://github.com/mafintosh/discovery-swarm/blob/master/index.js
function peerify(peer, channel, retries) {
  if ('number' == typeof peer ) {
    peer = {port: peer}
  }

  if (!peer.host) {
    peer.host = '127.0.0.1'
  }

  retries = retries || 0
  channel = Buffer.isBuffer(channel) ? channel.toString('hex') : channel
  id = `${peer.host}:${peer.port}@${channel}`
  return Object.assign(peer, { id, channel, retries })
}

function socketify(socket) {
  if ('function' != typeof socket.setTimeout) {
    socket.setTimeout = net.Socket.prototype.setTimeout.bind(socket)
  }
  return socket
}

module.exports = Object.assign(createRTMPDiscoverySwarm, {
  DiscoverySwarm
})
