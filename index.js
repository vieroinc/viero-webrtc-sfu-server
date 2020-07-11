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

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStream } = require('wrtc');
const { VieroError } = require('@viero/common/error');
const { VieroWebRTCSignalingServer } = require('@viero/webrtc-signaling-server');
const { VieroWebRTCCommon } = require('@viero/webrtc-common');
const { onEvent, emitEvent } = require('@viero/common-nodejs/event');

const _defaultPeerConnectionConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

const _onConnectionStateChange = (self, peer, oPeer, evt) => {
  emitEvent(VieroWebRTCCommon.EVENT.WEBRTC.STATE_DID_CHANGE, {
    id: oPeer ? 'N/A' : peer.socketId,
    direction: oPeer ? 'out' : 'in',
    state: 'connectionState',
    value: oPeer ? 'N/A' : peer.ipc.connectionState,
  });
  if (!oPeer && 'disconnected' === peer.ipc.connectionState) {
    // the peer's incoming ipc connection is gone
    // TODO: handle
  } else if (oPeer && 'disconnected' === peer.ipc.connectionState) {
    // the peer's outgoing opcs[oPeer.socketId] connection is gone
    // TODO: handle
  }
};

const _onICECandidate = (self, peer, oPeer, evt) => {
  if (evt.candidate) {
    return self._signalingServer.send(
      peer.nsp,
      {
        word: VieroWebRTCCommon.WORD.CDT,
        data: JSON.parse(JSON.stringify(evt.candidate)),
        ...(!!oPeer ? { on: oPeer.socketId } : {}),
      },
      peer.socketId,
    );
  }
};

const _onICEConnectionStateChange = (self, peer, oPeer, evt) => {
  emitEvent(VieroWebRTCCommon.EVENT.WEBRTC.STATE_DID_CHANGE, {
    id: oPeer ? 'N/A' : peer.socketId,
    direction: oPeer ? 'out' : 'in',
    state: 'iceConnectionState',
    value: oPeer ? 'N/A' : peer.ipc.iceConnectionState,
  });
};

const _onICEGatheringStateChange = (self, peer, oPeer, evt) => {
  emitEvent(VieroWebRTCCommon.EVENT.WEBRTC.STATE_DID_CHANGE, {
    id: oPeer ? 'N/A' : peer.socketId,
    direction: oPeer ? 'out' : 'in',
    state: 'iceGatheringState',
    value: oPeer ? 'N/A' : peer.ipc.iceGatheringState,
  });
};

const _onNegotiationNeeded = (self, peer, oPeer, evt) => {
  const pc = oPeer ? peer.opcs[oPeer.socketId] : peer.ipc;
  return pc.createOffer().then((offer) => {
    pc.setLocalDescription(offer);
  }).then(() => {
    return self._signalingServer.send(
      peer.nsp,
      {
        word: VieroWebRTCCommon.WORD.SDP,
        data: JSON.parse(JSON.stringify(pc.localDescription)),
        ...(oPeer ? { on: oPeer.socketId } : {}),
      },
      peer.socketId,
    );
  }).catch((err) => {
    const error = new VieroError('/webrtc/sfu/server', 788167, { [VieroError.KEY.ERROR]: err });
    emitEvent(VieroWebRTCCommon.EVENT.ERROR, { error });
  });
};

const _onSignalingStateChange = (self, peer, oPeer, evt) => {
  emitEvent(VieroWebRTCCommon.EVENT.WEBRTC.STATE_DID_CHANGE, {
    id: oPeer ? 'N/A' : peer.socketId,
    direction: oPeer ? 'out' : 'in',
    state: 'signalingState',
    value: oPeer ? 'N/A' : peer.ipc.signalingState,
  });
};

const _onTrack = (self, peer, evt) => {
  const stream = evt.streams[0];
  peer.stream = stream;
  peer.stream.addEventListener('removetrack', (evt) => {
    setImmediate(() => {
      emitEvent(VieroWebRTCCommon.EVENT.TRACK.DID_REMOVE, { peer: _strippedPeer(peer) });
    });
  });
  emitEvent(VieroWebRTCCommon.EVENT.TRACK.DID_ADD, { peer: _strippedPeer(peer) });

  _oPeersOf(self, peer.nsp, peer).forEach((oPeer) => {
    _updateStreamOnPeer(self, oPeer, peer);
  });

  // RECORDING STUDY:
  // const vTrack = stream.getVideoTracks()[0];
  // record(vTrack, peer.ipc);
};

const _onMessage = (self, envelope) => {
  const payload = envelope.payload;
  if (!payload) return;
  switch (payload.word) {
    case VieroWebRTCCommon.WORD.SDP: {
      const peer = _peerFromEnvelope(self, envelope);
      const sdp = new RTCSessionDescription(payload.data);
      switch (sdp.type) {
        case 'offer': {
          return peer.ipc.setRemoteDescription(sdp).then(() => {
            return peer.ipc.createAnswer();
          }).then((answer) => {
            return peer.ipc.setLocalDescription(answer);
          }).then(() => {
            return self._signalingServer.send(
              envelope.namespace,
              {
                word: VieroWebRTCCommon.WORD.SDP,
                data: JSON.parse(JSON.stringify(peer.ipc.localDescription)),
              },
              envelope.from,
            );
          }).catch((err) => {
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
        default: return;
      }
    }
    case VieroWebRTCCommon.WORD.CDT: {
      const peer = _peerFromEnvelope(self, envelope);
      const cdt = new RTCIceCandidate(payload.data);
      return (payload.on ? peer.opcs[payload.on] : peer.ipc).addIceCandidate(cdt).catch((err) => {
        const error = new VieroError('/webrtc/sfu/client', 518450, { [VieroError.KEY.ERROR]: err, data: payload.data });
        emitEvent(VieroWebRTCCommon.EVENT.ERROR, { error });
      });
    }
  }
}

const _strippedPeer = (peer) => {
  return (({ socketId, stream }) => ({ socketId, stream }))(peer);
};

const _peer = (self, nsp, socketId) => {
  return self._nsps[nsp][socketId];
};

const _peerFromEnvelope = (self, envelope) => {
  if (!envelope || !envelope.namespace || !envelope.from) return null;
  return _peer(self, envelope.namespace, envelope.from);
};

const _peersOf = (self, nsp) => {
  return Object.values(self._nsps[nsp] || {});
};

const _oPeersOf = (self, nsp, peer) => {
  return _peersOf(self, nsp).filter((aPeer) => peer.socketId !== aPeer.socketId);
};

const _createNamespace = (self, envelope) => {
  self._nsps[envelope.namespace] = {};
};

const _addPeer = (self, envelope) => {
  const ipc = new RTCPeerConnection(self._peerConnectionConfiguration);
  const peer = {
    nsp: envelope.namespace,
    socketId: envelope.socketId,
    ipc,
    opcs: {},
    stream: new MediaStream([]),
  };
  ipc.addEventListener('connectionstatechange', _onConnectionStateChange.bind(null, self, peer, null));
  ipc.addEventListener('icecandidate', _onICECandidate.bind(null, self, peer, null));
  ipc.addEventListener('iceconnectionstatechange', _onICEConnectionStateChange.bind(null, self, peer, null));
  ipc.addEventListener('icegatheringstatechange', _onICEGatheringStateChange.bind(null, self, peer, null));
  ipc.addEventListener('signalingstatechange', _onSignalingStateChange.bind(null, self, peer, null));
  ipc.addEventListener('track', _onTrack.bind(null, self, peer));
  self._nsps[envelope.namespace][envelope.socketId] = peer;
  emitEvent(VieroWebRTCCommon.EVENT.PEER.DID_ENTER, { peer: _strippedPeer(peer) });
  return peer;
};

const _removePeer = (self, peer) => {
  peer.stream.getTracks().forEach((track) => track.stop());
  _oPeersOf(self, peer.nsp, peer).forEach((oPeer) => {
    const opc = oPeer.opcs[peer.socketId];
    if (opc) oPeer.opcs[peer.socketId].opc.close();
  });
  Object.values(peer.opcs).forEach((opc) => opc.close());
  peer.ipc.close();
  if (self._nsps[peer.nsp][peer.socketId]) delete self._nsps[peer.nsp][peer.socketId];
  self._signalingServer.close(peer.nsp, peer.socketId);
  emitEvent(VieroWebRTCCommon.EVENT.PEER.DID_LEAVE, { peer: _strippedPeer(peer) });
};

const _updatePeerConnectionsOnPeer = (self, peer) => {
  _oPeersOf(self, peer.nsp, peer).forEach((oPeer) => {
    _updatePeerConnectionOnPeer(self, peer, oPeer);
  });
}

const _updatePeerConnectionOnPeer = (self, peer, oPeer) => {
  const opc = new RTCPeerConnection(self._peerConnectionConfiguration);
  opc.addEventListener('connectionstatechange', _onConnectionStateChange.bind(null, self, peer, oPeer));
  opc.addEventListener('icecandidate', _onICECandidate.bind(null, self, peer, oPeer));
  opc.addEventListener('iceconnectionstatechange', _onICEConnectionStateChange.bind(null, self, peer, oPeer));
  opc.addEventListener('icegatheringstatechange', _onICEGatheringStateChange.bind(null, self, peer, oPeer));
  opc.addEventListener('signalingstatechange', _onSignalingStateChange.bind(null, self, peer, oPeer));
  peer.opcs[oPeer.socketId] = opc;
}

const _updateStreamsOnPeer = (self, peer) => {
  _oPeersOf(self, peer.nsp, peer).forEach((oPeer) => {
    _updateStreamOnPeer(self, peer, oPeer);
  });
};

const _updateStreamOnPeer = (self, peer, oPeer) => {
  const opc = peer.opcs[oPeer.socketId];
  const senders = opc.getSenders();
  if (senders.length) senders.forEach((sender) => opc.removeTrack(sender));
  if (!oPeer.stream) return Promise.resolve();
  oPeer.stream.getTracks().forEach((track) => opc.addTrack(track, oPeer.stream));
  return _onNegotiationNeeded(self, peer, oPeer);
};

class VieroWebRTCSFUServer {

  constructor(options) {
    options = options || {};
    this._peerConnectionConfiguration = options.peerConnectionConfiguration || _defaultPeerConnectionConfiguration;
    this._nsps = {};
  }

  run(server) {
    this._server = server;
    this._signalingServer = new VieroWebRTCSignalingServer();
    this._signalingServer.run(this._server, { bindAdminEndpoint: true, relayNonAddressed: false });

    onEvent(VieroWebRTCSignalingServer.EVENT.DID_CREATE_NAMESPACE, (envelope) => {
      _createNamespace(this, envelope);
    });

    onEvent(VieroWebRTCSignalingServer.EVENT.DID_ENTER_NAMESPACE, (envelope) => {
      const peer = _addPeer(this, envelope);

      // 1. make an opc on each existing peers on this peer
      _updatePeerConnectionsOnPeer(this, peer);

      // 2. route all existing incoming streams into the new opcs of this peer
      _updateStreamsOnPeer(this, peer);

      // 3. make an additional opc on each existing peers to this peer
      _oPeersOf(this, peer.nsp, peer).forEach((oPeer) => {
        _updatePeerConnectionOnPeer(this, oPeer, peer);
      });
    });

    onEvent(VieroWebRTCSignalingServer.EVENT.WILL_RELAY_ENVELOPE, (envelope) => {
      // messages not meant for us we ignore
      if (!envelope || envelope.to) return;
      _onMessage(this, envelope);
    });

    // we are not interested in events on our own send() calls
    // onEvent(VieroWebRTCSignalingServer.EVENT.WILL_DELIVER_ENVELOPE, (envelope) => {});

    onEvent(VieroWebRTCSignalingServer.EVENT.DID_LEAVE_NAMESPACE, (envelope) => {
      const peer = _peerFromEnvelope(this, envelope);
      if (peer) {
        _removePeer(this, peer);
      }
    });
  }
}

module.exports = {
  VieroWebRTCSFUServer,
};
