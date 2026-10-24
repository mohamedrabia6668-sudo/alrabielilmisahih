const SYSTEM = `أنت مهندس مساحة ومدني خبير بتساعد مهندسين وفنيين مساحة في مصر. هتوصلك لوحة أو مخطط (صورة أو PDF) وأسئلة عنها.
- اشرح اللوحة وعناصرها (مناسيب، أطوال، ميول، أقطار، قطاعات، إحداثيات، مقياس رسم) بلهجة مصرية بسيطة ومهنية.
- لما حد يسأل عن رقم، اذكر مكانه في اللوحة. لو الرقم مش واضح أو مش موجود قول كده صراحة، ومتخمنش أرقام.
- لما يكون سؤال حسابي، اكتب القانون بالعربي مع الاختصار الإنجليزي بين قوسين، وحل خطوة بخطوة بالأرقام من اللوحة.
- اكتب نص عادي من غير رموز ماركداون (من غير نجوم أو هاشتاج)، واستخدم ترقيم بسيط للنقاط.
- في آخر أي نتيجة مساحية مهمة، فكّر المستخدم يراجع الأرقام على اللوحة الأصلية قبل التنفيذ في الموقع.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const { messages, file, code } = req.body || {};
  if (process.env.APP_CODE && code !== process.env.APP_CODE) return res.status(401).json({ error: 'code' });
  const isText = !!(file && file.mediaType === 'text/plain' && file.text);
  if (!file || !(file.data || isText) || !Array.isArray(messages) || !messages.length || messages[0].role !== 'user') {
    return res.status(400).json({ error: 'bad request' });
  }
  const fileMime = file.mediaType === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
  const contents = messages.map((m, i) => {
    const parts = [{ text: String(m.content) }];
    if (i === 0) {
      if (isText) parts.unshift({ text: 'محتوى مستخرج من ملف DXF لوحة مساحية (عدد العناصر والنصوص والأبعاد):\n' + String(file.text).slice(0, 120000) });
      else parts.unshift({ inlineData: { mimeType: fileMime, data: file.data } });
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
  const key = process.env.GEMINI_API_KEY;
  const base = 'https://generativelanguage.googleapis.com/v1beta/models';
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: { maxOutputTokens: 2000 }
  });
  const gen = async (model) => {
    const r = await fetch(base + '/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body
    });
    return { r, data: await r.json().catch(() => ({})) };
  };
  try {
    if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY غير مضاف في فرسل' });
    let out = await gen(process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite');
    if (out.r.status === 404) {
      const lr = await fetch(base + '?pageSize=100', { headers: { 'x-goog-api-key': key } });
      const ld = await lr.json().catch(() => ({}));
      const pick = (ld.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /flash/.test(m.name) && !/(image|tts|live|audio|exp|preview)/.test(m.name))
        .map(m => m.name.replace('models/', ''));
      if (pick.length) out = await gen(pick[0]);
    }
    const { r, data } = out;
    if (!r.ok) {
      const msg = (data.error && data.error.message) || ('status ' + r.status);
      console.error('gemini error', r.status, msg);
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
