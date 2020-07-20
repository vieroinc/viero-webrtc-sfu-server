/**
 * Copyright 2020 Viero, Inc.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

const {
  RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStream,
} = require('wrtc');
const { VieroError } = require('@viero/common/error');
const { VieroWebRTCSignalingServer } = require('@viero/webrtc-signaling-server');
const { VieroWebRTCCommon } = require('@viero/webrtc-common');
const { onEvent, emitEvent } = require('@viero/common-nodejs/event');

const DEFAULT_PEERCONNECTION_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

const peerBySocketId = (self, nsp, socketId) => self.nsps[nsp][socketId];

const peerFromEnvelope = (self, envelope) => {
  if (!envelope || !envelope.namespace || !(envelope.from || envelope.socketId)) return null;
  return peerBySocketId(self, envelope.namespace, (envelope.from || envelope.socketId));
};

const strippedPeer = (peer) => (({ socketId, stream }) => ({ socketId, stream }))(peer);

const peersOf = (self, nsp) => Object.values(self.nsps[nsp] || {});

const oPeersOf = (self, nsp, peer) => peersOf(self, nsp).filter((aPeer) => peer.socketId !== aPeer.socketId);

const updatePeerConnectionOnPeer = (self, peer, oPeer) => {
  const opc = new RTCPeerConnection(self.peerConnectionConfiguration);
  // eslint-disable-next-line no-use-before-define
  opc.addEventListener('connectionstatechange', onConnectionStateChange.bind(null, self, peer, oPeer));
  // eslint-disable-next-line no-use-before-define
  opc.addEventListener('icecandidate', onICECandidate.bind(null, self, peer, oPeer));
  // eslint-disable-next-line no-use-before-define
  opc.addEventListener('iceconnectionstatechange', onICEConnectionStateChange.bind(null, self, peer, oPeer));
  // eslint-disable-next-line no-use-before-define
  opc.addEventListener('icegatheringstatechange', onICEGatheringStateChange.bind(null, self, peer, oPeer));
  // eslint-disable-next-line no-use-before-define
  opc.addEventListener('signalingstatechange', onSignalingStateChange.bind(null, self, peer, oPeer));
  peer.opcs[oPeer.socketId] = opc;
};

const updatePeerConnectionsOnPeer = (self, peer) => {
  oPeersOf(self, peer.nsp, peer).forEach((oPeer) => {
    updatePeerConnectionOnPeer(self, peer, oPeer);
  });
};

const updateStreamOnPeer = (self, peer, oPeer) => {
  const opc = peer.opcs[oPeer.socketId];
  const senders = opc.getSenders();
  if (senders.length) senders.forEach((sender) => opc.removeTrack(sender));
  if (!oPeer.stream) return Promise.resolve();
  oPeer.stream.getTracks().forEach((track) => opc.addTrack(track, oPeer.stream));
  // eslint-disable-next-line no-use-before-define
  return onNegotiationNeeded(self, peer, oPeer);
};

const updateStreamsOnPeer = (self, peer) => {
  oPeersOf(self, peer.nsp, peer).forEach((oPeer) => {
    updateStreamOnPeer(self, peer, oPeer);
  });
};

const onConnectionStateChange = (self, peer, oPeer) => {
  emitEvent(VieroWebRTCCommon.EVENT.WEBRTC.STATE_DID_CHANGE, {
    id: oPeer ? 'N/A' : peer.socketId,
    direction: oPeer ? 'out' : 'in',
    state: 'connectionState',
    value: oPeer ? 'N/A' : peer.ipc.connectionState,
  });
  if (!oPeer && peer.ipc.connectionState === 'disconnected') {
    // the peer's incoming ipc connection is gone
    // TODO: handle
  } else if (oPeer && peer.ipc.connectionState === 'disconnected') {
    // the peer's outgoing opcs[oPeer.socketId] connection is gone
    // TODO: handle
  }
};

const onICECandidate = (self, peer, oPeer, evt) => {
  if (evt.candidate) {
    self.signalingServer.send(
      peer.nsp,
      {
        word: VieroWebRTCCommon.WORD.CDT,
        data: JSON.parse(JSON.stringify(evt.candidate)),
        ...(oPeer ? { on: oPeer.socketId } : {}),
      },
      peer.socketId,
    );
  }
};

const onICEConnectionStateChange = (self, peer, oPeer) => {
  emitEvent(VieroWebRTCCommon.EVENT.WEBRTC.STATE_DID_CHANGE, {
    id: oPeer ? 'N/A' : peer.socketId,
    direction: oPeer ? 'out' : 'in',
    state: 'iceConnectionState',
    value: oPeer ? 'N/A' : peer.ipc.iceConnectionState,
  });
};

const onICEGatheringStateChange = (self, peer, oPeer) => {
  emitEvent(VieroWebRTCCommon.EVENT.WEBRTC.STATE_DID_CHANGE, {
    id: oPeer ? 'N/A' : peer.socketId,
    direction: oPeer ? 'out' : 'in',
    state: 'iceGatheringState',
    value: oPeer ? 'N/A' : peer.ipc.iceGatheringState,
  });
};

const onNegotiationNeeded = (self, peer, oPeer) => {
  const pc = oPeer ? peer.opcs[oPeer.socketId] : peer.ipc;
  return pc.createOffer().then((offer) => {
    pc.setLocalDescription(offer);
  }).then(() => self.signalingServer.send(
    peer.nsp,
    {
      word: VieroWebRTCCommon.WORD.SDP,
      data: JSON.parse(JSON.stringify(pc.localDescription)),
      ...(oPeer ? { on: oPeer.socketId } : {}),
    },
    peer.socketId,
  )).catch((err) => {
    const error = new VieroError('/webrtc/sfu/server', 788167, { [VieroError.KEY.ERROR]: err });
    emitEvent(VieroWebRTCCommon.EVENT.ERROR, { error });
  });
};

const onSignalingStateChange = (self, peer, oPeer) => {
  emitEvent(VieroWebRTCCommon.EVENT.WEBRTC.STATE_DID_CHANGE, {
    id: oPeer ? 'N/A' : peer.socketId,
    direction: oPeer ? 'out' : 'in',
    state: 'signalingState',
    value: oPeer ? 'N/A' : peer.ipc.signalingState,
  });
};

const onTrack = (self, peer, evt) => {
  const stream = evt.streams[0];
  peer.stream = stream;
  peer.stream.addEventListener('removetrack', () => {
    setImmediate(() => {
      emitEvent(VieroWebRTCCommon.EVENT.TRACK.DID_REMOVE, { peer: strippedPeer(peer) });
    });
  });
  emitEvent(VieroWebRTCCommon.EVENT.TRACK.DID_ADD, { peer: strippedPeer(peer) });

  oPeersOf(self, peer.nsp, peer).forEach((oPeer) => {
    updateStreamOnPeer(self, oPeer, peer);
  });

  // RECORDING STUDY:
  // const vTrack = stream.getVideoTracks()[0];
  // record(vTrack, peer.ipc);
};

const onMessage = (self, envelope) => {
  const { payload } = envelope;
  if (!payload) return Promise.resolve();
  switch (payload.word) {
    case VieroWebRTCCommon.WORD.SDP: {
      const peer = peerFromEnvelope(self, envelope);
      const sdp = new RTCSessionDescription(payload.data);
      switch (sdp.type) {
        case 'offer': {
          return peer.ipc.setRemoteDescription(sdp)
            .then(() => peer.ipc.createAnswer())
            .then((answer) => peer.ipc.setLocalDescription(answer))
            .then(() => self.signalingServer.send(
              envelope.namespace,
              {
                word: VieroWebRTCCommon.WORD.SDP,
                data: JSON.parse(JSON.stringify(peer.ipc.localDescription)),
              },
              envelope.from,
            ))
            .catch((err) => {
              const error = new VieroError('/webrtc/sfu/client', 352177, { [VieroError.KEY.ERROR]: err });
              emitEvent(VieroWebRTCCommon.EVENT.ERROR, { error });
            });
        }
        case 'answer': {
          return peer.opcs[payload.on].setRemoteDescription(sdp)
            .catch((err) => {
              const error = new VieroError('/webrtc/sfu/client', 645167, { [VieroError.KEY.ERROR]: err });
              emitEvent(VieroWebRTCCommon.EVENT.ERROR, { error });
            });
        }
        default: return Promise.resolve();
      }
    }
    case VieroWebRTCCommon.WORD.CDT: {
      const peer = peerFromEnvelope(self, envelope);
      const cdt = new RTCIceCandidate(payload.data);
      return (payload.on ? peer.opcs[payload.on] : peer.ipc).addIceCandidate(cdt).catch((err) => {
        const error = new VieroError('/webrtc/sfu/client', 518450, { [VieroError.KEY.ERROR]: err, data: payload.data });
        emitEvent(VieroWebRTCCommon.EVENT.ERROR, { error });
      });
    }
    default: return Promise.resolve();
  }
};

const createNamespace = (self, envelope) => {
  self.nsps[envelope.namespace] = {};
};

const addPeer = (self, envelope) => {
  const ipc = new RTCPeerConnection(self.peerConnectionConfiguration);
  const peer = {
    nsp: envelope.namespace,
    socketId: envelope.socketId,
    ipc,
    opcs: {},
    stream: new MediaStream([]),
  };
  ipc.addEventListener('connectionstatechange', onConnectionStateChange.bind(null, self, peer, null));
  ipc.addEventListener('icecandidate', onICECandidate.bind(null, self, peer, null));
  ipc.addEventListener('iceconnectionstatechange', onICEConnectionStateChange.bind(null, self, peer, null));
  ipc.addEventListener('icegatheringstatechange', onICEGatheringStateChange.bind(null, self, peer, null));
  ipc.addEventListener('signalingstatechange', onSignalingStateChange.bind(null, self, peer, null));
  ipc.addEventListener('track', onTrack.bind(null, self, peer));
  self.nsps[envelope.namespace][envelope.socketId] = peer;
  emitEvent(VieroWebRTCCommon.EVENT.PEER.DID_ENTER, { peer: strippedPeer(peer) });
  return peer;
};

const removePeer = (self, peer) => {
  peer.stream.getTracks().forEach((track) => track.stop());
  oPeersOf(self, peer.nsp, peer).forEach((oPeer) => {
    const opc = oPeer.opcs[peer.socketId];
    if (opc) {
      opc.close();
    }
  });
  Object.values(peer.opcs).forEach((opc) => opc.close());
  peer.ipc.close();
  if (self.nsps[peer.nsp][peer.socketId]) {
    delete self.nsps[peer.nsp][peer.socketId];
  }
  self.signalingServer.close(peer.nsp, peer.socketId);
  emitEvent(VieroWebRTCCommon.EVENT.PEER.DID_LEAVE, { peer: strippedPeer(peer) });
};

class VieroWebRTCSFUServer {
  constructor(options) {
    options = options || {};
    this.peerConnectionConfiguration = options.peerConnectionConfiguration || DEFAULT_PEERCONNECTION_CONFIGURATION;
    this.nsps = {};
  }

  run(httpServer, signalingServer) {
    this._server = httpServer;
    this.signalingServer = signalingServer;
    this.signalingServer.run(this._server, { bindAdminEndpoint: true, relayNonAddressed: false });

    onEvent(VieroWebRTCSignalingServer.EVENT.DID_CREATE_NAMESPACE, (envelope) => {
      createNamespace(this, envelope);
    });

    onEvent(VieroWebRTCSignalingServer.EVENT.DID_ENTER_NAMESPACE, (envelope) => {
      const peer = addPeer(this, envelope);

      // 1. make an opc on each existing peers on this peer
      updatePeerConnectionsOnPeer(this, peer);

      // 2. route all existing incoming streams into the new opcs of this peer
      updateStreamsOnPeer(this, peer);

      // 3. make an additional opc on each existing peers to this peer
      oPeersOf(this, peer.nsp, peer).forEach((oPeer) => {
        updatePeerConnectionOnPeer(this, oPeer, peer);
      });
    });

    onEvent(VieroWebRTCSignalingServer.EVENT.WILL_RELAY_ENVELOPE, (envelope) => {
      // messages not meant for us we ignore
      if (!envelope || envelope.to) return;
      onMessage(this, envelope);
    });

    // we are not interested in events on our own send() calls
    // onEvent(VieroWebRTCSignalingServer.EVENT.WILL_DELIVER_ENVELOPE, (envelope) => {});

    onEvent(VieroWebRTCSignalingServer.EVENT.DID_LEAVE_NAMESPACE, (envelope) => {
      const peer = peerFromEnvelope(this, envelope);
      if (peer) {
        removePeer(this, peer);
      }
    });
  }
}

module.exports = {
  VieroWebRTCSFUServer,
};
