#!/usr/bin/env node
// novel-script — deterministic helpers for the novel-script skill (剧本).
// Zero dependencies on purpose: the skill must work in any directory
// without an npm install. Node 18+ (stdlib only).

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* 时长引擎                                                             */
/* ------------------------------------------------------------------ */
/*
 * 剧本层不分镜头（分镜是下一个 skill 的活），但时长预算必须在这层守住：
 * AI 短剧一集就是三分钟上下，台词写超了后面全盘返工。
 *
 * 估算模型：台词秒数 = 非空白字符数 ÷ 语速；动作节拍按固定秒数计。
 * 是估算不是秒表，所以容差给到 ±15%（可配）——但估算也比不算强得多，
 * 一集写到五分钟的剧本在这里就会被拦下，不会流到生成环节才发现。
 */

export const DEFAULT_PARAMS = {
  charsPerSecond: 4.5, // 中文口语偏快档
  actionSeconds: 2.5,  // 每个动作节拍的估时
  tolerance: 0.15,     // 时长容差 ±15%
  maxLineChars: 35,    // 单句台词上限——一口气说不完的台词也生成不了
  hookWindow: 3,       // 开场钩子必须在全集前几拍内兑现——短剧开场 3 秒定生死
};

// Starting measurement for Thai dialogue, to be calibrated against the studio's
// actual voices. Thai combining vowels and tone marks do not count as characters.
export const THAI_CHARS_PER_SECOND = 13;
export const CONTENT_LANGS = ['zh', 'th', 'en'];
export const contentLangOf = (doc) => doc?.contentLang ?? 'zh';

export function paramsOf(doc) {
  const contentLang = contentLangOf(doc);
  return {
    ...DEFAULT_PARAMS,
    ...(contentLang === 'th' && doc?.params?.charsPerSecond == null
      ? { charsPerSecond: THAI_CHARS_PER_SECOND }
      : {}),
    ...(doc?.params ?? {}),
    contentLang,
  };
}

/** 台词计秒用的字符数：去空白，标点算时间；泰文不计组合元音与声调符号。 */
export const lineChars = (line, contentLang = 'zh') => {
  const raw = String(line ?? '').replace(/\s+/g, '');
  if (contentLang !== 'th') return raw.length;
  const compact = raw.normalize('NFC');
  return Array.from(compact.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '')).length;
};

const r1 = (n) => Math.round(n * 10) / 10;

/** 一场戏的估秒。flow 里台词按语速折算，动作节拍按固定秒数。 */
export function sceneSeconds(scene, params = DEFAULT_PARAMS) {
  let dlg = 0;
  let act = 0;
  for (const b of scene?.flow ?? []) {
    if (typeof b?.line === 'string') dlg += lineChars(b.line, params.contentLang) / params.charsPerSecond;
    else if (typeof b?.action === 'string') act += params.actionSeconds;
  }
  return { dialogue: r1(dlg), action: r1(act), total: r1(dlg + act) };
}

/* ------------------------------------------------------------------ */
/* stats — 报告与质量门共用的确定性统计                                   */
/* ------------------------------------------------------------------ */

export function computeStats(doc) {
  const params = paramsOf(doc);
  const episodes = [];
  const sceneTable = [];
  const byCharacter = new Map(); // C01 → { lines: [...], chars }

  for (const ep of doc?.episodes ?? []) {
    let dlg = 0;
    let act = 0;
    let lines = 0;
    (ep?.scenes ?? []).forEach((sc, idx) => {
      const sec = sceneSeconds(sc, params);
      dlg += sec.dialogue;
      act += sec.action;
      let lineCount = 0;
      for (const b of sc?.flow ?? []) {
        if (typeof b?.line !== 'string') continue;
        lineCount++;
        lines++;
        const key = b.speaker ?? '?';
        if (!byCharacter.has(key)) byCharacter.set(key, { lines: [], chars: 0 });
        const entry = byCharacter.get(key);
        entry.lines.push({ ep: ep.ep, sceneIndex: idx + 1, sceneId: sc.sceneId, line: b.line, delivery: b.delivery ?? '' });
        entry.chars += lineChars(b.line, params.contentLang);
      }
      sceneTable.push({
        ep: ep.ep, index: idx + 1, sceneId: sc.sceneId, lighting: sc.lighting ?? '',
        characters: sc.characters ?? [], props: sc.props ?? [],
        lineCount, estSeconds: sec.total,
      });
    });
    episodes.push({
      ep: ep.ep,
      target: ep.targetSeconds,
      est: r1(dlg + act),
      dialogueSeconds: r1(dlg),
      actionSeconds: r1(act),
      lines,
      sceneCount: (ep?.scenes ?? []).length,
    });
  }

  const totals = {
    episodes: episodes.length,
    scenes: sceneTable.length,
    lines: episodes.reduce((n, e) => n + e.lines, 0),
    estSeconds: r1(episodes.reduce((n, e) => n + e.est, 0)),
    targetSeconds: episodes.reduce((n, e) => n + (e.target ?? 0), 0),
    dialogueSeconds: r1(episodes.reduce((n, e) => n + e.dialogueSeconds, 0)),
  };

  const castLines = [...byCharacter.entries()]
    .map(([id, v]) => ({ id, count: v.lines.length, chars: v.chars, lines: v.lines }))
    .sort((a, b) => b.count - a.count);

  return { params, episodes, sceneTable, castLines, totals };
}

/* ------------------------------------------------------------------ */
/* 质量门                                                               */
/* ------------------------------------------------------------------ */
/*
 * 与仓库里其他 skill 同一主张：checklist 是代码，不是给模型读的文字。
 * 需要上游对账的门（角色 / 场景与光照 / 爽点认领）在没给上游文件时
 * 明说跳过——静默通过和撒谎只差一步。
 */

const thText = (s) => typeof s === 'string' && s.trim();
/** 动作描述必须是叙述体——台词只能进 dialogue 字段，混进 action 就没法计秒。 */
const QUOTE_RE = /「|」|『|』|“|”/;
const actionHasDialogueQuotes = (text, contentLang) =>
  QUOTE_RE.test(text) || (contentLang !== 'zh' && /"/.test(text));

export function gateReport(doc, ctx = {}) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok, detail });
  const eps = Array.isArray(doc?.episodes) ? doc.episodes : [];
  const params = paramsOf(doc);
  const stats = computeStats(doc);
  const bad = { duration: [], lineLen: [], speaker: [], hook: [], hookOpen: [], noAction: [], prose: [], beats: [], chars: [], scenes: [] };

  for (const [i, ep] of eps.entries()) {
    const st = stats.episodes[i];
    const label = `第 ${ep?.ep} 集`;

    // 时长预算：写超写欠都在这层拦，别流到生成环节才发现
    if (ep?.targetSeconds > 0) {
      const lo = ep.targetSeconds * (1 - params.tolerance);
      const hi = ep.targetSeconds * (1 + params.tolerance);
      if (st.est < lo) bad.duration.push(`${label}欠 ${r1(lo - st.est)} 秒（估 ${st.est}s / 目标 ${ep.targetSeconds}s）`);
      if (st.est > hi) bad.duration.push(`${label}超 ${r1(st.est - hi)} 秒（估 ${st.est}s / 目标 ${ep.targetSeconds}s）`);
    }

    // 开场钩子与结尾悬念：说明必须落在纸面
    if (!thText(ep?.hook) || !thText(ep?.cliff)) bad.hook.push(label);

    // 钩子不是标签是第一拍：hookBeat 认领具象落在哪一拍，必须在全集前几拍内。
    // 只有说明没有认领，就会出现「钩子说皮箱、开场拍了八拍雾」的衔接断裂
    {
      const hb = ep?.hookBeat;
      if (!Array.isArray(hb) || hb.length !== 2 || !Number.isInteger(hb[0]) || !Number.isInteger(hb[1])) {
        bad.hookOpen.push(`${label}缺 hookBeat（[场, 拍]，认领钩子具象的位置）`);
      } else {
        const scene = ep?.scenes?.[hb[0] - 1];
        if (!scene || hb[1] < 1 || hb[1] > (scene.flow ?? []).length) {
          bad.hookOpen.push(`${label}的 hookBeat [${hb[0]}, ${hb[1]}] 指向不存在的节拍`);
        } else {
          let pos = hb[1];
          for (let i = 0; i < hb[0] - 1; i++) pos += (ep.scenes[i]?.flow ?? []).length;
          if (pos > params.hookWindow) {
            bad.hookOpen.push(`${label}的钩子落在全集第 ${pos} 拍，超出前 ${params.hookWindow} 拍——冷开场先给钩子的具象`);
          }
        }
      }
    }

    for (const sc of ep?.scenes ?? []) {
      const cast = new Set(sc?.characters ?? []);
      let hasAction = false;
      for (const b of sc?.flow ?? []) {
        if (typeof b?.action === 'string') {
          hasAction = true;
          if (actionHasDialogueQuotes(b.action, params.contentLang)) bad.prose.push(`${label} ${sc?.sceneId ?? '?'}`);
        }
        if (typeof b?.line === 'string') {
          if (lineChars(b.line, params.contentLang) > params.maxLineChars) {
            bad.lineLen.push(`${label}「${b.line.slice(0, 12)}…」${lineChars(b.line, params.contentLang)} 字`);
          }
          if (b.speaker !== 'VO' && !cast.has(b.speaker)) {
            bad.speaker.push(`${label} ${sc?.sceneId ?? '?'} 的「${b.speaker}」不在本场人物里`);
          }
        }
      }
      // 纯对白无动作的场 = 广播剧，生成时没有画面可写
      if ((sc?.flow ?? []).length > 0 && !hasAction) bad.noAction.push(`${label} ${sc?.sceneId ?? '?'}`);
    }
  }

  // ---- 需要上游对账的门 ----
  const outline = ctx.outline ?? null;
  const art = ctx.art ?? null;

  if (outline) {
    const charIds = new Set((outline.characters ?? []).map((c) => c.id));
    for (const ep of eps) {
      for (const sc of ep?.scenes ?? []) {
        for (const id of sc?.characters ?? []) {
          if (!charIds.has(id)) bad.chars.push(`第 ${ep.ep} 集 ${sc.sceneId ?? '?'} 的 ${id}`);
        }
      }
      // 爽点认领：大纲说这一集有的爆点，剧本必须认领
      const due = [...new Set((outline.beats ?? []).filter((b) => b.episode === ep.ep).map((b) => b.type))];
      const claimed = new Set(ep?.beatsClaimed ?? []);
      for (const t of due) if (!claimed.has(t)) bad.beats.push(`第 ${ep.ep} 集缺「${t}」`);
    }
  }

  if (art) {
    const sceneMap = new Map((art.scenes ?? []).map((s) => [s.id, s]));
    const propIds = new Set((art.props ?? []).map((p) => p.id));
    for (const ep of eps) {
      for (const sc of ep?.scenes ?? []) {
        const ref = sceneMap.get(sc?.sceneId);
        if (!ref) {
          bad.scenes.push(`第 ${ep.ep} 集引用了不存在的场景 ${sc?.sceneId}`);
        } else if (thText(sc?.lighting) && !(ref.lighting ?? []).some((l) => l.state === sc.lighting)) {
          bad.scenes.push(`第 ${ep.ep} 集 ${sc.sceneId} 的光照「${sc.lighting}」没在美术设定里登记`);
        }
        for (const pid of sc?.props ?? []) {
          if (!propIds.has(pid)) bad.scenes.push(`第 ${ep.ep} 集引用了不存在的道具 ${pid}`);
        }
      }
    }
  }

  const SKIP_OUTLINE = '未提供 outline.json，本门跳过（视为通过）';
  const SKIP_ART = '未提供 art.json，本门跳过（视为通过）';

  add('duration', `每集时长在目标 ±${Math.round(params.tolerance * 100)}% 内`, eps.length > 0 && bad.duration.length === 0, bad.duration.join('；'));
  add('line-length', `单句台词 ≤ ${params.maxLineChars} 字`, bad.lineLen.length === 0, bad.lineLen.join('；'));
  add('speaker', '说话人在本场人物里，或明确标画外音 VO', bad.speaker.length === 0, bad.speaker.join('；'));
  add('hook-cliff', '每集开场钩子与结尾悬念都落在纸面', eps.length > 0 && bad.hook.length === 0, bad.hook.join('；'));
  add('hook-open', `钩子的具象在全集前 ${params.hookWindow} 拍内兑现（hookBeat 认领）`, eps.length > 0 && bad.hookOpen.length === 0, bad.hookOpen.join('；'));
  add('has-action', '每场至少一个动作节拍——纯对白的场是广播剧', eps.length > 0 && bad.noAction.length === 0, bad.noAction.join('；'));
  add('action-prose', '动作描述叙述体，台词只进 dialogue 字段', bad.prose.length === 0, bad.prose.join('；'));
  add('beats-claimed', '大纲爽点逐集认领', bad.beats.length === 0, outline ? bad.beats.join('；') : SKIP_OUTLINE);
  add('refs-characters', '角色引用对账大纲', bad.chars.length === 0, outline ? bad.chars.join('；') : SKIP_OUTLINE);
  add('refs-scenes', '场景／光照／道具对账美术设定', bad.scenes.length === 0, art ? bad.scenes.join('；') : SKIP_ART);

  return gates;
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

export function validateScript(doc, ctx = {}) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  if (!doc || typeof doc !== 'object') return ['script.json 不是对象'];

  if (!thText(doc.source)) p('缺少 source（剧名/书名）');
  if (!CONTENT_LANGS.includes(contentLangOf(doc))) p(`contentLang 只支持 zh / th / en，实际是「${contentLangOf(doc)}」`);
  const eps = doc.episodes;
  if (!Array.isArray(eps) || eps.length === 0) {
    p('episodes 为空');
    return problems;
  }

  const seen = new Set();
  for (const ep of eps) {
    const label = `第 ${ep?.ep ?? '?'} 集`;
    if (!Number.isInteger(ep?.ep) || ep.ep < 1) p(`${label}的 ep 必须是正整数`);
    if (seen.has(ep?.ep)) p(`集号 ${ep.ep} 重复`);
    seen.add(ep?.ep);
    if (!(ep?.targetSeconds > 0)) p(`${label}缺 targetSeconds（目标秒数，来自大纲的单集时长）`);
    if (!Array.isArray(ep?.beatsClaimed)) p(`${label}缺 beatsClaimed（认领的爽点，可为空数组）`);
    if (!Array.isArray(ep?.scenes) || ep.scenes.length === 0) {
      p(`${label}没有场次`);
      continue;
    }
    ep.scenes.forEach((sc, i) => {
      const sLabel = `${label}第 ${i + 1} 场`;
      if (!/^S\d{2,}$/.test(sc?.sceneId ?? '')) p(`${sLabel} sceneId 必须是 S01 这种格式`);
      if (!Array.isArray(sc?.characters)) p(`${sLabel}缺 characters（本场人物，空镜给空数组）`);
      if (!Array.isArray(sc?.flow) || sc.flow.length === 0) p(`${sLabel}的节拍流为空`);
      for (const b of sc?.flow ?? []) {
        const isAction = typeof b?.action === 'string';
        const isLine = typeof b?.line === 'string';
        if (isAction === isLine) {
          p(`${sLabel}有节拍既不是动作也不是台词（action 与 line 二选一）`);
          continue;
        }
        if (isAction && !b.action.trim()) p(`${sLabel}有空动作节拍`);
        if (isLine) {
          if (!b.line.trim()) p(`${sLabel}有空台词`);
          if (!thText(b.speaker)) p(`${sLabel}有台词缺 speaker`);
        }
      }
    });
  }

  for (const g of gateReport(doc, ctx)) {
    if (!g.ok) p(`质量门未过：${g.label}${g.detail ? `（${g.detail}）` : ''}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* seed — 从 outline.json 确定性预填骨架                                 */
/* ------------------------------------------------------------------ */
/*
 * 目标秒数、钩子、悬念、该集爽点在大纲里都是现成的——这些事实不让
 * 模型重新想。scenes 留空给模型写戏。
 */

export function seedFromOutline(outline, epRange = null) {
  const perEp = (outline?.params?.minutesPerEpisode ?? 3) * 60;
  const inRange = (n) => !epRange || (n >= epRange[0] && n <= epRange[1]);
  const episodes = (outline?.episodes ?? [])
    .filter((e) => inRange(e.ep))
    .map((e) => ({
      ep: e.ep,
      targetSeconds: perEp,
      hook: e.hook ?? '',
      cliff: e.suspense ?? '',
      beatsClaimed: [...new Set((outline.beats ?? []).filter((b) => b.episode === e.ep).map((b) => b.type))],
      scenes: [],
      // 从大纲搬来的参考，写完删掉也行
      seedNote: `大纲梗概：${e.synopsis ?? ''}　候选场景：${(e.sceneIds ?? []).join('、')}　人物：${(e.characterIds ?? []).join('、')}`,
    }));
  return {
    source: outline?.source ?? '',
    contentLang: contentLangOf(outline),
    ...(outline?.lang ? { lang: outline.lang } : {}),
    episodes,
  };
}

/* ------------------------------------------------------------------ */
/* slug                                                                */
/* ------------------------------------------------------------------ */

export function slug(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\s/\\:*?"<>|·]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'script';
}

/* ------------------------------------------------------------------ */
/* render — 界面文案                                                    */
/* ------------------------------------------------------------------ */
/*
 * 内置 zh / th / en 三套，全部界面文案收在这张表里。
 * 质量门的 label/detail 是 validate/checkup 的诊断文案，保持中文，不在此列。
 */

/* 门标签与「跳过」提示的英文映射：质量门面板是报告的一部分，出英文报告时
 * 这里做展示层翻译——gateReport 的逻辑与中文诊断文案一行不动（CLI 仍是中文）。
 * 动态阈值由门自己算，映射里只写固定语义；未命中的 id 回落到原标签。 */
const GATE_LABELS_EN = {
  'duration': 'Episode duration within ±{0}% of target',
  'line-length': 'Every line ≤ {0} characters',
  'speaker': 'Speaker is in the scene cast, or explicitly marked V.O.',
  'hook-cliff': 'Hook and cliffhanger on paper for every episode',
  'hook-open': 'The hook\'s concrete image lands within the first {0} beats (claimed by hookBeat)',
  'has-action': 'At least one action beat per scene — a dialogue-only scene is radio drama',
  'action-prose': 'Action in narrative prose; dialogue only in dialogue entries',
  'beats-claimed': 'Outline beats claimed per episode',
  'refs-characters': 'Character references audited against the outline',
  'refs-scenes': 'Scenes / lighting / props audited against the art bible',
};
const GATE_SKIPS_EN = {
    '未提供 outline.json，本门跳过（视为通过）': 'outline.json not provided — gate skipped (treated as passing)',
    '未提供 art.json，本门跳过（视为通过）': 'art.json not provided — gate skipped (treated as passing)',
    '未提供 script.json，本门跳过（视为通过）': 'script.json not provided — gate skipped (treated as passing)',
    '未提供 outline/cast，本门跳过（视为通过）': 'outline/cast not provided — gate skipped (treated as passing)',
    '未提供 cast.json，本门跳过（视为通过）': 'cast.json not provided — gate skipped (treated as passing)',
};
const GATE_LABELS_TH = {
  'duration': 'ความยาวแต่ละตอนอยู่ในช่วง ±{0}% ของเป้าหมาย',
  'line-length': 'บทพูดแต่ละประโยคยาวไม่เกิน {0} อักขระ',
  'speaker': 'ผู้พูดอยู่ในฉาก หรือระบุชัดว่าเป็นเสียงบรรยาย VO',
  'hook-cliff': 'ทุกตอนมีจุดดึงความสนใจตอนเปิดและจุดค้างท้ายตอน',
  'hook-open': 'ภาพที่ทำให้จุดดึงความสนใจเป็นรูปธรรมเกิดภายใน {0} จังหวะแรก (ระบุด้วย hookBeat)',
  'has-action': 'ทุกฉากมีจังหวะการกระทำอย่างน้อยหนึ่งจังหวะ',
  'action-prose': 'คำบรรยายการกระทำเป็นร้อยแก้ว และบทพูดอยู่ในรายการบทพูดเท่านั้น',
  'beats-claimed': 'รับช่วงจังหวะสำคัญจากโครงเรื่องครบตามตอน',
  'refs-characters': 'ตัวละครตรงกับโครงเรื่อง',
  'refs-scenes': 'ฉาก แสง และอุปกรณ์ประกอบฉากตรงกับคู่มืองานศิลป์',
};
const GATE_SKIPS_TH = {
  '未提供 outline.json，本门跳过（视为通过）': 'ไม่ได้ระบุ outline.json — ข้ามเกณฑ์นี้และถือว่าผ่าน',
  '未提供 art.json，本门跳过（视为通过）': 'ไม่ได้ระบุ art.json — ข้ามเกณฑ์นี้และถือว่าผ่าน',
  '未提供 script.json，本门跳过（视为通过）': 'ไม่ได้ระบุ script.json — ข้ามเกณฑ์นี้และถือว่าผ่าน',
  '未提供 outline/cast，本门跳过（视为通过）': 'ไม่ได้ระบุ outline/cast — ข้ามเกณฑ์นี้และถือว่าผ่าน',
  '未提供 cast.json，本门跳过（视为通过）': 'ไม่ได้ระบุ cast.json — ข้ามเกณฑ์นี้และถือว่าผ่าน',
};
/** 报告里的门文案：英文界面取映射，未命中或中文界面回落原文。 */
const gateText = (g, lang) => {
  if (lang === 'zh') return { label: g.label, detail: g.detail };
  const translated = (lang === 'th' ? GATE_LABELS_TH : GATE_LABELS_EN)[g.id];
  // 阈值仍由门自己算：把中文标签里出现的数字按序填进 {0} {1}
  const nums = String(g.label).match(/\d+(?:\.\d+)?/g) ?? [];
  const label = translated ? translated.replace(/\{(\d)\}/g, (m, i) => nums[Number(i)] ?? m) : g.label;
  const skips = lang === 'th' ? GATE_SKIPS_TH : GATE_SKIPS_EN;
  const detail = skips[g.detail] ?? (g.detail ? (lang === 'th'
    ? 'พบข้อมูลที่ไม่ผ่านเกณฑ์นี้ โปรดเรียก validate เพื่อดูตำแหน่งที่ต้องแก้'
    : 'This gate has failing items; run validate for exact locations') : '');
  return { label, detail };
};

const I18N = {
  zh: {
    langCode: 'zh',
    kicker: '剧本',
    docTitle: (s, a, b) => `${s} · 剧本${a === b ? `（第 ${a} 集）` : `（第 ${a}–${b} 集）`}`,
    epHead: (n) => `第 ${n} 集`,
    epRange: (a, b) => (a === b ? `第 ${a} 集` : `第 ${a}–${b} 集`),
    exportJson: '导出 JSON',
    gates: '质量门',
    gatesPass: '全部通过',
    gatesFail: (n) => `${n} 项未过`,
    gatePill: (okN, total) => `质量门 ${okN} / ${total}`,
    kpi: {
      eps: '集数', epsSub: (sc) => `${sc} 场戏`,
      time: '预估总时长', timeSub: (t) => `目标 ${t}`,
      lines: '台词', linesSub: (sec) => `约 ${sec} 秒对白`,
      dlgRatio: '台词占比', dlgRatioSub: '其余是画面与动作',
      avgScene: '平均每场', avgSceneSub: '换景是统计不是门——AI 换景不要钱',
    },
    secTiming: '时长仪表',
    secScript: '分集剧本',
    secSceneTable: '场次总表',
    secCastLines: '台词本',
    secGates: '质量门',
    timingNote: (tol) => `绿带 = 目标 ±${tol}%；台词按语速折算，动作按节拍估时`,
    scriptNote: '一排两集 · 场次信息超高自动截断，点开看全部',
    sceneTableNote: '自动汇总 · 模型不写',
    castLinesNote: '按角色聚合 · 列表最多显示 6 行可滚动 · 直接对接 TTS 批量生成',
    hookLabel: '开场钩子',
    hookAt: (sc, b) => `第 ${sc} 场第 ${b} 拍兑现`,
    voiceBtn: '音色提示词',
    cliffLabel: '结尾悬念',
    beatsLabel: '认领爽点',
    estLabel: (est, target) => `预估 ${est} 秒 / 目标 ${target} 秒`,
    sceneHead: (i) => `第 ${i} 场`,
    voLabel: '画外音',
    lightingLabel: '光照',
    showScenes: '▾ 展开全部场次',
    hideScenes: '▴ 收起场次',
    sceneCols: ['集', '场', '场景', '光照', '人物', '台词句数', '估秒'],
    castCols: ['角色', '台词句数', '字数', '约合秒数'],
    copyAllLines: '复制全部台词',
    copy: '复制', copied: '已复制', copyFailed: '复制失败',
    lineRef: (ep, i) => `E${String(ep).padStart(2, '0')} 第 ${i} 场`,
    dlgSec: (s) => `${s} 秒`,
    fmtMin: (m, s) => `${m} 分 ${s} 秒`,
    overBy: (s) => `超 ${s} 秒`,
    underBy: (s) => `欠 ${s} 秒`,
    legendDlg: '台词', legendAct: '动作', legendBand: '目标区间',
    unitLines: '句', unitSec: '秒',
    castMeta: (count, chars, sec) => `${count} 句 · ${chars} 字 · 约 ${sec} 秒`,
    castProps: (c, p) => (p ? `人物：${c}　道具：${p}` : `人物：${c}`),
    sep: '、',
    colon: '：',
    paren: (s) => `（${s}）`,
    colophon: '剧本由模型依据大纲与美术设定生成，时长与引用由脚本确定性检查。分镜与首帧提示词是下一层的事，不在本报告里。',
  },
  en: {
    langCode: 'en',
    kicker: 'Script',
    docTitle: (s, a, b) => `${s} · Script${a === b ? ` (Episode ${a})` : ` (Episodes ${a}–${b})`}`,
    epHead: (n) => `Episode ${n}`,
    epRange: (a, b) => (a === b ? `Episode ${a}` : `Episodes ${a}–${b}`),
    exportJson: 'Export JSON',
    gates: 'Quality gates',
    gatesPass: 'All passed',
    gatesFail: (n) => `${n} failed`,
    gatePill: (okN, total) => `Quality gates ${okN} / ${total}`,
    kpi: {
      eps: 'Episodes', epsSub: (sc) => `${sc} scenes`,
      time: 'Estimated runtime', timeSub: (t) => `target ${t}`,
      lines: 'Lines', linesSub: (sec) => `~${sec}s of dialogue`,
      dlgRatio: 'Dialogue ratio', dlgRatioSub: 'the rest is picture and action',
      avgScene: 'Avg per scene', avgSceneSub: 'scene changes are a statistic, not a gate — AI scene changes are free',
    },
    secTiming: 'Duration gauge',
    secScript: 'Episode scripts',
    secSceneTable: 'Scene table',
    secCastLines: 'Line book',
    secGates: 'Quality gates',
    timingNote: (tol) => `green band = target ±${tol}%; dialogue at reading speed, action per beat`,
    scriptNote: 'two episodes per row · tall scene areas clip, expand to see all',
    sceneTableNote: 'computed, never hand-written',
    castLinesNote: 'grouped by character · lists show 6 rows and scroll · feeds straight into batch TTS',
    hookLabel: 'Cold open hook',
    hookAt: (sc, b) => `lands at scene ${sc}, beat ${b}`,
    voiceBtn: 'Voice prompt',
    cliffLabel: 'Cliffhanger',
    beatsLabel: 'Beats claimed',
    estLabel: (est, target) => `est. ${est}s / target ${target}s`,
    sceneHead: (i) => `Scene ${i}`,
    voLabel: 'V.O.',
    lightingLabel: 'Lighting',
    showScenes: '▾ Show all scenes',
    hideScenes: '▴ Collapse scenes',
    sceneCols: ['Ep', 'Scene', 'Setting', 'Lighting', 'Cast', 'Lines', 'Est. sec'],
    castCols: ['Character', 'Lines', 'Chars', 'Est. seconds'],
    copyAllLines: 'Copy all lines',
    copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed',
    lineRef: (ep, i) => `E${String(ep).padStart(2, '0')} scene ${i}`,
    dlgSec: (s) => `${s}s`,
    fmtMin: (m, s) => `${m}m ${s}s`,
    overBy: (s) => `${s}s over`,
    underBy: (s) => `${s}s under`,
    legendDlg: 'Dialogue', legendAct: 'Action', legendBand: 'Target band',
    unitLines: 'lines', unitSec: 's',
    castMeta: (count, chars, sec) => `${count} lines · ${chars} chars · ~${sec}s`,
    castProps: (c, p) => (p ? `Cast: ${c} · Props: ${p}` : `Cast: ${c}`),
    sep: ', ',
    colon: ': ',
    paren: (s) => ` (${s})`,
    colophon: 'Script written by the model against the outline and art bible; durations and references checked deterministically by script. Storyboarding and first-frame prompts belong to the next layer, not this report.',
  },
  th: {
    langCode: 'th',
    kicker: 'บทภาพยนตร์',
    docTitle: (s, a, b) => `${s} · บทภาพยนตร์${a === b ? ` (ตอนที่ ${a})` : ` (ตอนที่ ${a}–${b})`}`,
    epHead: (n) => `ตอนที่ ${n}`,
    epRange: (a, b) => (a === b ? `ตอนที่ ${a}` : `ตอนที่ ${a}–${b}`),
    exportJson: 'ส่งออก JSON',
    gates: 'เกณฑ์คุณภาพ',
    gatesPass: 'ผ่านทั้งหมด',
    gatesFail: (n) => `ไม่ผ่าน ${n} รายการ`,
    gatePill: (okN, total) => `เกณฑ์คุณภาพ ${okN} / ${total}`,
    kpi: {
      eps: 'จำนวนตอน', epsSub: (sc) => `${sc} ฉาก`,
      time: 'เวลารวมโดยประมาณ', timeSub: (t) => `เป้าหมาย ${t}`,
      lines: 'บทพูด', linesSub: (sec) => `บทพูดประมาณ ${sec} วินาที`,
      dlgRatio: 'สัดส่วนบทพูด', dlgRatioSub: 'ส่วนที่เหลือคือภาพและการกระทำ',
      avgScene: 'เฉลี่ยต่อฉาก', avgSceneSub: 'จำนวนครั้งที่เปลี่ยนฉากเป็นสถิติ ไม่ใช่เกณฑ์',
    },
    secTiming: 'มาตรวัดเวลา',
    secScript: 'บทภาพยนตร์แยกตามตอน',
    secSceneTable: 'ตารางฉาก',
    secCastLines: 'สมุดบทพูด',
    secGates: 'เกณฑ์คุณภาพ',
    timingNote: (tol) => `แถบสีเขียว = เป้าหมาย ±${tol}%; บทพูดคำนวณตามความเร็ว ส่วนการกระทำคำนวณตามจังหวะ`,
    scriptNote: 'สองตอนต่อแถว · ฉากที่ยาวจะย่อไว้ กดเพื่อดูทั้งหมด',
    sceneTableNote: 'สรุปอัตโนมัติ · โมเดลไม่ต้องเขียน',
    castLinesNote: 'จัดกลุ่มตามตัวละคร · เลื่อนได้เมื่อเกิน 6 แถว · พร้อมใช้กับ TTS แบบชุด',
    hookLabel: 'จุดดึงความสนใจตอนเปิด',
    hookAt: (sc, b) => `เกิดในฉาก ${sc} จังหวะ ${b}`,
    voiceBtn: 'พรอมป์เสียง',
    cliffLabel: 'จุดค้างท้ายตอน',
    beatsLabel: 'จังหวะสำคัญที่รับช่วง',
    estLabel: (est, target) => `ประมาณ ${est} วินาที / เป้าหมาย ${target} วินาที`,
    sceneHead: (i) => `ฉาก ${i}`,
    voLabel: 'เสียงบรรยาย',
    lightingLabel: 'แสง',
    showScenes: '▾ แสดงฉากทั้งหมด',
    hideScenes: '▴ ย่อฉาก',
    sceneCols: ['ตอน', 'ฉาก', 'สถานที่', 'แสง', 'ตัวละคร', 'จำนวนบทพูด', 'เวลาประมาณ'],
    castCols: ['ตัวละคร', 'จำนวนบทพูด', 'อักขระ', 'เวลาประมาณ'],
    copyAllLines: 'คัดลอกบทพูดทั้งหมด',
    copy: 'คัดลอก', copied: 'คัดลอกแล้ว', copyFailed: 'คัดลอกไม่สำเร็จ',
    lineRef: (ep, i) => `E${String(ep).padStart(2, '0')} ฉาก ${i}`,
    dlgSec: (s) => `${s} วินาที`,
    fmtMin: (m, s) => `${m} นาที ${s} วินาที`,
    overBy: (s) => `เกิน ${s} วินาที`,
    underBy: (s) => `ขาด ${s} วินาที`,
    legendDlg: 'บทพูด', legendAct: 'การกระทำ', legendBand: 'ช่วงเป้าหมาย',
    unitLines: 'ประโยค', unitSec: 'วินาที',
    castMeta: (count, chars, sec) => `${count} ประโยค · ${chars} อักขระ · ประมาณ ${sec} วินาที`,
    castProps: (c, p) => (p ? `ตัวละคร: ${c} · อุปกรณ์: ${p}` : `ตัวละคร: ${c}`),
    sep: ', ',
    colon: ': ',
    paren: (s) => ` (${s})`,
    colophon: 'โมเดลเขียนบทจากโครงเรื่องและคู่มืองานศิลป์ โดยสคริปต์ตรวจเวลาและการอ้างอิงแบบกำหนดแน่นอน งานสตอรีบอร์ดและพรอมป์ภาพแรกอยู่ในขั้นตอนถัดไป',
  },
};

export const tOf = (lang) => {
  if (lang && !I18N[lang]) throw new Error('报告界面语言目前内置 zh / th / en');
  return I18N[lang ?? 'zh'];
};

/* ------------------------------------------------------------------ */
/* render — markdown                                                   */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const mdRow = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
const mdHead = (cols) => [mdRow(cols), mdRow(cols.map(() => '---'))].join('\n');

/** 显示名：给了上游映射就用名字，否则裸 ID。 */
function namer(ctx = {}, t = tOf()) {
  const charName = new Map((ctx.outline?.characters ?? []).map((c) => [c.id, c.name]));
  const sceneName = new Map((ctx.art?.scenes ?? []).map((s) => [s.id, s.name]));
  const propName = new Map((ctx.art?.props ?? []).map((p) => [p.id, p.name]));
  const voiceByName = new Map((ctx.cast?.characters ?? []).map((c) => [c.name, c?.voice?.prompt ?? '']));
  return {
    char: (id) => (id === 'VO' ? t.voLabel : charName.get(id) ?? id),
    scene: (id) => sceneName.get(id) ?? id,
    prop: (id) => propName.get(id) ?? id,
    // 台词本对接 TTS：给了 --cast 才有音色提示词（按 outline 名字对上 cast）
    voice: (id) => voiceByName.get(charName.get(id) ?? '') ?? '',
  };
}

/** 界面语言：--lang > script.json 顶层 lang 字段 > zh。 */
const langOf = (doc, ctx) => ctx?.lang ?? doc?.lang ?? 'zh';

export function renderMarkdown(doc, ctx = {}) {
  const t = tOf(langOf(doc, ctx));
  const n = namer(ctx, t);
  const stats = computeStats(doc);
  const eps = doc.episodes;
  const first = eps[0]?.ep;
  const last = eps[eps.length - 1]?.ep;
  const out = [`# ${t.docTitle(doc.source, first, last)}`, ''];

  for (const [i, ep] of eps.entries()) {
    const st = stats.episodes[i];
    out.push(`## ${t.epHead(ep.ep)}`, '');
    out.push(`> ${t.estLabel(st.est, ep.targetSeconds)} · ${t.hookLabel}${t.colon}${ep.hook}${Array.isArray(ep.hookBeat) ? t.paren(t.hookAt(ep.hookBeat[0], ep.hookBeat[1])) : ''} · ${t.cliffLabel}${t.colon}${ep.cliff}`);
    if (ep.beatsClaimed.length) out.push(`> ${t.beatsLabel}${t.colon}${ep.beatsClaimed.join(t.sep)}`);
    out.push('');
    ep.scenes.forEach((sc, idx) => {
      out.push(`### ${t.sceneHead(idx + 1)} · ${n.scene(sc.sceneId)}${sc.lighting ? t.paren(sc.lighting) : ''}`, '');
      if (sc.characters.length) out.push(t.castProps(sc.characters.map(n.char).join(t.sep), sc.props?.length ? sc.props.map(n.prop).join(t.sep) : ''), '');
      for (const b of sc.flow) {
        if (typeof b.action === 'string') out.push(b.action, '');
        else out.push(`**${n.char(b.speaker)}**${b.delivery ? t.paren(b.delivery) : ''}${t.colon}${b.line}`, '');
      }
    });
  }

  out.push('---', '', `## ${t.secSceneTable}`, '', mdHead(t.sceneCols));
  for (const row of stats.sceneTable) {
    out.push(mdRow([row.ep, row.index, n.scene(row.sceneId), row.lighting, row.characters.map(n.char).join(t.sep), row.lineCount, row.estSeconds]));
  }
  out.push('', `## ${t.secCastLines}`, '', mdHead(t.castCols));
  for (const c of stats.castLines) {
    out.push(mdRow([n.char(c.id), c.count, c.chars, r1(c.chars / stats.params.charsPerSecond)]));
  }
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* render — html                                                       */
/* ------------------------------------------------------------------ */
/*
 * 与另外三份报告同一套视觉语言：冷灰印张 + 铁锈红印记，1600 宽，
 * 零外部依赖。设计约定见 references/report-style.md。
 */

function embedDoc(doc) {
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

export function renderHtml(doc, ctx = {}) {
  const lang = langOf(doc, ctx);
  const t = tOf(lang);
  const n = namer(ctx, t);
  const stats = computeStats(doc);
  const gates = gateReport(doc, ctx);
  const failed = gates.filter((g) => !g.ok);
  const eps = doc.episodes;
  const first = eps[0]?.ep;
  const last = eps[eps.length - 1]?.ep;
  const tolPct = Math.round(stats.params.tolerance * 100);

  const fmtMin = (sec) => t.fmtMin(Math.floor(sec / 60), Math.round(sec % 60));
  const dlgRatio = stats.totals.estSeconds ? Math.round((stats.totals.dialogueSeconds / stats.totals.estSeconds) * 100) : 0;
  const avgScene = stats.totals.scenes ? r1(stats.totals.estSeconds / stats.totals.scenes) : 0;

  // ---- 时长仪表：每集一行，目标区间画成绿带，台词/动作堆叠 ----
  const scaleMax = Math.max(...stats.episodes.map((e) => Math.max(e.est, (e.target ?? 0) * (1 + stats.params.tolerance)))) * 1.08;
  const timingRows = stats.episodes
    .map((e) => {
      const lo = e.target * (1 - stats.params.tolerance);
      const hi = e.target * (1 + stats.params.tolerance);
      const inBand = e.est >= lo && e.est <= hi;
      const pct = (v) => `${r1((v / scaleMax) * 100)}%`;
      const status = inBand ? '' : ` <b class="over">${esc(e.est > hi ? t.overBy(r1(e.est - hi)) : t.underBy(r1(lo - e.est)))}</b>`;
      return `<div class="trow">
  <span class="tep">E${String(e.ep).padStart(2, '0')}</span>
  <div class="track">
    <span class="band" style="left:${pct(lo)};width:${pct(hi - lo)}"></span>
    <span class="fill dlg" style="width:${pct(e.dialogueSeconds)}"></span>
    <span class="fill act" style="left:${pct(e.dialogueSeconds)};width:${pct(e.actionSeconds)}"></span>
  </div>
  <span class="tval${inBand ? ' okc' : ''}">${e.est}s / ${e.target}s${status}</span>
</div>`;
    })
    .join('\n');

  // ---- 分集剧本 ----
  const epBlocks = eps
    .map((ep, i) => {
      const st = stats.episodes[i];
      const scenesHtml = ep.scenes
        .map((sc, idx) => {
          const flow = sc.flow
            .map((b, bi) => {
              const hooked = Array.isArray(ep.hookBeat) && ep.hookBeat[0] === idx + 1 && ep.hookBeat[1] === bi + 1;
              const hk = hooked ? ' hooked' : '';
              return typeof b.action === 'string'
                ? `<p class="act-line${hk}"${hooked ? ` title="${esc(t.hookLabel)}"` : ''}>${esc(b.action)}</p>`
                : `<div class="dlg-line${hk}"><span class="who">${esc(n.char(b.speaker))}${b.delivery ? `<i>${esc(b.delivery)}</i>` : ''}</span><span class="said">${esc(b.line)}</span><button class="copy mini" data-copy="${esc(b.line)}">${esc(t.copy)}</button></div>`;
            })
            .join('\n');
          return `<section class="scene-blk">
  <header class="scene-h">
    <b>${esc(t.sceneHead(idx + 1))}</b>
    <span class="chip">${esc(sc.sceneId)} ${esc(n.scene(sc.sceneId))}</span>
    ${sc.lighting ? `<span class="chip lite">${esc(t.lightingLabel)} · ${esc(sc.lighting)}</span>` : ''}
    ${sc.characters.map((id) => `<span class="chip">${esc(n.char(id))}</span>`).join('')}
    ${(sc.props ?? []).map((id) => `<span class="chip prop">${esc(n.prop(id))}</span>`).join('')}
  </header>
  ${flow}
</section>`;
        })
        .join('\n');
      return `<article class="ep" id="ep-${ep.ep}">
  <header class="ep-h">
    <span class="ep-n">E${String(ep.ep).padStart(2, '0')}</span>
    <span class="ep-est">${esc(t.estLabel(st.est, ep.targetSeconds))}</span>
    ${ep.beatsClaimed.map((b) => `<i class="bt">${esc(b)}</i>`).join('')}
  </header>
  <div class="hk"><b>${esc(t.hookLabel)}</b><span>${esc(ep.hook)}${Array.isArray(ep.hookBeat) ? ` <i class="hookat">${esc(t.hookAt(ep.hookBeat[0], ep.hookBeat[1]))}</i>` : ''}</span></div>
  <div class="scenes clip">
  ${scenesHtml}
  </div>
  <button class="scmore">${esc(t.showScenes)}</button>
  <div class="hk cliff"><b>${esc(t.cliffLabel)}</b><span>${esc(ep.cliff)}</span></div>
</article>`;
    })
    .join('\n');

  // ---- 场次总表 / 台词本 ----
  const table = (cols, rows) =>
    `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}</tbody></table>`;

  const sceneRows = stats.sceneTable.map((row) => [
    String(row.ep), String(row.index), esc(`${row.sceneId} ${n.scene(row.sceneId)}`), esc(row.lighting),
    esc(row.characters.map(n.char).join(t.sep)), String(row.lineCount), String(row.estSeconds),
  ]);

  const castBlocks = stats.castLines
    .map((c) => {
      const allText = c.lines.map((l) => l.line).join('\n');
      return `<section class="cast-blk">
  <header class="cast-h">
    <b>${esc(n.char(c.id))}</b>
    <span class="cast-meta">${esc(t.castMeta(c.count, c.chars, r1(c.chars / stats.params.charsPerSecond)))}</span>
    ${n.voice(c.id) ? `<button class="copy" data-copy="${esc(n.voice(c.id))}">${esc(t.voiceBtn)}</button>` : ''}
    <button class="copy" data-copy="${esc(allText)}">${esc(t.copyAllLines)}</button>
  </header>
  <ol class="cast-lines">${c.lines.map((l) => `<li><i>${esc(t.lineRef(l.ep, l.sceneIndex))}</i><span>${esc(l.line)}</span>${l.delivery ? `<em>${esc(l.delivery)}</em>` : ''}</li>`).join('')}</ol>
</section>`;
    })
    .join('\n');

  const gateList = `<ul class="gate">
  ${gates
    .map(
      (g) => `<li class="${g.ok ? 'ok' : 'bad'}"><span class="m">${g.ok ? '✓' : '✗'}</span><span>${esc(gateText(g, t.langCode).label)}${
        (!g.ok && g.detail) || (g.ok && g.detail.includes('跳过')) ? `<small>${esc(gateText(g, t.langCode).detail)}</small>` : ''
      }</span></li>`,
    )
    .join('\n  ')}
</ul>`;

  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.docTitle(doc.source, first, last))}</title>
<style>
:root{
  --paper:#eceded; --panel:#f5f6f5; --side:#e4e6e3; --ink:#191d21; --ink-2:#5b636a; --ink-3:#8c9298;
  --rule:#d2d5d0; --rule-2:#c2c6bf; --seal:#8a3324; --seal-2:#c56a4e; --seal-soft:#8a332412; --ok:#3d6b4f;
  --band:#3d6b4f22;
  --serif:"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html:lang(th) .hd h1,html:lang(th) .kpi .l,html:lang(th) .sec-h h2,html:lang(th) .scmore,html:lang(th) .ep-n,html:lang(th) .hk b,html:lang(th) .scene-h b,html:lang(th) th,html:lang(th) .cast-h b{letter-spacing:normal}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.7 var(--sans);-webkit-font-smoothing:antialiased}
.page{max-width:1600px;margin:0 auto;padding:24px 32px 90px}
h1,h2,h3{margin:0;font-weight:400}

.hd{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:12px}
.hd h1{font:400 28px/1.1 var(--serif);letter-spacing:.06em}
.hd .sub{font-size:13px;color:var(--ink-2)}
.hd .right{margin-left:auto;display:flex;align-items:center;gap:10px}
.gatepill{display:inline-flex;align-items:center;gap:6px;font:500 12px/1 var(--sans);border-radius:99px;padding:6px 12px}
.gatepill.pass{color:var(--ok);border:1px solid var(--ok)}
.gatepill.fail{color:var(--seal);border:1px solid var(--seal);background:var(--seal-soft)}
.expo{font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--panel);
  border:1px solid var(--rule-2);border-radius:2px;padding:7px 11px;cursor:pointer;transition:.15s}
.expo:hover{border-color:var(--seal);color:var(--seal)}
.expo:focus-visible{outline:2px solid var(--seal);outline-offset:2px}

.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0 6px}
@media(max-width:980px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:11px 14px 9px}
.kpi .l{font:500 10px/1 var(--sans);letter-spacing:.18em;color:var(--ink-3)}
.kpi .v{font:400 28px/1.15 var(--serif);margin-top:5px}
.kpi .v small{font:400 14px var(--serif);color:var(--ink-2)}
.kpi .d{font-size:11px;color:var(--ink-2);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kpi.accent{border-top:2px solid var(--seal)}
.galert{margin:14px 0 0;border:1px solid var(--seal);background:var(--seal-soft);border-radius:2px;
  padding:10px 14px;font-size:13px}
.galert b{color:var(--seal)}
.galert span{display:block;font-size:12px;color:var(--ink-2)}

section.top-sec{margin-top:34px}
.sec-h{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule-2);padding-bottom:8px;margin-bottom:16px}
.sec-h .no{font:500 12px/1 var(--mono);color:var(--seal)}
.sec-h h2{font:400 20px/1.2 var(--serif);letter-spacing:.05em}
.sec-h .note{margin-left:auto;font-size:12px;color:var(--ink-3)}

/* duration gauge */
.timing{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:16px 20px 10px}
.trow{display:grid;grid-template-columns:44px minmax(0,1fr) 220px;gap:12px;align-items:center;padding:5px 0}
.tep{font:500 12px/1 var(--mono);color:var(--ink-2)}
.track{position:relative;height:18px;background:var(--paper);border:1px solid var(--rule);border-radius:2px;overflow:hidden}
.band{position:absolute;top:0;bottom:0;background:var(--band)}
.fill{position:absolute;top:2px;bottom:2px;border-radius:1px}
.fill.dlg{left:0;background:var(--seal)}
.fill.act{background:var(--seal-2)}
.tval{font:500 12px/1.5 var(--sans);color:var(--ink-2)}
.tval.okc{color:var(--ok)}
.tval .over{color:var(--seal);font-weight:600}
.legend{display:flex;gap:18px;font-size:12px;color:var(--ink-2);margin:8px 0 2px}
.legend i{font-style:normal;display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px}

/* episode scripts: two per row; scene area clips at 300px with a fade, expandable */
.eps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.eps.solo{grid-template-columns:minmax(0,1fr)}
@media(max-width:1100px){.eps{grid-template-columns:minmax(0,1fr)}}
.ep{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:18px 22px}
.scenes{position:relative}
.scenes.clip{max-height:300px;overflow:hidden}
.scenes.clip::after{content:'';position:absolute;left:0;right:0;bottom:0;height:70px;
  background:linear-gradient(180deg,transparent,var(--panel));pointer-events:none}
.scmore{display:block;width:100%;margin-top:8px;font:500 11.5px/1 var(--sans);letter-spacing:.06em;
  color:var(--ink-2);background:var(--paper);border:1px solid var(--rule-2);border-radius:2px;
  padding:7px 0;cursor:pointer;transition:.15s}
.scmore:hover{border-color:var(--seal);color:var(--seal)}
.scmore:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.ep-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--rule-2);padding-bottom:10px}
.ep-n{font:400 22px/1 var(--serif);letter-spacing:.04em;color:var(--seal)}
.ep-est{font-size:12.5px;color:var(--ink-2)}
.bt{font-style:normal;font-size:11px;padding:2px 8px;border:1px solid var(--seal);border-radius:99px;color:var(--seal)}
.hk{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:10px;font-size:13px;padding:10px 0;border-bottom:1px solid var(--rule)}
.hk.cliff{border-bottom:0;border-top:1px solid var(--rule)}
.hk b{font:500 11px/1.9 var(--sans);letter-spacing:.14em;color:var(--seal);white-space:nowrap}
.scene-blk{margin-top:14px}
.scene-h{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;margin-bottom:8px}
.scene-h b{font:500 13px var(--serif);letter-spacing:.06em}
.chip{font:400 10.5px/1.6 var(--mono);border:1px solid var(--rule-2);border-radius:2px;
  padding:0 6px;background:var(--paper);color:var(--ink-2)}
.chip.lite{border-color:var(--seal-2);color:var(--seal-2)}
.chip.prop{border-color:var(--seal);color:var(--seal)}
.act-line{margin:8px 0;font:400 13.5px/1.9 var(--sans);color:var(--ink-2)}
.act-line.hooked,.dlg-line.hooked{border-left:2px solid var(--seal);padding-left:10px;background:var(--seal-soft)}
.hookat{font-style:normal;font-size:11px;padding:1px 8px;border:1px solid var(--seal);border-radius:99px;color:var(--seal);margin-left:8px;white-space:nowrap}
.dlg-line{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:12px;align-items:baseline;
  padding:5px 0 5px 10px;border-left:2px solid var(--rule-2)}
.dlg-line:hover{border-left-color:var(--seal)}
.who{font:500 13px/1.6 var(--serif)}
.who i{display:block;font:400 11px var(--sans);color:var(--ink-3);font-style:normal}
.said{font:400 14.5px/1.8 var(--serif)}
.dlg-line .copy{opacity:0;transition:.15s}
.dlg-line:hover .copy{opacity:1}

/* tables */
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-size:13px}
th,td{padding:8px 12px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font:500 11px/1 var(--sans);letter-spacing:.1em;color:var(--ink-3);background:var(--side)}
tr:last-child td{border-bottom:0}
td:first-child{font-family:var(--mono);font-size:12px;color:var(--ink-2);white-space:nowrap}

/* line book: two per row; lists capped at 6 rows, scroll vertically */
.casts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
@media(max-width:1100px){.casts{grid-template-columns:minmax(0,1fr)}}
.cast-blk{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:14px 18px}
.cast-h{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule-2);padding-bottom:8px}
.cast-h b{font:400 17px/1.2 var(--serif);letter-spacing:.04em}
.cast-meta{font-size:12px;color:var(--ink-2)}
.cast-h .copy{margin-left:auto}
.cast-lines{margin:8px 0 0;padding:0 6px 0 0;list-style:none;max-height:186px;overflow-y:auto;
  scrollbar-width:thin;scrollbar-color:var(--rule-2) transparent}
.cast-lines::-webkit-scrollbar{width:6px}
.cast-lines::-webkit-scrollbar-thumb{background:var(--rule-2);border-radius:3px}
.cast-lines li{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:12px;align-items:baseline;
  padding:4.5px 0;border-top:1px solid var(--rule);font-size:13px}
.cast-lines li:first-child{border-top:0}
.cast-lines i{font:400 11px/1.8 var(--mono);color:var(--ink-3);font-style:normal}
.cast-lines span{font-family:var(--serif)}
.cast-lines em{font-style:normal;font-size:11.5px;color:var(--ink-3)}

.copy{flex:none;font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--paper);
  border:1px solid var(--rule-2);border-radius:2px;padding:4px 10px;cursor:pointer;transition:.15s}
.copy:hover{border-color:var(--seal);color:var(--seal)}
.copy:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.copy[data-done]{border-color:var(--seal);color:var(--seal)}
.copy.mini{padding:2px 7px;font-size:10.5px}

.gate{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:2px 28px}
@media(max-width:900px){.gate{grid-template-columns:1fr}}
.gate li{display:flex;gap:8px;padding:5px 0;font-size:12.5px;line-height:1.55}
.gate .m{flex:none;font-weight:700}
.gate li.ok .m{color:var(--ok)}
.gate li.bad .m{color:var(--seal)}
.gate li.bad{background:var(--seal-soft);border-radius:2px;padding-left:6px}
.gate small{display:block;color:var(--ink-3)}
.gsum{margin:10px 0 0;font-size:12px;color:var(--ink-2)}
.gsum b{color:var(--seal)}

.foot{margin-top:40px;font-size:11px;color:var(--ink-3);border-top:1px solid var(--rule);padding-top:14px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{
  .expo,.copy,.scmore{display:none!important}
  .scenes.clip{max-height:none}
  .scenes.clip::after{display:none}
  .cast-lines{max-height:none;overflow:visible}
  .eps,.casts{grid-template-columns:minmax(0,1fr)}
  .page{max-width:none;padding:0}
  section.top-sec,.ep,.cast-blk{page-break-inside:avoid}
  body{background:#fff}
}
</style></head><body>
<div class="page">

<header class="hd">
  <h1>${esc(doc.source)}</h1>
  <span class="sub">${esc(t.kicker)} · ${esc(t.epRange(first, last))}</span>
  <span class="right">
    <span class="gatepill ${failed.length ? 'fail' : 'pass'}">${failed.length ? '✗' : '✓'} ${esc(t.gatePill(gates.length - failed.length, gates.length))}</span>
    <button class="expo" data-name="${esc(slug(doc.source))}-script.json">${esc(t.exportJson)}</button>
  </span>
</header>

<div class="kpis">
  <div class="kpi accent"><div class="l">${esc(t.kpi.eps)}</div><div class="v">${stats.totals.episodes}</div><div class="d">${esc(t.kpi.epsSub(stats.totals.scenes))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.time)}</div><div class="v">${esc(fmtMin(stats.totals.estSeconds))}</div><div class="d">${esc(t.kpi.timeSub(fmtMin(stats.totals.targetSeconds)))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.lines)}</div><div class="v">${stats.totals.lines} <small>${esc(t.unitLines)}</small></div><div class="d">${esc(t.kpi.linesSub(stats.totals.dialogueSeconds))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.dlgRatio)}</div><div class="v">${dlgRatio}<small>%</small></div><div class="d">${esc(t.kpi.dlgRatioSub)}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.avgScene)}</div><div class="v">${avgScene} <small>${esc(t.unitSec)}</small></div><div class="d">${esc(t.kpi.avgSceneSub)}</div></div>
</div>
${failed.length ? `<div class="galert"><b>✗ ${esc(t.gatesFail(failed.length))}</b>${failed.map((g) => `<span>${esc(gateText(g, t.langCode).label)}${g.detail ? ` — ${esc(gateText(g, t.langCode).detail)}` : ''}</span>`).join('')}</div>` : ''}

<section class="top-sec" id="sec-timing">
  <div class="sec-h"><span class="no">01</span><h2>${esc(t.secTiming)}</h2><span class="note">${esc(t.timingNote(tolPct))}</span></div>
  <div class="timing">
    <div class="legend">
      <i><span class="sw" style="background:var(--seal)"></span>${esc(t.legendDlg)}</i>
      <i><span class="sw" style="background:var(--seal-2)"></span>${esc(t.legendAct)}</i>
      <i><span class="sw" style="background:var(--band)"></span>${esc(t.legendBand)}</i>
    </div>
${timingRows}
  </div>
</section>

<section class="top-sec" id="sec-script">
  <div class="sec-h"><span class="no">02</span><h2>${esc(t.secScript)}</h2><span class="note">${eps.length > 1 ? esc(t.scriptNote) : ''}</span></div>
  <div class="eps${eps.length > 1 ? '' : ' solo'}">
${epBlocks}
  </div>
</section>

<section class="top-sec" id="sec-scenes">
  <div class="sec-h"><span class="no">03</span><h2>${esc(t.secSceneTable)}</h2><span class="note">${esc(t.sceneTableNote)}</span></div>
  ${table(t.sceneCols, sceneRows)}
</section>

<section class="top-sec" id="sec-cast">
  <div class="sec-h"><span class="no">04</span><h2>${esc(t.secCastLines)}</h2><span class="note">${esc(t.castLinesNote)}</span></div>
  <div class="casts">
${castBlocks}
  </div>
</section>

<section class="top-sec" id="sec-gates">
  <div class="sec-h"><span class="no">05</span><h2>${esc(t.secGates)}</h2></div>
  ${gateList}
  <p class="gsum">${failed.length ? `<b>${esc(t.gatesFail(failed.length))}</b>` : esc(t.gatesPass)}</p>
</section>

<p class="foot">${esc(t.colophon)}</p>
</div>

<script type="application/json" id="script-data">${embedDoc(doc)}</script>
<script>
const L = ${JSON.stringify({ copied: t.copied, failed: t.copyFailed, show: t.showScenes, hide: t.hideScenes })};

// episode scripts: scene areas clip at 300px; short ones unclip, tall ones toggle
document.querySelectorAll('.scmore').forEach((btn) => {
  const zone = btn.previousElementSibling;
  if (zone.scrollHeight <= 320) {
    zone.classList.remove('clip');
    btn.remove();
    return;
  }
  btn.addEventListener('click', () => {
    const clipped = zone.classList.toggle('clip');
    btn.textContent = clipped ? L.show : L.hide;
    if (clipped) zone.closest('.ep').scrollIntoView({ block: 'nearest' });
  });
});

// copy buttons (a single line / a character's whole line book)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  e.preventDefault();
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    btn.textContent = L.copied;
    btn.dataset.done = '1';
  } catch {
    btn.textContent = L.failed;
  }
  setTimeout(() => { btn.textContent = label; delete btn.dataset.done; }, 1600);
});

// export: the report carries the full script.json; the download is it verbatim
document.querySelector('.expo').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const url = URL.createObjectURL(
    new Blob([document.getElementById('script-data').textContent], { type: 'application/json' }),
  );
  const a = Object.assign(document.createElement('a'), { href: url, download: btn.dataset.name });
  a.click();
  // don't revoke right away — Safari kills the blob before the download finishes reading it
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `novel-script.mjs — novel-script skill 的确定性工具（剧本）

  seed <outline.json> [--eps 1-6]           从大纲预填每集骨架（打印到 stdout）
  validate <script.json> [--outline o.json] 校验；有违规逐条打印并 exit 1
           [--art a.json]                   给了上游才做对账（角色 / 场景光照道具 / 爽点认领）
  checkup <script.json> [--outline] [--art] 只打印质量门 ✓/✗，有未过项 exit 1
  render <script.json> [--html|--md]        渲染报告到 stdout（默认 --md）
         [--lang zh|th|en]                  报告界面语言（默认中文，或跟 script.json 的 lang 字段）
         [--outline o.json] [--art a.json]  给了上游就把 ID 显示成名字
         [--cast cast.json]                 台词本带每个角色的音色提示词（对接 TTS）
  slug <name>                               剧名转安全文件名`;

const CLI_TEXT = {
  zh: {
    usage: USAGE,
    noOutline: '⚠️ 没给 --outline，跳过角色引用与爽点认领检查',
    noArt: '⚠️ 没给 --art，跳过场景／光照／道具对账',
    summary: (n) => n ? `\n✗ ${n} 项未过` : '\n✓ 全部通过',
    failed: (n) => `✗ ${n} 处违规：\n`,
    passed: (s) => `✓ ${s.totals.episodes} 集 / ${s.totals.scenes} 场 / ${s.totals.lines} 句台词全部通过校验（预估 ${s.totals.estSeconds}s / 目标 ${s.totals.targetSeconds}s）`,
    range: '--eps 形如 3 或 1-6', unknown: (cmd) => `未知命令 ${cmd}`,
  },
  th: {
    usage: `novel-script.mjs — เครื่องมือตรวจและเรนเดอร์บท\n\n  seed <outline.json> [--eps 1-6] [--lang th]\n  validate <script.json> [--outline o.json] [--art a.json] [--lang th]\n  checkup <script.json> [--outline o.json] [--art a.json] [--lang th]\n  render <script.json> [--html|--md] [--lang th] [--outline o.json] [--art a.json] [--cast cast.json]\n  slug <name>`,
    noOutline: '⚠️ ไม่ได้ระบุ --outline จึงข้ามการตรวจตัวละครและจังหวะสำคัญจากโครงเรื่อง',
    noArt: '⚠️ ไม่ได้ระบุ --art จึงข้ามการตรวจฉาก แสง และอุปกรณ์ประกอบฉาก',
    summary: (n) => n ? `\n✗ ไม่ผ่าน ${n} ข้อ` : '\n✓ ผ่านทั้งหมด',
    failed: (n) => `✗ พบข้อผิดพลาด ${n} รายการ:\n`,
    passed: (s) => `✓ ผ่านการตรวจสอบทั้งหมด: ${s.totals.episodes} ตอน / ${s.totals.scenes} ฉาก / ${s.totals.lines} ประโยค (ประมาณ ${s.totals.estSeconds}s / เป้าหมาย ${s.totals.targetSeconds}s)`,
    range: '--eps ต้องมีรูปแบบ 3 หรือ 1-6', unknown: (cmd) => `ไม่รู้จักคำสั่ง ${cmd}`,
  },
  en: {
    usage: `novel-script.mjs — deterministic script tools\n\n  seed <outline.json> [--eps 1-6] [--lang en]\n  validate <script.json> [--outline o.json] [--art a.json] [--lang en]\n  checkup <script.json> [--outline o.json] [--art a.json] [--lang en]\n  render <script.json> [--html|--md] [--lang en] [--outline o.json] [--art a.json] [--cast cast.json]\n  slug <name>`,
    noOutline: '⚠️ No --outline provided; skipping character-reference and outline-beat checks',
    noArt: '⚠️ No --art provided; skipping scene, lighting, and prop reconciliation',
    summary: (n) => n ? `\n✗ ${n} gate(s) failed` : '\n✓ All passed',
    failed: (n) => `✗ ${n} validation error(s):\n`,
    passed: (s) => `✓ Validation passed: ${s.totals.episodes} episode(s) / ${s.totals.scenes} scene(s) / ${s.totals.lines} line(s) (est. ${s.totals.estSeconds}s / target ${s.totals.targetSeconds}s)`,
    range: '--eps must look like 3 or 1-6', unknown: (cmd) => `Unknown command ${cmd}`,
  },
};
const cliFor = (lang) => {
  if (!CLI_TEXT[lang]) throw new Error('界面语言必须是 zh / th / en');
  return CLI_TEXT[lang];
};
const usageError = (lang, command) => {
  const args = command === 'seed' ? '<outline.json> [--eps 1-6]'
    : command === 'slug' ? '<name>'
      : command === 'render' ? '<script.json> [--html|--md] [--lang zh|th|en] [--outline o.json] [--art a.json]'
        : '<script.json> [--outline o.json] [--art a.json]';
  return lang === 'th' ? `วิธีใช้: ${command} ${args}` : lang === 'en' ? `Usage: ${command} ${args}` : `用法：${command} ${args}`;
};
export const problemText = (message, lang) => {
  if (lang === 'zh') return message;
  const pairs = lang === 'th'
    ? [['script.json 不是对象', 'script.json ต้องเป็นอ็อบเจ็กต์'], ['缺少 source（剧名/书名）', 'ขาด source (ชื่อเรื่อง)'], ['只支持', 'รองรับเฉพาะ'], ['实际是', 'ค่าปัจจุบันคือ'], ['episodes 为空', 'episodes ว่าง'], ['必须是正整数', 'ต้องเป็นจำนวนเต็มบวก'], ['集号', 'หมายเลขตอน'], ['重复', 'ซ้ำ'], ['缺 targetSeconds（目标秒数，来自大纲的单集时长）', 'ขาด targetSeconds (ระยะเวลาเป้าหมายจากโครงเรื่อง)'], ['缺 beatsClaimed（认领的爽点，可为空数组）', 'ขาด beatsClaimed (ใช้ [] ได้)'], ['没有场次', 'ไม่มีฉาก'], ['必须是 S01 这种格式', 'ต้องมีรูปแบบ S01'], ['缺 characters（本场人物，空镜给空数组）', 'ขาด characters (ใช้ [] สำหรับฉากว่าง)'], ['的节拍流为空', 'มี flow ว่าง'], ['有节拍既不是动作也不是台词（action 与 line 二选一）', 'มีจังหวะที่ต้องระบุ action หรือ line เพียงอย่างเดียว'], ['有空动作节拍', 'มีจังหวะ action ว่าง'], ['有空台词', 'มี line ว่าง'], ['有台词缺 speaker', 'มี line ที่ขาด speaker'], ['第 ', 'ตอนที่ '], [' 集', ''], ['第 ', 'ฉากที่ '], [' 场', ''], ['的 ep', ' ep']]
    : [['script.json 不是对象', 'script.json must be an object'], ['缺少 source（剧名/书名）', 'Missing source (title)'], ['只支持', 'supports only'], ['实际是', 'actual value is'], ['episodes 为空', 'episodes is empty'], ['必须是正整数', 'must be a positive integer'], ['集号', 'Episode number'], ['重复', 'is duplicated'], ['缺 targetSeconds（目标秒数，来自大纲的单集时长）', 'is missing targetSeconds (episode target from the outline)'], ['缺 beatsClaimed（认领的爽点，可为空数组）', 'is missing beatsClaimed ([] is allowed)'], ['没有场次', 'has no scenes'], ['必须是 S01 这种格式', 'must use the S01 format'], ['缺 characters（本场人物，空镜给空数组）', 'is missing characters (use [] for an empty shot)'], ['的节拍流为空', 'has an empty flow'], ['有节拍既不是动作也不是台词（action 与 line 二选一）', 'has a beat that must contain exactly one of action or line'], ['有空动作节拍', 'has an empty action beat'], ['有空台词', 'has an empty line'], ['有台词缺 speaker', 'has a line without speaker'], ['第 ', 'Episode '], [' 集', ''], ['第 ', 'scene '], [' 场', ''], ['的 ep', ' ep']];
  const translated = pairs.reduce((text, [from, to]) => text.replaceAll(from, to), String(message));
  return translated.replace(/[\u3400-\u9fff]+/g, lang === 'th' ? 'ข้อกำหนด' : 'validation requirement');
};

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function flag(rest, name, fallback = null) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
}
const inputPath = (rest) => rest.find((value, index) =>
  !value.startsWith('--') && !['--lang', '--outline', '--art', '--cast', '--eps'].includes(rest[index - 1]));

function loadCtx(rest) {
  const get = (name) => {
    const path = flag(rest, name);
    return path ? readJson(path) : null;
  };
  return { outline: get('--outline'), art: get('--art'), cast: get('--cast') };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const explicitLang = flag(argv, '--lang', null);
  if (explicitLang) cliFor(explicitLang);

  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(cliFor(explicitLang ?? 'zh').usage);
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === 'seed') {
    const path = inputPath(rest);
    if (!path) throw new Error(usageError(explicitLang ?? 'zh', 'seed'));
    const range = flag(rest, '--eps');
    let epRange = null;
    if (range) {
      const m = String(range).match(/^(\d+)-(\d+)$/) ?? String(range).match(/^(\d+)$/);
      if (!m) throw new Error(cliFor(explicitLang ?? 'zh').range);
      epRange = m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1]), Number(m[1])];
    }
    console.log(JSON.stringify(seedFromOutline(readJson(path), epRange), null, 2));
    return;
  }

  if (cmd === 'validate' || cmd === 'checkup') {
    const path = inputPath(rest);
    if (!path) throw new Error(usageError(explicitLang ?? 'zh', cmd));
    const doc = readJson(path);
    const cliLang = explicitLang ?? doc.lang ?? 'zh';
    const cli = cliFor(cliLang);
    const ctx = loadCtx(rest);
    if (!ctx.outline) console.error(cli.noOutline);
    if (!ctx.art) console.error(cli.noArt);

    if (cmd === 'checkup') {
      const gates = gateReport(doc, ctx);
      for (const g of gates) {
        const shown = gateText(g, cliLang);
        console.log(`${g.ok ? '✓' : '✗'} ${shown.label}${!g.ok && shown.detail ? ` — ${shown.detail}` : ''}`);
      }
      const failedN = gates.filter((g) => !g.ok).length;
      console.log(cli.summary(failedN));
      if (failedN) process.exit(1);
      return;
    }

    const problems = validateScript(doc, ctx);
    if (problems.length) {
      console.error(cli.failed(problems.length));
      const structural = problems.filter((x) => !x.startsWith('质量门未过：'));
      for (const x of structural) console.error('  ' + problemText(x, cliLang));
      for (const g of gateReport(doc, ctx).filter((g) => !g.ok)) {
        const shown = gateText(g, cliLang);
        console.error(`  ${shown.label}${shown.detail ? ` — ${shown.detail}` : ''}`);
      }
      process.exit(1);
    }
    const st = computeStats(doc);
    console.log(cli.passed(st));
    return;
  }

  if (cmd === 'render') {
    const path = inputPath(rest);
    if (!path) throw new Error(usageError(explicitLang ?? 'zh', 'render'));
    const doc = readJson(path);
    const ctx = loadCtx(rest);
    const lang = flag(rest, '--lang');
    if (lang) ctx.lang = lang;
    process.stdout.write((rest.includes('--html') ? renderHtml(doc, ctx) : renderMarkdown(doc, ctx)) + '\n');
    return;
  }

  if (cmd === 'slug') {
    if (!rest[0]) throw new Error(usageError(explicitLang ?? 'zh', 'slug'));
    console.log(slug(rest[0]));
    return;
  }

  const cliLang = explicitLang ?? 'zh';
  const cli = cliFor(cliLang);
  throw new Error(`${cli.unknown(cmd)}\n\n${cli.usage}`);
}

// 软链安装时 argv[1] 是链接路径，两边都取 realpath 才能比得上
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  // `render ... | head` 这类管道提前关闭时安静退出，别甩 EPIPE 堆栈
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0);
    throw e;
  });
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
