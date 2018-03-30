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
