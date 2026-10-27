# Prototype contract

Temporary technical name only. Android+iOS messenger; Russian networks are the target.
No bots, channels or backups. This milestone is a foreground 1:1 technical prototype,
not production messaging. No promises of DPI invisibility, reliable background wake,
offline delivery, a ratchet or a completed security audit.

## Workspaces and ownership

- packages/core: platform-neutral TypeScript, Zod wire schemas, authenticated encryption
  of signaling using an out-of-band random 32-byte invitation secret, WebRTC session,
  bounded data-channel chat/files and media negotiation; core agent owns this directory.
- apps/server: Node TypeScript/ws signaling; infra/: TURN local test deployment;
  server agent owns those directories.
- apps/mobile: Expo development build + react-native-webrtc, Russian UI;
  mobile agent owns this directory.
- apps/probe: Vite browser diagnostic client importing the SAME core. Main owns it,
  root configs, docs, end-to-end tests, integration and final verification.

No agent should edit another owner's files or root lockfiles. Main installs dependencies.

## Wire protocol (freeze these names)

WS /signal, max message 96 KiB, no compression, rooms have at most two peers.
Identifiers are lowercase hex: roomId=SHA256(invitation secret) (64 chars),
peerId=random 16 bytes (32 chars). Invitation itself is 64 lowercase hex chars.
Never send the invitation to the server, in a URL query, or log it.

Client frames:
- {type:'join', roomId:string, peerId:string}
- {type:'signal', payload:{version:1, nonce:string, ciphertext:string}}
- {type:'leave'}

Server frames:
- {type:'joined', roomId:string, peerId:string, role:'initiator'|'responder', peerPresent:boolean}
- {type:'peer-joined', peerId:string}
- {type:'peer-left', peerId:string}
- {type:'signal', from:string, payload:{version:1, nonce:string, ciphertext:string}}
- {type:'error', code:string, message:string}

SealedEnvelope has nonce/ciphertext hex. Server validates shape/size, never decrypts.
Server broadcasts presence only to the other occupant; first participant is initiator.
No arbitrary HTTP mailbox. GET /health -> {status:'ok'}, GET /ice -> {iceServers:RTCIceServer[]}.
GET /ice uses TURN REST short-lived credentials if configured, empty servers otherwise.
Server binds 127.0.0.1:8787 by default; explicit HOST for LAN. Origin policy configurable.

## Core public API (freeze these names)

Exports: createInvite(randomBytes?), roomIdFromInvite(invite), clientFrameSchema,
serverFrameSchema, sealedEnvelopeSchema, PeerSession and associated public types.

PeerSession constructor options:
- serverUrl: base http(s) URL; derives ws(s) /signal and GET /ice
- invite: 64-char hex secret from another trusted channel
- relayOnly?: boolean, iceServers?: RTCIceServer[]
- randomBytes?: (length:number)=>Uint8Array (mobile passes Expo Crypto)
- rtcFactory?: (config:RTCConfiguration)=>RTCPeerConnection
- getUserMedia?: (constraints:MediaStreamConstraints)=>Promise<MediaStream>
- onChange?: (snapshot:SessionSnapshot)=>void

Methods: connect():Promise<void>, disconnect():void, sendText(text):Promise<void>,
startCall(video?:boolean):Promise<void>, acceptCall():Promise<void>, rejectCall():void,
endCall():void, setMuted(muted:boolean):void,
sendFile(file:{name:string,mime:string,data:Uint8Array}):Promise<void>,
getSnapshot():SessionSnapshot.

SessionSnapshot:
- status: 'idle'|'connecting'|'waiting'|'connected'|'disconnected'|'error'
- error?:string
- messages: {id:string,text:string,from:'self'|'peer',timestamp:number}[]
- callState: 'idle'|'outgoing'|'incoming'|'active'
- muted:boolean, localStream?:MediaStream, remoteStream?:MediaStream
- route:'unknown'|'direct'|'relay'
- stats:{rttMs?:number,audioBitrateKbps?:number,packetsLost?:number,jitterMs?:number}
- files:{id:string,name:string,mime:string,size:number,from:'self'|'peer',
  status:'sending'|'receiving'|'complete'|'error',receivedBytes:number,data?:Uint8Array}[]

Constraints: text <=4000 chars, files <=5 MiB/chunks <=12 KiB/buffer backpressure.
No durable history or outbox yet; never mark undelivered data as delivered.
Reject tampered/wrong-secret signaling, bind authenticated payload to room+sender,
bound replay state and retained payload memory, serialize WebRTC mutations,
handle reconnect/disconnect and stop microphone/camera tracks on hangup.
Relay-only fails explicitly without TURN, never silently changes to direct.
Adaptive audio policy should use measured loss/RTT, bounded bitrate and no SDP munging
unless needed for supported Opus codec negotiation. Clearly state unsupported APIs.

## Validation

Core: crypto tamper/wrong-secret/replay tests, bounds, audio policy tests.
Server: real WebSocket two-peer exchange, room-full, isolation, malformed/rate limits,
disconnect cleanup and empty ICE configuration.
Integration: two real Chromium contexts using the same core, chat, file bytes,
fake-media call start/accept/hangup, route diagnostics and relay-only failure.
Mobile: typecheck + Expo native prebuild; Android debug APK if SDK/toolchain available.
iOS source/bundle validation; native build requires full Xcode (currently absent).
