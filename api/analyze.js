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
  if (!file || !file.data || !Array.isArray(messages) || !messages.length || messages[0].role !== 'user') {
    return res.status(400).json({ error: 'bad request' });
  }
  const fileMime = file.mediaType === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
  const contents = messages.map((m, i) => {
    const parts = [{ text: String(m.content) }];
    if (i === 0) parts.unshift({ inlineData: { mimeType: fileMime, data: file.data } });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { maxOutputTokens: 2000 }
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: (data.error && data.error.message) || 'api error' });
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map(x => x.text || '').join('\n').trim();
    if (!text) return res.status(502).json({ error: 'empty' });
    return res.json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
};
module.exports.config = { maxDuration: 60 };
  
