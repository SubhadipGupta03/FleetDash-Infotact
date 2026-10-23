
let io;

function setSocketServer(socketServer) {
  io = socketServer;
}

function getSocketServer() {
  if (!io) {
    throw new Error("Socket.IO server has not been initialized");
  }

  return io;
}

module.exports = {
  setSocketServer,
  getSocketServer,
};
