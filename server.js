#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.js';
import { Orchestrator } from './lib/orchestrator.js';
import { loadConfig } from './lib/config.js';
import { roleOf, listRoles } from './lib/roles.js';
import { loadArchetype, listArchetypes } from './lib/archetypes.js';
import { SKILLS, skillsOf } from './lib/skills.js';
import { BUILTIN, listSpaces, loadSpace, pick, removeSpace, saveSpace } from './lib/spaces.js';

const root = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--workdir') out.workdir = argv[++i];
    else if (a === '--user') out.user = argv[++i];
  }
  return out;
}

const config = loadConfig(root, parseArgs(process.argv.slice(2)));
const store = new Store(path.join(root, 'rooms'));
const orch = new Orchestrator({ store, config, stateDir: path.join(root, 'rooms') });
const clients = new Set();

// Сервер мог упасть или перезапуститься посреди шага режима. Состояние на диске помнит,
// кого ждут, но очередь ходов живёт в процессе и перезапуск не переживает.
for (const { room, mode, step, pending } of orch.resumeAll()) {
  console.log(`продолжаем #${room}: ${mode}, шаг ${step} — ждём ${pending.join(', ')}`);
}
const configFile = path.join(root, 'openspace.config.json');

function saveConfig(cfg) {
  const { workdir, ...rest } = cfg;
  const onDisk = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  fs.writeFileSync(configFile, JSON.stringify({ ...onDisk, ...rest }, null, 2) + '\n');
}

/** Полное описание комнаты — для редактора: со всеми текстами. */
const full = (m) => ({ ...short(m), laws: m.laws, circle: m.circle, cast: m.cast, duty: m.duty, tune: m.tune });

const short = (m) => {
  const present = orch.names.map((n) => n.toLowerCase());
  return {
    name: m.name,
    // Клиенту незачем знать русское имя файла общей комнаты.
    builtin: m.name === BUILTIN,
    title: m.title,
    titleEn: m.titleEn,
    brief: m.brief,
    briefEn: m.briefEn,
    for: m.for,
    forEn: m.forEn,
    icon: m.icon,
    // Цвет — единственный опознавательный знак комнаты: им красится знак и акценты.
    color: m.color,
    slug: m.slug,
    short: m.short,
    shortEn: m.shortEn,
    // Кто здесь живёт: зашли в комнату — разговариваете с этими.
    who: pick(m.cast, orch.names, orch.roster),
    // И как они выглядят. Состав в карточке — свой у каждой комнаты, а `agents` ниже
    // отдаёт только тех, кто живёт в текущей: без этих лиц чужие комнаты рисовались
    // серыми роботами — знак «участника не нашли».
    faces: pick(m.cast, orch.names, orch.roster).map((n) => ({
      name: n,
      icon: orch.roster[n]?.icon ?? roleOf(orch.roster[n] ?? {}).icon,
      color: orch.roster[n]?.color ?? null,
      roleName: orch.roster[n]?.role ?? 'peer',
    })),
    needs: m.needs,
    // Кого комната просит, а в команде нет: выбирая, куда зайти, это стоит знать сразу.
    missing: m.needs.filter((n) => !present.includes(n.toLowerCase())),
    // Кто в комнате за что: лента подписывает этим реплики, а карточка — состав.
    sides: m.sides ?? [],
    // Заводится ли здесь круг: первый ответ на вопрос все дают, не видя друг друга.
    circle: !!m.circle,
    // Без регламента: круг не заводится. Клиенту это и порядок в списке, и черта перед ним.
    talk: !!m.talk,
  };
};


const describe = (name, a) => ({
  label: a.label ?? name,
  role: roleOf(a).title,
  roleEn: roleOf(a).titleEn,
  roleName: a.role ?? 'peer',
  // Амплуа своё, если выбрано в карточке, иначе то, что объявила роль.
  archetype: a.archetype ?? roleOf(a).archetype,
  archetypeEn: a.archetype ? '' : roleOf(a).archetypeEn,
  pulls: roleOf(a).pulls,
  icon: a.icon ?? roleOf(a).icon,
  color: a.color ?? null,
  prompt: a.prompt ?? roleOf(a).body,
  promptCustom: a.prompt ?? null,
  // В поле показываем то, что реально работает: пусто там не значит «без голоса».
  manner: a.manner
    ?? loadArchetype(a.archetype ?? roleOf(a).archetype)?.voice
    ?? roleOf(a).voice,
  mannerCustom: a.manner ?? null,
  iconCustom: a.icon ?? null,
  brief: a.persona ?? roleOf(a).brief,
  briefEn: a.persona ?? roleOf(a).briefEn,
  engine: a.kind ?? name,
  model: a.model ?? null,
  skills: skillsOf(a),
});

store.onMessage((event) => {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    if (c.room === event.room) c.res.write(payload);
  }
});

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (d) => {
      raw += d;
      if (raw.length > 1e6) reject(new Error('слишком большое сообщение'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.zip': 'application/zip',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.map': 'application/json',
};

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const room = url.searchParams.get('room') || config.defaultRoom || 'general';

  try {
    // Сервер слушает только localhost, но браузер ходит на localhost с любой страницы.
    // Чужой сайт не должен уметь написать в ленту: реплика здесь — это команда агенту
    // с доступом к файлам. У своих запросов Origin наш, у curl и bin/say его нет вовсе.
    // Свой Origin — любой локальный: клиент в разработке живёт на порту Vite.
    const origin = req.headers.origin;
    if (req.method !== 'GET' && req.method !== 'HEAD' && origin && !LOCAL.test(new URL(origin).host)) {
      return json(res, 403, { error: 'запрос с чужого сайта' });
    }
    // Тот же довод про имя хоста: чужой домен можно направить на 127.0.0.1.
    if (!LOCAL.test(req.headers.host ?? '')) {
      return json(res, 403, { error: 'сервер отвечает только по localhost' });
    }
    if (url.pathname === '/api/config') {
      // Архивариус — теневой найм: сворачивает ленту в память по вызову оркестратора,
      // а не как собеседник. В шапке, автодополнении @ и списке дежурных его не показываем.
      // Остальные — состав этой комнаты: кто здесь живёт, тот здесь и показывается.
      const lives = new Set(orch.here(room));
      const agents = Object.fromEntries(
        Object.entries(orch.roster)
          .filter(([n, a]) => (a.role ?? '').toLowerCase() !== 'архивариус'
            && (lives.has(n) || orch.state(room).off.includes(n)))
          .map(([name, a]) => [name, describe(name, a)]),
      );
      return json(res, 200, {
        user: config.user,
        userColor: config.userColor ?? '',
        userIcon: config.userIcon ?? 'user',
        workdir: config.workdir,
        maxAutoTurns: config.maxAutoTurns,
        defaultRoom: config.defaultRoom ?? 'general',
        // Дежурные — поле комнаты: кто отвечает человеку, когда он не назвал никого.
        defaultResponders: orch.duty(room),
        // Кого выключили в этой комнате: состав общий, присутствие — своё у каждой.
        off: orch.state(room).off,
        // Знак комнаты: чем заняты и над чем. Левую половину держит сама комната.
        topic: orch.state(room).topic ?? '',
        doing: orch.state(room).doing ?? '',
        agents,
        // Комнаты этой машины: между ними и ходит человек. Описанные файлом — впереди,
        // старые ленты без файла в список не идут: они история, а не место.
        spaces: listSpaces().map(short),
        space: short(loadSpace(room)),
      });
    }

    if (url.pathname === '/api/upload' && req.method === 'POST') {
      const raw = url.searchParams.get('name') || 'file';
      // Имя от клиента — недоверенные данные: оставляем только базовое имя без путей.
      const safe = path.basename(raw).replace(/[^\w.\-\u0400-\u04FF ]+/g, '_').slice(0, 120) || 'file';
      // Кириллица в имени комнаты — обычное дело, и вычёркивать её нельзя: «красная»
      // и «зелёная» превращались в семь подчёркиваний каждая и складывали свои файлы
      // в один каталог. Одинаковое имя файла из разных комнат там затирало соседа.
      const dir = path.join(root, 'rooms', 'files', room.replace(/[^\w\-\u0400-\u04FF]/g, '_'));
      fs.mkdirSync(dir, { recursive: true });

      const stamp = Date.now().toString(36);
      const name = `${stamp}-${safe}`;
      const dest = path.join(dir, name);

      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) {
          req.destroy();
          return json(res, 413, { error: 'файл больше 25 МБ' });
        }
        chunks.push(chunk);
      }
      fs.writeFileSync(dest, Buffer.concat(chunks));

      return json(res, 200, {
        name: safe,
        size,
        url: `/files/${encodeURIComponent(path.basename(dir))}/${encodeURIComponent(name)}`,
        // Путь от рабочей папки — по нему участник откроет файл сам.
        path: path.relative(config.workdir, dest),
      });
    }

    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return json(res, 200, {
        user: config.user,
        userColor: config.userColor ?? '',
        userIcon: config.userIcon ?? 'user',
        workdir: config.workdir,
        maxAutoTurns: config.maxAutoTurns,
        catchUp: config.catchUp,
        laws: config.laws ?? '',
        freeTalk: config.freeTalk !== false,
        // Сколько записей в памяти пространства: без этого числа человек не знает,
        // что она вообще есть, — в ленте её не видно, а в промпт она едет всем.
        memory: orch.memory?.active(room).length ?? 0,
        // Сколько из них знает всё пространство: «главное» едет и в другие комнаты,
        // и человеку стоит видеть, что он раздал наружу.
        memoryShared: orch.memory?.active(room).filter((i) => i.level === 'главное').length ?? 0,
        // Состав в настройках — вся команда целиком: кто в какой комнате живёт,
        // решает файл комнаты, а карточка описывает человека, а не его место.
        agents: Object.fromEntries(
          Object.entries(orch.roster).map(([name, a]) => [name, describe(name, a)]),
        ),
        roles: listRoles().map((r) => ({
          name: r.name,
          title: r.title,
          titleEn: r.titleEn,
          brief: r.brief,
          icon: r.icon,
          archetype: r.archetype,
          archetypeEn: r.archetypeEn,
          model: r.model,
          pulls: r.pulls,
          skills: r.skills,
        })),
        archetypes: listArchetypes().map((x) => ({
          name: x.name, title: x.title, titleEn: x.titleEn, brief: x.brief, briefEn: x.briefEn, voice: x.voice,
        })),
        engines: ['claude', 'codex'],
        skillList: SKILLS,
      });
    }

    // Журнал вопросов: во что обошёлся каждый и сколько в среднем стоит режим.
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req);
      const patch = {};

      for (const key of ['maxAutoTurns', 'catchUp']) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      // Имя человека: те же буквы, что и у ников участников, и не занятое кем-то из них.
      if (typeof body.user === 'string') {
        const name = body.user.trim();
        if (!/^[a-zA-Z0-9_\-Ѐ-ӿ ]{1,40}$/.test(name)) return json(res, 400, { error: 'имя: буквы, цифры, дефис' });
        if (orch.names.some((n) => n.toLowerCase() === name.toLowerCase())) {
          return json(res, 400, { error: `@${name} — это уже участник` });
        }
        patch.user = name;
      }
      if (typeof body.userColor === 'string') patch.userColor = body.userColor.trim();
      if (typeof body.userIcon === 'string') patch.userIcon = body.userIcon;
      if ('freeTalk' in body) patch.freeTalk = !!body.freeTalk;
      if ('laws' in body) patch.laws = String(body.laws ?? '').slice(0, 2000);

      if (body.agents) {
        // Запрос может нести часть состава: остальных сохраняем, иначе один неполный
        // запрос выносит всю команду.
        const agents = body.replaceTeam ? {} : { ...orch.roster };
        for (const [name, a] of Object.entries(body.agents)) {
          if (!/^[a-zA-Z0-9_\-Ѐ-ӿ]+$/.test(name) || name === config.user) continue;
          const prev = orch.roster[name] ?? {};
          agents[name] = {
            ...prev,
            kind: ['claude', 'codex'].includes(a.engine) ? a.engine : (prev.kind ?? 'claude'),
            role: a.roleName ?? prev.role ?? 'peer',
            label: name,
            lean: true,
            timeoutMs: prev.timeoutMs ?? 300000,
          };
          // Умения выдают поштучно, и выдача — это и есть разрешение: отдельного
          // уровня доступа (trust) больше нет, старый читается как набор умений.
          if (Array.isArray(a.skills)) {
            agents[name].skills = a.skills.filter((x) => SKILLS.includes(x));
            delete agents[name].trust;
          }
          if (a.model) agents[name].model = a.model;
          else delete agents[name].model;
          if (a.iconCustom) agents[name].icon = a.iconCustom;
          else delete agents[name].icon;
          if (a.color) agents[name].color = a.color;
          if (a.promptCustom?.trim()) agents[name].prompt = a.promptCustom.trim();
          else delete agents[name].prompt;
          // Именно mannerCustom: в manner лежит то, что видно в поле, — голос амплуа.
          // Читая его, сохранение делало своим голосом каждого, кто просто открыл карточку.
          if (a.mannerCustom?.trim()) agents[name].manner = a.mannerCustom.trim();
          else delete agents[name].manner;
          // Своё амплуа держим, только если оно отличается от объявленного ролью:
          // иначе смена роли не меняла бы голос, а тащила бы за собой прежний.
          if (a.archetype && a.archetype !== roleOf(agents[name]).archetype) {
            agents[name].archetype = a.archetype;
          } else delete agents[name].archetype;
        }
        if (Object.keys(agents).length) patch.agents = agents;
      }

      const applied = orch.reconfigure(patch);
      Object.assign(config, applied);
      saveConfig(applied);

      return json(res, 200, {
        ok: true,
        // Состав в настройках — вся команда целиком: кто в какой комнате живёт,
        // решает файл комнаты, а карточка описывает человека, а не его место.
        agents: Object.fromEntries(
          Object.entries(orch.roster).map(([name, a]) => [name, describe(name, a)]),
        ),
        user: applied.user,
        userColor: applied.userColor ?? '',
        userIcon: applied.userIcon ?? 'user',
        maxAutoTurns: applied.maxAutoTurns,
        catchUp: applied.catchUp,
        freeTalk: applied.freeTalk !== false,
      });
    }

    if (url.pathname === '/api/messages' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? 0);
      return json(res, 200, {
        messages: store.since(room, since),
        state: orch.view(room),
      });
    }

    if (url.pathname === '/api/messages/edit' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) return json(res, 400, { error: 'пустая реплика' });
      try {
        return json(res, 200, { edit: orch.edit(room, Number(body.seq), text) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (url.pathname === '/api/memory/confirm' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        return json(res, 200, { resolved: orch.confirmMemory(room, Number(body.seq)) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (url.pathname === '/api/memory/reject' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        return json(res, 200, { resolved: orch.rejectMemory(room, Number(body.seq)) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (url.pathname === '/api/messages' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.text?.trim() && !body.files?.length) return json(res, 400, { error: 'пустое сообщение' });
      body.text = body.text ?? '';
      // Автор — человек или участник из состава: самозванцев в ленте потом не разобрать.
      const from = body.from || config.user;
      if (from !== config.user && !orch.names.includes(from)) {
        return json(res, 400, { error: `в пространстве нет @${from}` });
      }
      const msg = orch.post(room, {
        from,
        text: body.text.trim(),
        files: Array.isArray(body.files) ? body.files.slice(0, 10) : undefined,
        replyTo: Number.isFinite(body.replyTo) ? body.replyTo : undefined,
      });
      return json(res, 200, { message: msg });
    }

    if (url.pathname === '/api/spaces' && req.method === 'GET') {
      return json(res, 200, { spaces: listSpaces().map(full) });
    }

    if (url.pathname === '/api/spaces' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        return json(res, 200, { space: full(saveSpace(body)) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (url.pathname === '/api/spaces' && req.method === 'DELETE') {
      const name = url.searchParams.get('name');
      return json(res, 200, { ok: removeSpace(name) });
    }

    if (url.pathname === '/api/presence' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        return json(res, 200, { here: orch.toggle(room, String(body.name ?? ''), body.on !== false) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (url.pathname === '/api/pause' && req.method === 'POST') {
      const body = await readBody(req);
      orch.pause(room, body.on !== false);
      return json(res, 200, { state: orch.view(room) });
    }

    if (url.pathname === '/api/memory/clear' && req.method === 'POST') {
      orch.memory?.clear(room);
      return json(res, 200, { ok: true, memory: 0 });
    }

    if (url.pathname === '/api/clear' && req.method === 'POST') {
      orch.clearRoom(room);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/reset' && req.method === 'POST') {
      orch.reset(room);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      const client = { room, res };
      clients.add(client);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(client); });
      return undefined;
    }

    // Файл из рабочей папки: по нему участник прикладывает к реплике то, что сделал.
    // Наружу не выпускаем — путь обязан остаться внутри рабочей папки.
    if (url.pathname.startsWith('/workdir/')) {
      const rel = decodeURIComponent(url.pathname.slice('/workdir/'.length));
      const base = path.resolve(config.workdir);
      const file = path.resolve(base, rel);
      if (!file.startsWith(base + path.sep)) return json(res, 403, { error: 'нельзя' });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'нет такого файла' });
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'text/plain; charset=utf-8' });
      return fs.createReadStream(file).pipe(res);
    }

    if (url.pathname.startsWith('/files/')) {
      const rel = decodeURIComponent(url.pathname.slice('/files/'.length));
      const file = path.join(root, 'rooms', 'files', rel);
      if (!file.startsWith(path.join(root, 'rooms', 'files'))) return json(res, 403, { error: 'нельзя' });
      if (!fs.existsSync(file)) return json(res, 404, { error: 'нет такого файла' });
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }

    // Статика
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(root, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      // Имя собранного файла меняется вместе с содержимым, а index.html — нет.
      // Закэшированный index.html держит вкладку на прошлой сборке и просит ассеты,
      // которых уже нет: экран остаётся пустым, а причина не видна.
      const cache = file.endsWith('.html')
        ? 'no-store'
        : file.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache';
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': cache,
      });
      return fs.createReadStream(file).pipe(res);
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Порт ${config.port} занят — скорее всего, сервер уже запущен.`);
  console.error(`Открыть: http://localhost:${config.port}`);
  console.error(`Остановить прежний запуск: kill $(lsof -nP -t -iTCP:${config.port} -sTCP:LISTEN)`);
  process.exit(1);
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Openspace  http://localhost:${config.port}`);
  console.log(`рабочая папка: ${config.workdir}`);
  console.log(`участники: ${Object.keys(config.agents).map((n) => '@' + n).join(', ')}, @${config.user}`);
  // Перезапуск не должен глотать обращение, на которое не успели ответить.
  for (const room of store.listRooms()) orch.resume(room);
});
