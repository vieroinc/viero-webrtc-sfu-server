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

const { VieroLog } = require('@viero/common/log');
const { VieroError } = require('@viero/common/error');
const { onEvent } = require('@viero/common-nodejs/event');
const { VieroHTTPServer } = require('@viero/common-nodejs/http');
const { bodyFilter } = require('@viero/common-nodejs/http/filters/ext/body');
const { VieroWebRTCSFUServer } = require('../');
const { VieroWebRTCSignalingServer } = require('@viero/webrtc-signaling-server');
const { VieroWebRTCCommon } = require('@viero/webrtc-common');

// const { VieroWebRTCCommon } = require('@viero/webrtc-common');

VieroLog.level = VieroLog.LEVEL.TRACE;

const log = new VieroLog('example');

const logRelayAndDelivery = (method, envelope) => {
  switch (envelope.payload.word) {
    case VieroWebRTCCommon.WORD.HELLO: {
      return log.info(`  ${method} ${envelope.namespace}`, 'HELLO to', envelope.to, envelope);
    }
    case VieroWebRTCCommon.WORD.SDP: {
      return log.info(`  ${method} ${envelope.namespace}`, `SDP ${envelope.payload.data.type}`, 'from', (envelope.from || '--'), 'to', (envelope.to || '--'));
    }
    case VieroWebRTCCommon.WORD.CDT: {
      return log.info(`  ${method} ${envelope.namespace}`, `CDT`, 'from', (envelope.from || '--'), 'to', (envelope.to || '--'));
    }
  }
};

onEvent(VieroWebRTCSignalingServer.EVENT.DID_CREATE_NAMESPACE, (envelope) => {
  log.info('+ NSP', envelope.namespace);
});
onEvent(VieroWebRTCSignalingServer.EVENT.DID_ENTER_NAMESPACE, (envelope) => {
  log.info('+ PEER', envelope.namespace, envelope.socketId);
});
onEvent(VieroWebRTCSignalingServer.EVENT.WILL_RELAY_ENVELOPE, (envelope) => logRelayAndDelivery('RELAY', envelope));
onEvent(VieroWebRTCSignalingServer.EVENT.WILL_DELIVER_ENVELOPE, (envelope) => logRelayAndDelivery('DELIVER', envelope));
onEvent(VieroWebRTCSignalingServer.EVENT.DID_LEAVE_NAMESPACE, (envelope) => {
  log.info('- PEER', envelope.namespace, envelope.socketId);
});
onEvent(VieroWebRTCCommon.EVENT.ERROR, (err) => {
  log.error('! ERROR', err);
})

const server = new VieroHTTPServer();
const sfuServer = new VieroWebRTCSFUServer();
server.setCORSOptions({ origins: ['http://localhost:8080'], headers: ['content-type'] });
server.registerFilter(bodyFilter, 'The body filter.');
server.run({ port: 8090 }).then(() => {
  sfuServer.run(server, { bindAdminEndpoint: true });
}).catch((err) => {
  log.error(err.userData[VieroError.KEY.ERROR].toString());
});
