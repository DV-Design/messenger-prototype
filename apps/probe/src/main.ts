import { createInvite, PeerSession, type SessionSnapshot } from '@messenger/core';
import './style.css';

declare global { interface Window { __session?: PeerSession } }
const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const server = node<HTMLInputElement>('server'), invite = node<HTMLInputElement>('invite');
const relay = node<HTMLInputElement>('relay'), input = node<HTMLTextAreaElement>('text');
const fileInput = node<HTMLInputElement>('file');
const local = node<HTMLVideoElement>('local-video'), remote = node<HTMLVideoElement>('remote-video');
const urls = new Map<string, string>();
let session: PeerSession | undefined;
let busy = false;
let displayedError: string | undefined;
const statusText: Record<SessionSnapshot['status'], string> = {
  idle: 'Не подключён', connecting: 'Соединяем…', waiting: 'Ожидание собеседника',
  connected: 'Соединение установлено', disconnected: 'Отключён', error: 'Ошибка соединения',
};
const callText: Record<SessionSnapshot['callState'], string> = {
  idle: 'Без звонка', outgoing: 'Ожидаем ответа…', incoming: 'Входящий звонок', active: 'Звонок идёт',
};
function showError(error?: unknown) {
  displayedError = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  const target = node('error'); target.textContent = displayedError ?? ''; target.hidden = !displayedError;
}
async function action(fn: () => void | Promise<void>) {
  try { showError(); await fn(); } catch (error) { showError(error); }
}
function button(id: string, enabled: boolean) { node<HTMLButtonElement>(id).disabled = !enabled; }
function media(video: HTMLVideoElement, stream?: MediaStream) {
  if (video.srcObject === (stream ?? null)) return;
  video.srcObject = stream ?? null;
  if (stream) void video.play().catch(() => { /* Autoplay may require the user's click; the media element has controls. */ video.controls = true; });
}
function render(snapshot: SessionSnapshot) {
  const connected = snapshot.status === 'connected';
  const connecting = ['connecting', 'waiting', 'connected'].includes(snapshot.status);
  const status = node('status'); status.textContent = statusText[snapshot.status]; status.dataset.state = snapshot.status;
  const route = node('route'); route.textContent = { unknown: 'Ещё не определён', direct: 'Напрямую · P2P', relay: 'Через TURN' }[snapshot.route]; route.dataset.route = snapshot.route;
  node('rtt').textContent = snapshot.stats.rttMs === undefined ? '—' : `${snapshot.stats.rttMs.toFixed(0)} мс`;
  node('audio-stats').textContent = `${snapshot.stats.audioBitrateKbps?.toFixed(1) ?? '—'} кбит/с · ${snapshot.stats.packetsLost ?? '—'} пак. · ${snapshot.stats.jitterMs?.toFixed(0) ?? '—'} мс`;
  node('live-dot').classList.toggle('online', connected);
  server.disabled = invite.disabled = relay.disabled = connecting;
  button('generate', !connecting); button('connect', !connecting && !busy); button('disconnect', connecting);
  input.disabled = fileInput.disabled = !connected; button('send', connected);
  button('audio-call', connected && snapshot.callState === 'idle'); button('video-call', connected && snapshot.callState === 'idle');
  const call = node('call-state'); call.textContent = callText[snapshot.callState]; call.dataset.state = snapshot.callState;
  node('incoming').hidden = snapshot.callState !== 'incoming';
  node('active-call').hidden = !['active', 'outgoing'].includes(snapshot.callState);
  node('media').hidden = !snapshot.localStream && !snapshot.remoteStream;
  node('mute').textContent = snapshot.muted ? 'Включить микрофон' : 'Выключить микрофон';
  media(local, snapshot.localStream); media(remote, snapshot.remoteStream);
  if (snapshot.error) showError(snapshot.error);
  const messages = node('messages'); messages.replaceChildren();
  if (!snapshot.messages.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = connected ? 'Вы на связи. Напишите первое сообщение.' : 'Разговор начнётся, когда оба устройства окажутся в сети.'; messages.append(empty);
  }
  for (const message of snapshot.messages) {
    const bubble = document.createElement('article'); bubble.className = `bubble ${message.from}`;
    const label = document.createElement('small'); label.textContent = message.from === 'self' ? 'Вы' : 'Собеседник';
    const body = document.createElement('p'); body.textContent = message.text; bubble.append(label, body); messages.append(bubble);
  }
  messages.scrollTop = messages.scrollHeight;
  const files = node('files'); files.replaceChildren();
  for (const [id, url] of urls) if (!snapshot.files.some((file) => file.id === id)) { URL.revokeObjectURL(url); urls.delete(id); }
  for (const file of snapshot.files) {
    const row = document.createElement('div'); row.className = 'file-row'; row.dataset.fileName = file.name; row.dataset.status = file.status;
    const name = document.createElement('strong'); name.textContent = file.name;
    const progress = document.createElement('span');
    progress.textContent = `${file.from === 'self' ? 'Вы →' : '→ Вы'} ${file.receivedBytes} / ${file.size} Б · ${{ sending: 'отправляется', receiving: 'принимается', complete: 'готово', error: 'ошибка' }[file.status]}`;
    row.append(name, progress);
    if (file.data && file.status === 'complete') {
      let url = urls.get(file.id);
      if (!url) { url = URL.createObjectURL(new Blob([new Uint8Array(file.data)], { type: 'application/octet-stream' })); urls.set(file.id, url); }
      const link = document.createElement('a'); link.href = url; link.download = file.name; link.textContent = 'Скачать'; row.append(link);
    }
    files.append(row);
  }
}
node('generate').addEventListener('click', () => { invite.value = createInvite(); showError(); });
node('copy').addEventListener('click', () => void action(async () => {
  if (!invite.value) throw new Error('Сначала создайте приглашение');
  await navigator.clipboard.writeText(invite.value);
  node('copy').textContent = 'Скопировано';
}));
node('connect').addEventListener('click', () => void action(async () => {
  busy = true; button('connect', false);
  try {
    session?.disconnect();
    session = new PeerSession({ serverUrl: server.value.trim(), invite: invite.value.trim(), relayOnly: relay.checked, onChange: render });
    // Diagnostic development handle exposes state/actions, never prints the invitation.
    if (import.meta.env.DEV) window.__session = session;
    await session.connect();
  } finally { busy = false; if (session) render(session.getSnapshot()); else button('connect', true); }
}));
node('disconnect').addEventListener('click', () => session?.disconnect());
node('chat').addEventListener('submit', (event) => {
  event.preventDefault(); void action(async () => { await session?.sendText(input.value); input.value = ''; });
});
fileInput.addEventListener('change', () => void action(async () => {
  const file = fileInput.files?.[0]; if (!file || !session) return;
  if (file.size > 5 * 1024 * 1024) throw new Error('Размер файла больше 5 МиБ');
  try { await session.sendFile({ name: file.name, mime: file.type || 'application/octet-stream', data: new Uint8Array(await file.arrayBuffer()) }); }
  finally { fileInput.value = ''; }
}));
node('audio-call').addEventListener('click', () => void action(() => session?.startCall(false)));
node('video-call').addEventListener('click', () => void action(() => session?.startCall(true)));
node('accept').addEventListener('click', () => void action(() => session?.acceptCall()));
node('reject').addEventListener('click', () => session?.rejectCall());
node('end').addEventListener('click', () => session?.endCall());
node('mute').addEventListener('click', () => session?.setMuted(!session.getSnapshot().muted));
window.addEventListener('beforeunload', () => { session?.disconnect(); for (const url of urls.values()) URL.revokeObjectURL(url); });
