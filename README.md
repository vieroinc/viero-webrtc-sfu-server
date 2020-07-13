# @viero/webrtc-sfu-server

WebRTC SFU server library by @vieroinc.

To see how viero's webrtc-sfu works either visit http://client.vcdemo.viero.tv or clone the example code from [viero-webrtc-sfu-example](https://github.com/vieroinc/viero-webrtc-sfu-example) on GitHub locally.

## How to

### Install

```bash
npm install --save @viero/common-nodejs
npm install --save @viero/webrtc-signaling-server
npm install --save @viero/webrtc-sfu-server
```

### Use

```js
const { VieroHTTPServer } = require("@viero/common-nodejs/http");
const { bodyFilter } = require("@viero/common-nodejs/http/filters/ext/body");
const { VieroWebRTCSFUServer } = require("@viero/webrtc-sfu-server");
const {
  VieroWebRTCSignalingServer,
} = require("@viero/webrtc-signaling-server");

const httpServer = new VieroHTTPServer();
const signalingServer = new VieroWebRTCSignalingServer();
const sfuServer = new VieroWebRTCSFUServer();

httpServer.setCORSOptions({
  origins: ["http://localhost:8080"],
  headers: ["content-type"],
});
httpServer.registerFilter(bodyFilter, "bodyFilter");
httpServer
  .run({ port: 8090 })
  .then(() => sfuServer.run(httpServer, signalingServer))
  .catch((err) => console.error(err));
```

### Details

`VieroWebRTCSFUServer` needs `VieroWebRTCSignalingServer` to run and `VieroWebRTCSignalingServer` needs `VieroHTTPServer` to run. `VieroWebRTCSignalingServer` **doesn't yet support** commonly used HTTP servers eg. **express** or **koa**.

Prior calling `run()` on your `VieroWebRTCSFUServer` instance, the `VieroHTTPServer` instance must be set up to use the provided `bodyFilter` and to respond with proper _CORS_ headers.
