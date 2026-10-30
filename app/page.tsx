"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import RequestModal from "./components/RequestModal";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import { IncomingVideoCard, OutgoingVideoCard } from "./components/VideoRequestCard";
import VideoPanel from "./components/VideoPanel";
import HiddenBanner from "./components/HiddenBanner";
import StatsPanel from "./components/StatsPanel";
import {
  createSession,
  join,
  leave,
  poll,
  sendSignal,
  UnauthorizedError,
  type Session,
} from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { distanceKm, formatDistance } from "@/lib/geo";
import { formatCityCountry, formatNear, reverseGeocode, type Place } from "@/lib/geocode";
import { type PeerDot, type SignalMsg } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

// How a request ended, shown as a card until dismissed. `peer` is a snapshot
// so the card can still show location/distance if they've since left.
type Outcome = {
  kind: "timeout" | "declined" | "expired";
  peerId: string;
  peer: PeerDot | null;
};

const REQUEST_TIMEOUT_MS = 30_000;
// The receiver auto-declines a little before the sender gives up, so the
// sender learns "timed out" from the decline instead of racing its own timer
// (signals take up to one poll interval to arrive).
const INCOMING_TIMEOUT_MS = REQUEST_TIMEOUT_MS - 2_000;
// Max time from accept until the data channel opens. Covers a lost or
// ignored accept, a peer that vanished mid-handshake, and stalled ICE.
const CONNECT_TIMEOUT_MS = 20_000;
// Hide the typing indicator if no new "typing" ping arrives within this.
const TYPING_HIDE_MS = 3_500;
// How long a video request waits for an answer (both sides).
const VIDEO_REQUEST_TIMEOUT_MS = 30_000;
// Payload on a "decline" that means "nobody answered", not "they said no".
const DECLINE_TIMEOUT = "timeout";
// Retry interval while the server can't start a session for us.
const SESSION_RETRY_MS = 3_000;
// After a panic, the earliest we reappear on the map is a random 30–90 s
// later, so the blocked stranger can't link the new dot to the old one.
const PANIC_HIDE_MIN_MS = 30_000;
const PANIC_HIDE_JITTER_MS = 60_000;

// Off the map after a panic. `rejoinAt` is set once the user asks to come
// back; it's never earlier than `earliest`.
type Hidden = { earliest: number; rejoinAt: number | null };

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  // Server-issued session (S1): public id + secret token, memory only. Null
  // until the server hands one out, and again right after a panic (which
  // asks for a fresh one so a blocked stranger can't find us again).
  const [session, setSession] = useState<Session | null>(null);
  const token = session?.token ?? "";
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  // Geocoded place, tagged with the coordinates it belongs to so a stale
  // lookup for a previous peer is never shown for the current one.
  const [place, setPlace] = useState<{ key: string; place: Place | null } | null>(
    null,
  );
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [requestDeadline, setRequestDeadline] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const [videoDeadline, setVideoDeadline] = useState<number | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  // Safe Reveal levels (0 = fully blurred, 1 = clear). Both start blurred and
  // return to 0 whenever a call ends, never on start: the peer may already
  // have revealed before our own start lands.
  const [myReveal, setMyReveal] = useState(0);
  const [peerReveal, setPeerReveal] = useState(0);
  // Strangers blocked with the panic button, for the rest of this tab's life.
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(() => new Set());
  const blockedRef = useRef(blocked);

  const [hidden, _setHidden] = useState<Hidden | null>(null);
  const hiddenRef = useRef<Hidden | null>(hidden);
  const setHidden = (h: Hidden | null) => {
    hiddenRef.current = h;
    _setHidden(h);
  };
  const rejoinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const peerRef = useRef<PeerSession | null>(null);
  // Raw location, kept client-side only so we can re-join if our presence
  // row is reaped. Never sent anywhere except /api/join.
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Camera opened for the pre-accept self-preview, not yet attached to the
  // peer connection. Handed to PeerSession on accept, stopped otherwise.
  const previewRef = useRef<MediaStream | null>(null);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [
      ...prev,
      { id: msgId.current++, mine, text, at: Date.now() },
    ]);
  }

  // Centered event line in the chat, e.g. "Video call started · 7:04 AM".
  function addSystemMessage(text: string) {
    setMessages((prev) => [
      ...prev,
      { id: msgId.current++, mine: false, text, at: Date.now(), system: true },
    ]);
  }

  function callStarted() {
    setVideo("active");
    setCallStartedAt(Date.now());
    addSystemMessage("Video call started");
  }

  // Called before the video state is reset, by whichever side hangs up.
  function callEnded() {
    if (videoRef.current === "active") addSystemMessage("Video call ended");
    setCallStartedAt(null);
  }

  function setTyping(on: boolean) {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setPeerTyping(on);
    if (on) {
      typingTimer.current = setTimeout(() => setPeerTyping(false), TYPING_HIDE_MS);
    }
  }

  function clearTimer(ref: React.RefObject<ReturnType<typeof setTimeout> | null>) {
    if (ref.current) clearTimeout(ref.current);
    ref.current = null;
  }

  // Everyone on the map except strangers we've blocked.
  const visiblePeers = peers.filter((p) => !blocked.has(p.id));

  function dotFor(peerId: string): PeerDot | null {
    return visiblePeers.find((p) => p.id === peerId) ?? null;
  }

  function resetReveal() {
    setMyReveal(0);
    setPeerReveal(0);
  }

  function changeReveal(level: number) {
    setMyReveal(level);
    peerRef.current?.sendReveal(level);
  }

  function stopPreview() {
    previewRef.current?.getTracks().forEach((t) => t.stop());
    previewRef.current = null;
  }

  function teardown(message?: string) {
    clearTimer(requestTimer);
    clearTimer(incomingTimer);
    clearTimer(connectTimer);
    clearTimer(videoTimer);
    stopPreview();
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setVideoDeadline(null);
    setCallStartedAt(null);
    resetReveal();
    setRequestDeadline(null);
    setMessages([]);
    setTyping(false);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  // Give up if we're still "connecting" to this peer after CONNECT_TIMEOUT_MS.
  function startConnectTimeout(peerId: string) {
    clearTimer(connectTimer);
    connectTimer.current = setTimeout(() => {
      const c = connRef.current;
      if (c.kind === "connecting" && c.peerId === peerId) {
        void sendSignal(token, peerId, "end");
        teardown("Couldn't connect.");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(token, peerId, type, payload);
      },
      onChat: (text) => {
        setTyping(false);
        addMessage(false, text);
      },
      onControl: (ctrl) => handleControl(ctrl),
      onReveal: (level) => setPeerReveal(level),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed") {
          // Tell the server so both peers' busy flags are cleared.
          void sendSignal(token, peerId, "end");
          teardown("Connection failed (network).");
        }
      },
      onChannelOpen: () => {
        clearTimer(connectTimer);
        setConn({ kind: "connected", peerId });
      },
      onChannelClose: () => {
        // The peer vanished without us getting an "end" signal (tab closed,
        // crash, network drop). Send "end" ourselves so the server frees our
        // busy flag even if their leave beacon never arrived.
        void sendSignal(token, peerId, "end");
        teardown("Stranger disconnected.");
      },
      onError: (err) => {
        console.error("[webrtc] negotiation failed", err);
        if (connRef.current.kind === "connecting") {
          // The initial handshake can't complete — fail fast instead of
          // waiting out the connect timeout.
          void sendSignal(token, peerId, "end");
          teardown("Couldn't connect.");
        } else if (videoRef.current !== "none") {
          // A renegotiation for video failed. The chat channel is already up
          // and unaffected, so drop back to text chat rather than ending it.
          endVideo();
          showNotice("Video couldn't start.");
        }
      },
    });
    peerRef.current = ps;
  }

  // ── Video ────────────────────────────────────────────────────────────────

  // Back to text chat from a pending (not yet active) video request.
  function resetVideoRequest() {
    clearTimer(videoTimer);
    setVideoDeadline(null);
    stopPreview();
    setLocalStream(null);
    setVideo("none");
    resetReveal();
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "typing":
        setTyping(true);
        break;
      case "video-request":
        if (videoRef.current === "none") {
          setVideo("incoming");
          setVideoDeadline(Date.now() + VIDEO_REQUEST_TIMEOUT_MS);
          clearTimer(videoTimer);
          videoTimer.current = setTimeout(() => {
            if (videoRef.current === "incoming") {
              peerRef.current?.sendControl("video-decline");
              resetVideoRequest();
              showNotice("Missed video request.");
            }
          }, VIDEO_REQUEST_TIMEOUT_MS);
        }
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          clearTimer(videoTimer);
          setVideoDeadline(null);
          // Reuse the preview stream — no second camera prompt.
          const preview = previewRef.current ?? undefined;
          previewRef.current = null;
          ps.startVideo(preview)
            .then((stream) => {
              setLocalStream(stream);
              callStarted();
            })
            .catch(() => {
              resetVideoRequest();
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          resetVideoRequest();
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        // Covers both "they cancelled their request" and "they hung up".
        callEnded();
        resetVideoRequest();
        ps?.stopVideo();
        setRemoteStream(null);
        break;
    }
  }

  async function startVideoRequest() {
    const ps = peerRef.current;
    if (videoRef.current !== "none" || !ps) return;
    // Mark busy before the async camera prompt so a double-click can't fire
    // two requests.
    setVideo("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      setVideo("none");
      showNotice("Camera unavailable.");
      return;
    }
    // The chat may have ended (or been replaced) while the prompt was open.
    // (Cast: TS narrowed videoRef.current to "none" above and can't see the
    // setVideo/await in between.)
    if (peerRef.current !== ps || (videoRef.current as VideoState) !== "requesting") {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    previewRef.current = stream;
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(true);
    setVideoDeadline(Date.now() + VIDEO_REQUEST_TIMEOUT_MS);
    ps.sendControl("video-request");
    clearTimer(videoTimer);
    videoTimer.current = setTimeout(() => {
      if (videoRef.current === "requesting") {
        peerRef.current?.sendControl("video-end");
        resetVideoRequest();
        showNotice("No answer to video.");
      }
    }, VIDEO_REQUEST_TIMEOUT_MS);
  }

  function cancelVideoRequest() {
    if (videoRef.current !== "requesting") return;
    peerRef.current?.sendControl("video-end");
    resetVideoRequest();
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps || videoRef.current !== "incoming") return;
    clearTimer(videoTimer);
    setVideoDeadline(null);
    setMicOn(true);
    setCamOn(true);
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        callStarted();
      })
      .catch(() => {
        ps.sendControl("video-decline");
        resetVideoRequest();
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    resetVideoRequest();
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    callEnded();
    resetVideoRequest();
    setRemoteStream(null);
  }

  function setTrackEnabled(kind: "audio" | "video", on: boolean) {
    localStream?.getTracks().forEach((t) => {
      if (t.kind === kind) t.enabled = on;
    });
  }

  function toggleMic() {
    setTrackEnabled("audio", !micOn);
    setMicOn(!micOn);
  }

  function toggleCam() {
    setTrackEnabled("video", !camOn);
    setCamOn(!camOn);
  }

  // ── Connection requests ──────────────────────────────────────────────────

  function requestConnection(peerId: string) {
    // While hidden we have no presence row, so nobody could answer back.
    if (connRef.current.kind !== "idle" || hiddenRef.current) return;
    setOutcome(null);
    setConn({ kind: "requesting", peerId });
    setRequestDeadline(Date.now() + REQUEST_TIMEOUT_MS);
    void sendSignal(token, peerId, "request").then((status) => {
      // Too many requests: the server never delivered it, so don't sit on
      // "Waiting…" for 30 s.
      const c = connRef.current;
      if (status === 429 && c.kind === "requesting" && c.peerId === peerId) {
        teardown("Too many requests. Wait a minute and try again.");
      }
    }, () => {});
    const snapshot = dotFor(peerId);
    clearTimer(requestTimer);
    requestTimer.current = setTimeout(() => {
      const c = connRef.current;
      if (c.kind === "requesting" && c.peerId === peerId) {
        void sendSignal(token, peerId, "end");
        teardown();
        setOutcome({ kind: "timeout", peerId, peer: snapshot });
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(token, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    clearTimer(incomingTimer);
    setRequestDeadline(null);
    startPeer(peerId, false);
    void sendSignal(token, peerId, "accept");
    setConn({ kind: "connecting", peerId });
    startConnectTimeout(peerId);
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    clearTimer(incomingTimer);
    setRequestDeadline(null);
    void sendSignal(token, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  // Resolves once the server has processed the "end" (and freed us).
  function endConnection(): Promise<void> {
    const c = connRef.current;
    const ended =
      c.kind === "connecting" || c.kind === "connected"
        ? sendSignal(token, c.peerId, "end").then(
            () => {},
            () => {},
          )
        : Promise.resolve();
    teardown();
    return ended;
  }

  // A random stranger who's free, other than `exclude`.
  function pickRandomPeer(exclude: string | null): PeerDot | null {
    const candidates = visiblePeers.filter((p) => !p.busy && p.id !== exclude);
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function requestRandom(exclude: string | null) {
    const next = pickRandomPeer(exclude);
    if (!next) {
      setOutcome(null);
      showNotice("No one else is free right now.");
      return;
    }
    requestConnection(next.id);
  }

  // End the current chat and immediately request a random available stranger.
  function skipToNext() {
    const c = connRef.current;
    const current = c.kind === "idle" ? null : c.peerId;
    // The server only accepts a request from a free session, so wait for the
    // "end" to land before sending it.
    void endConnection().then(() => {
      if (connRef.current.kind === "idle") requestRandom(current);
    });
  }

  // Panic button: end everything, block this stranger, and go off the map
  // under a new session id. The old id disappears, so the stranger can't
  // re-request us, and their dot is hidden from our map. We only reappear
  // (with a freshly offset dot) when the user chooses, after a random delay.
  function panic() {
    const c = connRef.current;
    const peerId = c.kind === "idle" ? undefined : c.peerId;
    if (peerId) {
      const next = new Set(blockedRef.current).add(peerId);
      blockedRef.current = next;
      setBlocked(next);
    }
    // Deletes our presence row and ends the chat for the stranger.
    leave(token);
    teardown("Stranger blocked.");
    setOutcome(null);
    setPeers([]);
    // A new identity is minted by the session effect below.
    setSession(null);
    clearTimer(rejoinTimer);
    setHidden({
      earliest: Date.now() + PANIC_HIDE_MIN_MS + Math.random() * PANIC_HIDE_JITTER_MS,
      rejoinAt: null,
    });
  }

  function goVisible() {
    const h = hiddenRef.current;
    if (!h || h.rejoinAt !== null) return;
    const at = Math.max(Date.now(), h.earliest);
    setHidden({ ...h, rejoinAt: at });
    clearTimer(rejoinTimer);
    // Clearing `hidden` is enough: the next poll sees joined=false for the
    // new id and joins with a fresh privacy offset.
    rejoinTimer.current = setTimeout(() => setHidden(null), at - Date.now());
  }

  function stayHidden() {
    const h = hiddenRef.current;
    if (!h) return;
    clearTimer(rejoinTimer);
    setHidden({ ...h, rejoinAt: null });
  }

  function retryOutcome() {
    if (!outcome) return;
    const p = dotFor(outcome.peerId);
    if (!p) {
      setOutcome(null);
      showNotice("They're no longer online.");
    } else if (p.busy) {
      setOutcome(null);
      showNotice("They're in another conversation.");
    } else {
      requestConnection(p.id);
    }
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (blockedRef.current.has(sig.fromId)) {
          void sendSignal(token, sig.fromId, "decline");
        } else if (connRef.current.kind === "idle") {
          const peerId = sig.fromId;
          setOutcome(null);
          setConn({ kind: "incoming", peerId });
          setRequestDeadline(Date.now() + INCOMING_TIMEOUT_MS);
          const snapshot = dotFor(peerId);
          clearTimer(incomingTimer);
          incomingTimer.current = setTimeout(() => {
            const c = connRef.current;
            if (c.kind === "incoming" && c.peerId === peerId) {
              void sendSignal(token, peerId, "decline", DECLINE_TIMEOUT);
              setRequestDeadline(null);
              setConn({ kind: "idle" });
              setOutcome({ kind: "expired", peerId, peer: snapshot });
            }
          }, INCOMING_TIMEOUT_MS);
        } else {
          void sendSignal(token, sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          clearTimer(requestTimer);
          setRequestDeadline(null);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
          startConnectTimeout(sig.fromId);
        } else if (c.kind === "idle" || c.peerId !== sig.fromId) {
          // An accept we're no longer waiting for (we cancelled or timed out
          // as they accepted). Tell them, so they don't sit on "Connecting…"
          // and the server frees their busy flag.
          void sendSignal(token, sig.fromId, "end");
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          const snapshot = dotFor(sig.fromId);
          teardown();
          setOutcome({
            kind: sig.payload === DECLINE_TIMEOUT ? "timeout" : "declined",
            peerId: sig.fromId,
            peer: snapshot,
          });
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (c.kind !== "idle" && c.peerId === sig.fromId) {
          if (c.kind === "incoming") {
            clearTimer(incomingTimer);
            setRequestDeadline(null);
            setConn({ kind: "idle" });
            showNotice("They withdrew the request.");
          } else if (c.kind === "requesting") teardown("Stranger left.");
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  // Get a session from the server once we're live (and again after a panic
  // or a rejected token), retrying until it works.
  useEffect(() => {
    if (phase !== "live" || session) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      try {
        const s = await createSession();
        if (active) setSession(s);
      } catch {
        if (active) timer = setTimeout(attempt, SESSION_RETRY_MS);
      }
    };
    void attempt();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, session]);

  useEffect(() => {
    if (phase !== "live" || !token) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(token);
        if (!active) return;
        // No presence row yet (new session) or it's gone (throttled
        // background tab, bfcache restore) — put ourselves on the map.
        // (Not while hidden after a panic: staying off the map is the point.)
        if (!data.joined && locationRef.current && !hiddenRef.current) {
          const { lat, lng } = locationRef.current;
          await join(token, lat, lng);
        }
        setPeers(data.peers);
        for (const s of data.signals) processSignalRef.current(s);
      } catch (err) {
        // Token rejected (e.g. the server's secret changed): start over with
        // a new session. Anything else is transient; just poll again.
        if (err instanceof UnauthorizedError && active) {
          setSession(null);
          return;
        }
      }
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, token]);

  useEffect(() => {
    if (!token || phase !== "live") return;
    // pagehide covers tab close, reload and navigation on every browser.
    // (beforeunload is redundant and can make the page bfcache-ineligible.)
    const onLeave = (e: PageTransitionEvent) => {
      // Going into the back/forward cache, not unloading: keep the session.
      // If it's restored after STALE_MS, the next poll re-joins.
      if (e.persisted) return;
      leave(token);
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
    };
  }, [token, phase]);

  // The stranger currently in focus (request, chat, or a finished request's
  // card) — drives the location and distance shown in the UI.
  const focusPeerId = conn.kind !== "idle" ? conn.peerId : (outcome?.peerId ?? null);
  const focusDot = focusPeerId
    ? (visiblePeers.find((p) => p.id === focusPeerId) ??
      (outcome?.peerId === focusPeerId ? outcome.peer : null))
    : null;
  const focusLat = focusDot?.lat;
  const focusLng = focusDot?.lng;
  const placeKey =
    focusLat !== undefined && focusLng !== undefined
      ? `${focusLat},${focusLng}`
      : null;

  useEffect(() => {
    if (focusLat === undefined || focusLng === undefined) return;
    const key = `${focusLat},${focusLng}`;
    let cancelled = false;
    void reverseGeocode(focusLat, focusLng).then((p) => {
      if (!cancelled) setPlace({ key, place: p });
    });
    return () => {
      cancelled = true;
    };
  }, [focusLat, focusLng]);

  // Location granted: go live. The session effect then gets a token, and the
  // first poll (joined=false) puts us on the map.
  function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    locationRef.current = { lat, lng };
    setPhase("live");
  }

  if (phase === "gate") {
    return <EntryGate onReady={handleReady} />;
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const focusPlace = place && place.key === placeKey ? place.place : null;
  const km = focusDot && myLocation ? distanceKm(myLocation, focusDot) : null;
  const modalInfo = {
    location: focusPlace ? formatNear(focusPlace) : null,
    distance: km !== null ? formatDistance(km) : null,
    distanceKmValue: km,
    totalMs: REQUEST_TIMEOUT_MS,
  };

  return (
    <main className="fixed inset-0 overflow-hidden">
      <WorldMap
        peers={visiblePeers}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={conn.kind === "idle" && !hidden}
      />

      {/* Hidden during a video call, whose stage covers the map. */}
      {video !== "active" && (
        <StatsPanel
          peers={visiblePeers}
          me={myLocation}
          canConnect={conn.kind === "idle" && !hidden}
          onConnect={requestConnection}
        />
      )}

      {hidden && conn.kind === "idle" && (
        <HiddenBanner
          rejoinAt={hidden.rejoinAt}
          onGoVisible={goVisible}
          onStayHidden={stayHidden}
        />
      )}

      {notice && (
        <div
          role="status"
          className="absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full border border-line bg-surface/90 px-4 py-2 text-sm text-zinc-100 shadow-lg backdrop-blur"
        >
          {notice}
        </div>
      )}

      {conn.kind === "requesting" && (
        <RequestModal
          kind="outgoing"
          {...modalInfo}
          deadline={requestDeadline}
          onSecondary={cancelRequest}
        />
      )}

      {conn.kind === "incoming" && (
        <RequestModal
          kind="incoming"
          {...modalInfo}
          totalMs={INCOMING_TIMEOUT_MS}
          deadline={requestDeadline}
          onPrimary={acceptIncoming}
          onSecondary={declineIncoming}
        />
      )}

      {conn.kind === "idle" && outcome && (
        <RequestModal
          kind={outcome.kind}
          {...modalInfo}
          deadline={null}
          onPrimary={
            outcome.kind === "timeout"
              ? retryOutcome
              : outcome.kind === "declined"
                ? () => requestRandom(outcome.peerId)
                : undefined
          }
          onSecondary={() => setOutcome(null)}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          peerPlace={focusPlace ? formatCityCountry(focusPlace) : null}
          peerTyping={peerTyping}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onTyping={() => peerRef.current?.sendControl("typing")}
          onStartVideo={() => void startVideoRequest()}
          onEnd={endConnection}
          onSkip={skipToNext}
          onPanic={panic}
          inCall={video === "active"}
          videoSlot={
            video === "incoming" && videoDeadline ? (
              <IncomingVideoCard
                deadline={videoDeadline}
                totalMs={VIDEO_REQUEST_TIMEOUT_MS}
                onAccept={acceptVideo}
                onDecline={declineVideo}
              />
            ) : video === "requesting" && videoDeadline ? (
              <OutgoingVideoCard
                deadline={videoDeadline}
                totalMs={VIDEO_REQUEST_TIMEOUT_MS}
                preview={localStream}
                micOn={micOn}
                camOn={camOn}
                onToggleMic={toggleMic}
                onToggleCam={toggleCam}
                onCancel={cancelVideoRequest}
              />
            ) : null
          }
        />
      )}

      {video === "active" && callStartedAt !== null && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          peerLabel={focusPlace ? `Stranger · ${focusPlace.name}` : "Stranger"}
          startedAt={callStartedAt}
          micOn={micOn}
          camOn={camOn}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
          onEnd={endVideo}
          myReveal={myReveal}
          peerReveal={peerReveal}
          onReveal={changeReveal}
        />
      )}
    </main>
  );
}
