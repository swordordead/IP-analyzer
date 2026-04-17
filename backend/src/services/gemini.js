const fs = require('fs')

const API_KEY = process.env.AI_API_KEY
const BASE_URL = process.env.AI_BASE_URL || 'https://api.tu-zi.com/v1'
const MODEL = process.env.AI_MODEL || 'gemini-3-flash-preview'

const SYSTEM_PROMPT = `你是一个专业的IP知识产权侵权分析助手，服务于跨境电商安全审核组。

你的任务是根据产品图片和描述，判断产品是否存在IP侵权风险。

【7点区别口诀】
①整体视觉：第一眼给人的整体近似度
②元素动作：元素肢体动作/方向上的近似度
③元素色彩：元素颜色/光线上的近似度
④元素图案：元素图案形状/排版上的近似度
⑤背景色彩：背景颜色/光线上的近似度
⑥背景图案：背景图案形状/排版上的近似度
⑦文字排版：字体的设计/线条/色彩/排版上的近似度

【5级风险标准】
1. 无风险：区别率90%+，0%被投诉概率
2. 中风险：区别率70%+，30%被投诉概率
3. 中高风险：区别率50%+，50%被投诉概率
4. 高风险：区别率30%，70%被投诉概率
5. 最高风险：区别率0-10%，100%被投诉概率

【关键判断基准】
- 视觉重心物体区别明显 → 区别率50%-90%之间
- 视觉重心物体区别不明显 → 区别率0%-30%

【元素类型说明】
- 原创首创：需90%区别度
- 原创独创：同类产品方向不可做
- 非原创：需50%区别度
- 注册商标：零容忍，完全不可用
- 原创台词/术语：不可使用

【产品类型判断】
- 图案型：改款方向是改图案（T恤、杯子、马克杯、托盘摆件等）
- 常规品：改款方向是改外部形状/款式（首饰、摆件造型等）

请用中文回答，输出纯JSON，不要加markdown代码块，不要输出其他内容。`

const OUTPUT_FORMAT = `
输出格式：
{
  "ip": {
    "name": "IP名称",
    "owner": "版权方",
    "confidence": "高|中|低",
    "hasDoc": true
  },
  "productType": "图案型|常规品",
  "visualCenter": "视觉重心物体描述",
  "comparison": [
    {"index": 1, "dimension": "整体视觉", "result": "有区别|近似|无区别", "detail": "具体说明"},
    {"index": 2, "dimension": "元素动作", "result": "有区别|近似|无区别", "detail": "具体说明"},
    {"index": 3, "dimension": "元素色彩", "result": "有区别|近似|无区别", "detail": "具体说明"},
    {"index": 4, "dimension": "元素图案", "result": "有区别|近似|无区别", "detail": "具体说明"},
    {"index": 5, "dimension": "背景色彩", "result": "有区别|近似|无区别", "detail": "具体说明"},
    {"index": 6, "dimension": "背景图案", "result": "有区别|近似|无区别", "detail": "具体说明"},
    {"index": 7, "dimension": "文字排版", "result": "有区别|近似|无区别", "detail": "具体说明"}
  ],
  "elements": [
    {
      "name": "元素名称",
      "type": "原创首创|原创独创|非原创|注册商标|原创台词",
      "status": "通过|不通过|需确认",
      "reason": "判断理由"
    }
  ],
  "combos": [
    {
      "ruleType": "外界指向性|设计理念|产品关联性|现实逻辑",
      "triggered": true,
      "description": "触发原因"
    }
  ],
  "riskLevel": {
    "level": 1,
    "label": "无风险|中风险|中高风险|高风险|最高风险",
    "differenceRate": "70%",
    "complaintRate": "30%",
    "reason": "定级理由"
  },
  "suggestions": ["改款建议1", "改款建议2"],
  "verdict": "通过|不通过|需复核",
  "verdictReason": "总体判断理由",
  "lowConfidence": false,
  "lowConfidenceNote": ""
}`

// 通用 chat 调用（支持图片）
async function chatCompletion(messages) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AI API 错误 ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices[0].message.content
}

// 从文本中提取 JSON
function extractJSON(text) {
  // 去除 markdown 代码块
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI返回格式异常，无法提取JSON')
  return JSON.parse(match[0])
}

// 构建带图片的消息内容（支持磁盘路径或 buffer）
function buildUserContent(text, imagePath, imageBuffer, imageMimeType) {
  // 优先用 buffer
  if (imageBuffer) {
    const base64 = Buffer.isBuffer(imageBuffer) ? imageBuffer.toString('base64') : Buffer.from(imageBuffer).toString('base64')
    return [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: `data:${imageMimeType || 'image/jpeg'};base64,${base64}` } }
    ]
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    return text
  }
  const imageData = fs.readFileSync(imagePath)
  const base64 = imageData.toString('base64')
  const ext = imagePath.split('.').pop().toLowerCase()
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
  ]
}

// 主分析函数
async function analyzeProduct({ imagePath, description, ipProfile }) {
  let knowledgeContext = ''
  let hasFontRef = false
  // refImages: [{ buffer, mediaType }] 从数据库读取的参考图
  const refImages = ipProfile ? (ipProfile.refImages || []).slice(0, 5) : []
  if (ipProfile) {
    hasFontRef = !!(ipProfile.fontRefImage && ipProfile.fontRefImage.buffer)
    knowledgeContext = `
【知识库信息 - ${ipProfile.name}】
版权方：${ipProfile.owner}
已录入元素规则：
${ipProfile.elements.map(e => `- ${e.element_name}（${e.element_type}）：${e.description || ''}`).join('\n')}
已录入组合风险：
${ipProfile.combos.map(c => `- ${c.rule_type}：${c.description || ''}`).join('\n')}
${hasFontRef ? '注意：该IP已上传原创字体参考图，第⑦维度请做图图比对，输出字体视觉相似度说明。' : ''}
${refImages.length > 0 ? `注意：已提供 ${refImages.length} 张IP参考图，请优先结合参考图做整体视觉近似度判断。` : ''}
`
  }

  const userText = `产品描述：${description}

${knowledgeContext}

请分析该产品是否存在IP侵权风险，严格按JSON格式输出。

${OUTPUT_FORMAT}`

  // 构建消息内容（产品图 + 可选字体参考图 + 可选IP参考图）
  let userContent
  const baseContent = buildUserContent(userText, imagePath)
  const baseParts = Array.isArray(baseContent)
    ? baseContent
    : [{ type: 'text', text: baseContent }]

  const extraParts = []
  if (hasFontRef) {
    const fontBuf = ipProfile.fontRefImage.buffer
    const fontBase64 = Buffer.isBuffer(fontBuf) ? fontBuf.toString('base64') : Buffer.from(fontBuf).toString('base64')
    const fontMime = ipProfile.fontRefImage.mediaType || 'image/jpeg'
    extraParts.push({ type: 'text', text: '以下是该IP的原创字体参考图，请用于第⑦维度文字排版的图图比对：' })
    extraParts.push({ type: 'image_url', image_url: { url: `data:${fontMime};base64,${fontBase64}` } })
  }
  if (refImages.length > 0) {
    extraParts.push({ type: 'text', text: `以下是该IP的 ${refImages.length} 张参考图，请结合做7维视觉比对：` })
    for (const img of refImages) {
      const base64 = Buffer.isBuffer(img.buffer) ? img.buffer.toString('base64') : Buffer.from(img.buffer).toString('base64')
      extraParts.push({ type: 'image_url', image_url: { url: `data:${img.mediaType || 'image/jpeg'};base64,${base64}` } })
    }
  }

  userContent = extraParts.length > 0 ? [...baseParts, ...extraParts] : baseContent

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ]

  const text = await chatCompletion(messages)
  const data = extractJSON(text)

  if (!ipProfile) {
    data.ip.hasDoc = false
    data.lowConfidence = true
    data.lowConfidenceNote = '该IP暂无安审分析文档，以下判断基于通用框架推断，准确性有限，建议人工重点复核。'
  }

  return data
}

// IP 识别（轻量请求）
async function identifyIP({ description, imagePath, ipNames }) {
  const userText = `根据以下产品描述，判断最可能涉及哪个IP。
产品描述：${description}
已知知识库IP列表：${ipNames.length > 0 ? ipNames.join('、') : '无'}
输出纯JSON，不加代码块：{"ipName": "名称或null", "inKnowledgeBase": true或false}`

  const messages = [
    { role: 'user', content: buildUserContent(userText, imagePath) }
  ]

  const text = await chatCompletion(messages)
  return extractJSON(text)
}

// 文档解析
async function parseDocument(text) {
  // 文档超长时分段处理
  const MAX_CHARS = 20000
  const truncated = text.length > MAX_CHARS
  const docText = text.slice(0, MAX_CHARS)

  const prompt = `你是IP知识产权分析专家，服务于跨境电商安全审核组。请从以下IP分析文档中提取所有结构化规则信息，务必完整提取，不能遗漏任何条目。

文档内容：
${docText}
${truncated ? '\n（文档已截取前20000字，如有遗漏请基于已有内容尽量补全）' : ''}

提取规则：
1. elements 包含所有需要审核的元素，涵盖以下所有类型：
   - 原创首创：该IP前无古人后有来者的形象/元素，需90%区别
   - 原创独创：该IP前无古人后无来者，完全不可做
   - 非原创：现实中本就存在的元素，需50%区别
   - 注册商标：已注册的图形/文字商标，零容忍
   - 原创台词：IP独有的台词/咒语/专有术语，不可使用
   注意：台词、字体、颜色、道具、场景都要提取，每一条都单独列出
2. combos 包含所有组合搭配禁用规则

输出纯JSON，不加代码块：
{
  "ipName": "IP名称（如哈利波特、海绵宝宝等）",
  "owner": "版权方/知识产权方",
  "icon": "一个最能代表该IP的emoji",
  "elements": [
    {"name": "元素名称", "type": "原创首创|原创独创|非原创|注册商标|原创台词", "description": "审核时需注意的要点，含区别度要求"}
  ],
  "combos": [
    {"ruleType": "外界指向性|设计理念|产品关联性|现实逻辑", "description": "组合风险的具体说明和触发条件"}
  ]
}`

  const messages = [{ role: 'user', content: prompt }]
  const responseText = await chatCompletion(messages)
  return extractJSON(responseText)
}

// 生成 embedding 向量
async function generateEmbedding(text) {
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({ model: 'text-embedding-004', input: text })
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embedding API 错误 ${res.status}: ${err}`)
  }
  const data = await res.json()
  return data.data[0].embedding
}

// 余弦相似度
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// 将 IP 信息拼成用于 embedding 的文本
function buildEmbeddingText(ipName, elements, combos) {
  const elText = (elements || []).map(e => `${e.name}（${e.type}）：${e.description || ''}`).join('；')
  const comboText = (combos || []).map(c => `${c.ruleType}：${c.description || ''}`).join('；')
  return `IP名称：${ipName}。元素规则：${elText}。组合风险：${comboText}`
}

module.exports = { analyzeProduct, identifyIP, parseDocument, generateEmbedding, cosineSimilarity, buildEmbeddingText }
