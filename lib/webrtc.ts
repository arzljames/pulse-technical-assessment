export type DescType = "offer" | "answer" | "ice";
export type PeerControl =
  | "video-request"
  | "video-accept"
  | "video-decline"
  | "video-end"
  | "typing"; // ephemeral "stranger is typing" hint, never displayed as text

const CONTROLS: readonly string[] = [
  "video-request",
  "video-accept",
  "video-decline",
  "video-end",
  "typing",
] satisfies PeerControl[];

// Limits on what the other browser can send us (S6). Data channel messages
// skip the server entirely, so the receiving client is the only place to
// enforce them.
export const MAX_CHAT_CHARS = 2000; // same as the composer's maxLength
const MAX_MESSAGE_BYTES = 8 * 1024; // a chat message is at most ~8 KB of JSON
// Chat flood guard: at most this many chat messages per window; the rest are
// dropped. (Reveal and control messages only update state, latest wins, so
// they aren't counted: a fast reveal-slider drag must not lose its last value.)
const FLOOD_MAX = 30;
const FLOOD_WINDOW_MS = 5_000;

interface PeerCallbacks {
  onSignal: (type: DescType, payload: string) => void;
  onChat: (text: string) => void;
  onControl: (ctrl: PeerControl) => void;
  // Safe Reveal: how much of their video the peer agrees to show, 0–1.
  onReveal: (level: number) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
  // The remote side went away (tab closed, crashed, or hung up).
  onChannelClose: () => void;
  // SDP negotiation failed (couldn't apply or create an offer/answer).
  onError: (err: unknown) => void;
}

// Reveal levels come from the other browser, so never trust them: drop
// NaN/Infinity and clamp the rest into 0–1.
function clampLevel(level: number): number | null {
  if (!Number.isFinite(level)) return null;
  return Math.min(1, Math.max(0, level));
}

// Fallback when /api/ice couldn't be reached: STUN only (direct connection).
export const DEFAULT_ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export class PeerSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private localStream: MediaStream | null = null;
  private closed = false;
  private readonly cb: PeerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private recentMessages: number[] = [];

  // `config` comes from /api/ice. With iceTransportPolicy "relay" only TURN
  // candidates are gathered, so the peer never learns our public IP.
  constructor(initiator: boolean, cb: PeerCallbacks, config: RTCConfiguration = DEFAULT_ICE) {
    this.cb = cb;
    this.polite = !initiator;
    this.pc = new RTCPeerConnection(config);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.cb.onSignal("ice", JSON.stringify(candidate));
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.cb.onSignal("offer", JSON.stringify(this.pc.localDescription));
        }
      } catch (err) {
        if (!this.closed) this.cb.onError(err);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.ontrack = ({ streams }) => {
      this.cb.onRemoteStream(streams[0] ?? null);
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState(this.pc.connectionState);
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel("chat");
      this.wireDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.wireDataChannel(this.dc);
      };
    }
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => this.cb.onChannelOpen();
    // Only report closes we didn't cause ourselves via close().
    dc.onclose = () => {
      if (!this.closed) this.cb.onChannelClose();
    };
    dc.onmessage = (e) => {
      // Text frames only, and small enough to be one of ours.
      if (typeof e.data !== "string" || e.data.length > MAX_MESSAGE_BYTES) return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.t === "chat" && typeof msg.text === "string") {
          if (this.flooding()) return;
          const text = msg.text.trim();
          if (text && text.length <= MAX_CHAT_CHARS) this.cb.onChat(text);
        } else if (msg.t === "ctrl" && CONTROLS.includes(msg.ctrl)) {
          this.cb.onControl(msg.ctrl as PeerControl);
        } else if (msg.t === "reveal" && typeof msg.level === "number") {
          const level = clampLevel(msg.level);
          if (level !== null) this.cb.onReveal(level);
        }
      } catch {}
    };
  }

  // True when the peer has sent more than FLOOD_MAX chat messages in the last
  // FLOOD_WINDOW_MS (this one included).
  private flooding(): boolean {
    const now = Date.now();
    this.recentMessages = this.recentMessages.filter((t) => now - t < FLOOD_WINDOW_MS);
    this.recentMessages.push(now);
    return this.recentMessages.length > FLOOD_MAX;
  }

  // Never rejects: malformed payloads and individual ICE failures are logged
  // and dropped (recoverable); SDP failures are reported via onError.
  async handleSignal(type: DescType, payload: string) {
    if (this.closed) return;

    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      console.warn(`[webrtc] dropping malformed ${type} payload`);
      return;
    }

    if (type === "ice") {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(data as RTCIceCandidateInit);
        return;
      }
      await this.addCandidate(data as RTCIceCandidateInit);
      return;
    }

    try {
      const desc = data as RTCSessionDescriptionInit;
      const offerCollision =
        desc.type === "offer" &&
        (this.makingOffer || this.pc.signalingState !== "stable");
      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      await this.pc.setRemoteDescription(desc);
      // Candidates can only be applied once a remote description exists.
      await this.flushPendingCandidates();
      if (desc.type === "offer") {
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.cb.onSignal("answer", JSON.stringify(this.pc.localDescription));
        }
      }
    } catch (err) {
      if (!this.closed) this.cb.onError(err);
    }
  }

  private async flushPendingCandidates() {
    if (this.pendingCandidates.length === 0) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) await this.addCandidate(candidate);
  }

  // One bad candidate isn't fatal — ICE can still succeed with the others.
  // Errors are expected (and silent) for candidates of an offer we ignored.
  private async addCandidate(candidate: RTCIceCandidateInit) {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!this.ignoreOffer && !this.closed) {
        console.warn("[webrtc] failed to add ICE candidate", err);
      }
    }
  }

  sendChat(text: string) {
    this.safeSend({ t: "chat", text });
  }

  sendControl(ctrl: PeerControl) {
    this.safeSend({ t: "ctrl", ctrl });
  }

  sendReveal(level: number) {
    const clamped = clampLevel(level);
    if (clamped !== null) this.safeSend({ t: "reveal", level: clamped });
  }

  private safeSend(obj: unknown) {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(obj));
    }
  }

  // Attach camera + mic to the call. Pass `existing` to reuse a stream the
  // caller already opened (e.g. the pre-accept self-preview) instead of
  // prompting for the camera again.
  async startVideo(existing?: MediaStream): Promise<MediaStream> {
    if (!this.localStream) {
      this.localStream =
        existing ??
        (await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        }));
      for (const track of this.localStream.getTracks()) {
        this.pc.addTrack(track, this.localStream);
      }
    }
    return this.localStream;
  }

  stopVideo() {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      for (const sender of this.pc.getSenders()) {
        if (sender.track) {
          try {
            this.pc.removeTrack(sender);
          } catch {}
        }
      }
      this.localStream = null;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopVideo();
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
    }
    try {
      this.pc.close();
    } catch {}
  }
}
