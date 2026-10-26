const crypto = require('crypto');

const SYSTEM_LV = `أنت بتقرأ دفتر ميزانية (leveling field book) من صورة أو PDF لمساح مصري. استخرج الجدول زي ما هو مكتوب من غير تخمين أو تصحيح. رد بـ JSON فقط بالشكل ده:
للميزانية الطولية: {"type":"long","bm":{"rl":رقم أو null},"rows":[{"pt":"اسم النقطة","ch":المسافة التراكمية بالمتر أو null,"bs":رقم أو null,"is":رقم أو null,"fs":رقم أو null,"rl":رقم أو null}]}
للميزانية الشبكية: {"type":"grid","valueKind":"reading" أو "level","bm":{"rl":رقم أو null},"cols":["1","2"],"rows":[{"label":"A","v":[رقم أو null]}]}
القواعد: كل الأرقام بالمتر وبنقطة عشرية (لو القراءات بالسنتيمتر أو المليمتر حوّلها للمتر). الخانة الفاضية أو غير الواضحة = null. BS قراءة خلفية، IS قراءة وسطية، FS قراءة أمامية. صف نقطة التحويل ممكن يكون فيه FS و BS مع بعض. حافظ على ترتيب الصفوف. متكتبش أي كلام برة الـ JSON.`;

const SYSTEM = `أنت مساعد مساحة ومدني خبير بتساعد مهندسين وفنيين مساحة في مصر. بتجاوب على أي سؤال يخص المساحة: شرح مفاهيم، قوانين مع أمثلة، حسابات، أخطاء الميدان، وقراءة اللوحات والمخططات (صورة أو PDF أو نصوص DXF) لو اتبعتت.
- اشرح بلهجة مصرية بسيطة ومهنية، وابدأ بالإجابة المباشرة وبعدين التفاصيل.
- لما حد يسأل عن قانون، اكتبه بالعربي مع الاختصار الإنجليزي بين قوسين، وحل مثال بالأرقام خطوة بخطوة.
- لو في لوحة، لما حد يسأل عن رقم اذكر مكانه فيها. لو الرقم مش واضح أو مش موجود قول كده صراحة، ومتخمنش أرقام.
- لو السؤال بعيد تماماً عن المساحة والهندسة المدنية، اعتذر بلطف وقول إنك مساعد مساحة.
- اكتب نص عادي من غير رموز ماركداون (من غير نجوم أو هاشتاج)، واستخدم ترقيم بسيط للنقاط.
- في آخر أي نتيجة مساحية مهمة، فكّر المستخدم يراجع الأرقام على اللوحة الأصلية وفي الموقع قبل التنفيذ.`;

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'alrabielilmisahih';
let certCache = { at: 0, certs: {} };
async function getCerts() {
  if (Date.now() - certCache.at < 3600e3 && Object.keys(certCache.certs).length) return certCache.certs;
  const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  certCache = { at: Date.now(), certs: await r.json() };
  return certCache.certs;
}
async function verifyToken(tok) {
  const [h, p, s] = String(tok).split('.');
  if (!h || !p || !s) throw new Error('bad token');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString());
  const pay = JSON.parse(Buffer.from(p, 'base64url').toString());
  const cert = (await getCerts())[head.kid];
  if (!cert || head.alg !== 'RS256') throw new Error('bad key');
  const ok = crypto.createVerify('RSA-SHA256').update(h + '.' + p).verify(cert, Buffer.from(s, 'base64url'));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || pay.aud !== PROJECT || pay.iss !== 'https://securetoken.google.com/' + PROJECT || pay.exp < now || !pay.sub) throw new Error('bad claims');
  if (pay.firebase && pay.firebase.sign_in_provider === 'anonymous') throw new Error('anonymous');
  return pay;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return res.json({ ok: true, hasKey: !!process.env.GEMINI_API_KEY, model: (process.env.GEMINI_MODEL || '').trim() || 'gemini-2.5-flash-lite' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try { await verifyToken((req.headers.authorization || '').replace(/^Bearer /, '')); }
  catch (e) { return res.status(401).json({ error: 'login' }); }

  const { messages, file, mode } = req.body || {};
  const lv = mode === 'levels';
  if (!Array.isArray(messages) || !messages.length || messages[0].role !== 'user') {
    return res.status(400).json({ error: 'bad request' });
  }
  const isText = !!(file && file.mediaType === 'text/plain' && file.text);
  const hasFile = !!(file && (file.data || isText));
  const fileMime = file && file.mediaType === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
  const contents = messages.map((m, i) => {
    const parts = [{ text: String(m.content) }];
    if (i === 0 && hasFile) {
      if (isText) parts.unshift({ text: 'محتوى مستخرج من ملف DXF لوحة مساحية (عدد العناصر والنصوص والأبعاد):\n' + String(file.text).slice(0, 60000) });
      else parts.unshift({ inlineData: { mimeType: fileMime, data: file.data } });
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
  const key = process.env.GEMINI_API_KEY;
  const base = 'https://generativelanguage.googleapis.com/v1beta/models';
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: lv ? SYSTEM_LV : SYSTEM }] },
    contents,
    generationConfig: lv ? { maxOutputTokens: 8000, temperature: 0, responseMimeType: 'application/json' } : { maxOutputTokens: 1500 }
  });
  const errs = [];
  const gen = async (model, ms) => {
    const b = JSON.parse(body);
    if (/gemini-2\.5/.test(model)) b.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    let r, data;
    try {
      r = await fetch(base + '/' + model + ':generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(b),
        signal: AbortSignal.timeout(ms)
      });
      data = await r.json().catch(() => ({}));
    } catch (e) {
      r = { ok: false, status: 504 }; data = { error: { message: 'انتهت المهلة (' + Math.round(ms / 1000) + ' ث)' } };
    }
    if (!r.ok) errs.push(model + ' → ' + r.status + ': ' + String((data.error && data.error.message) || '').slice(0, 160));
    return { r, data };
  };
  try {
    if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY غير مضاف في فرسل' });
    const envModel = (process.env.GEMINI_MODEL || '').trim();
    const chain = [envModel, 'gemini-flash-lite-latest', 'gemini-flash-latest'].filter((m, i, arr) => m && arr.indexOf(m) === i);
    let out;
    const t0 = Date.now();
    for (const m of chain) {
      const left = 55000 - (Date.now() - t0);
      if (left < 6000) break;
      out = await gen(m, Math.min(30000, left));
      if (out.r.ok || out.r.status === 429) break;
    }
    if (!out) return res.status(504).json({ error: 'انتهى وقت الخادم قبل الرد' });
    const { r, data } = out;
    if (!r.ok) {
      const msg = errs.join(' | ');
      console.error('gemini error', msg);
      return res.status(r.status === 429 ? 429 : 502).json({ error: msg });
    }
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map(x => x.text || '').join('\n').trim();
    if (!text) return res.status(502).json({ error: 'رد فاضي من النموذج (ممكن الملف مرفوض لأسباب أمان)' });
    return res.json({ text });
  } catch (e) {
    console.error('server error', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
module.exports.config = { maxDuration: 60 };
