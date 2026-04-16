const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const mammoth = require('mammoth')
const { db } = require('../services/db')
const { parseDocument, generateEmbedding, buildEmbeddingText } = require('../services/gemini')

const router = express.Router()

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    cb(null, `doc_${Date.now()}_${file.originalname}`)
  }
})
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } })

// 从 .docx 中提取图片，保存到 uploads/ip_imgs/<hash>/，返回 URL 路径数组
async function extractDocImages(docFilePath) {
  const docHash = crypto.randomBytes(4).toString('hex')
  const imgDir = path.join(__dirname, '../../uploads/ip_imgs', docHash)
  fs.mkdirSync(imgDir, { recursive: true })

  const savedImages = []
  let idx = 0

  const options = {
    convertImage: mammoth.images.imgElement(async (image) => {
      idx++
      const ext = (image.contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const filename = `${idx}.${ext}`
      try {
        const buf = await image.readAsBuffer()
        fs.writeFileSync(path.join(imgDir, filename), buf)
        // 统一存相对 URL 路径，前端用 API_BASE + file_path 拼接
        savedImages.push(`/uploads/ip_imgs/${docHash}/${filename}`)
      } catch(e) {
        console.warn(`[DocImage] 第${idx}张图片提取失败:`, e.message)
      }
      return { src: '' } // mammoth 需要返回值，我们不用 HTML 输出
    })
  }

  try {
    await mammoth.convertToHtml({ path: docFilePath }, options)
  } catch(e) {
    console.warn('[DocImage] convertToHtml 失败:', e.message)
  }

  // 文本仍用 extractRawText（稳定，不依赖 HTML 解析）
  const { value: text } = await mammoth.extractRawText({ path: docFilePath })

  // 若图片目录为空（文档无图片），清理空目录
  if (savedImages.length === 0) {
    try { fs.rmdirSync(imgDir) } catch(e) {}
  }

  return { text, images: savedImages }
}

// GET /api/knowledge/list
router.get('/list', async (req, res) => {
  try {
    const [profiles] = await db.query(
      `SELECT p.*,
        COUNT(DISTINCT e.id) as element_count,
        COUNT(DISTINCT c.id) as combo_count,
        COUNT(DISTINCT img.id) as image_count
       FROM ip_profiles p
       LEFT JOIN ip_elements e ON e.ip_id = p.id
       LEFT JOIN ip_combos c ON c.ip_id = p.id
       LEFT JOIN ip_images img ON img.ip_id = p.id
       GROUP BY p.id ORDER BY p.updated_at DESC`
    )
    res.json({ success: true, data: profiles })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/knowledge/parse - 上传并解析 Word 文档（预览，不入库）
router.post('/parse', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件过大，最大支持 100MB' })
    }
    if (err) return res.status(400).json({ error: err.message })
    next()
  })
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' })

    let text, images
    try {
      const result = await extractDocImages(req.file.path)
      text = result.text
      images = result.images
    } catch (e) {
      return res.status(400).json({ error: '文档读取失败，请确认文件是否为有效的 .docx 格式（不能是 .doc 或改后缀的文件）' })
    }

    if (!text || text.length < 50) {
      return res.status(400).json({ error: '文档内容无法读取或内容过少，请检查文档是否有实际文字内容' })
    }

    console.log(`[Parse] 文档字符数: ${text.length}，提取图片: ${images.length} 张，开始 AI 解析...`)
    const parsed = await parseDocument(text)
    parsed.docPath = req.file.path
    parsed.tempImages = images // URL 路径数组，save 时传回

    res.json({ success: true, data: parsed })
  } catch (err) {
    console.error('Parse error:', err)
    res.status(500).json({ error: err.message || '解析失败' })
  }
})

// POST /api/knowledge/save - 确认入库
router.post('/save', async (req, res) => {
  const conn = await db.getConnection()
  try {
    const { ipName, owner, icon, elements, combos, tempImages } = req.body
    if (!ipName) return res.status(400).json({ error: '缺少IP名称' })

    await conn.beginTransaction()

    const [existing] = await conn.query(
      'SELECT id FROM ip_profiles WHERE name = ?', [ipName]
    )

    let ipId
    if (existing.length > 0) {
      ipId = existing[0].id
      await conn.query(
        'UPDATE ip_profiles SET owner=?, icon=?, updated_at=NOW() WHERE id=?',
        [owner || '', icon || '🎭', ipId]
      )
      await conn.query('DELETE FROM ip_elements WHERE ip_id=?', [ipId])
      await conn.query('DELETE FROM ip_combos WHERE ip_id=?', [ipId])
      await conn.query('DELETE FROM ip_images WHERE ip_id=?', [ipId])
    } else {
      const [insertResult] = await conn.query(
        'INSERT INTO ip_profiles (name, owner, icon) VALUES (?, ?, ?)',
        [ipName, owner || '', icon || '🎭']
      )
      ipId = insertResult.insertId
    }

    if (elements && elements.length > 0) {
      for (const el of elements) {
        await conn.query(
          'INSERT INTO ip_elements (ip_id, element_name, element_type, description) VALUES (?, ?, ?, ?)',
          [ipId, el.name, el.type, el.description || '']
        )
      }
    }

    if (combos && combos.length > 0) {
      for (const combo of combos) {
        await conn.query(
          'INSERT INTO ip_combos (ip_id, rule_type, description) VALUES (?, ?, ?)',
          [ipId, combo.ruleType, combo.description || '']
        )
      }
    }

    // 保存从文档提取的参考图
    if (tempImages && tempImages.length > 0) {
      for (let i = 0; i < tempImages.length; i++) {
        await conn.query(
          'INSERT INTO ip_images (ip_id, file_path, sort_order) VALUES (?, ?, ?)',
          [ipId, tempImages[i], i]
        )
      }
      console.log(`[Save] ${ipName} 保存了 ${tempImages.length} 张参考图`)
    }

    await conn.commit()
    res.json({ success: true, ipId, message: `${ipName} 已成功入库` })

    setImmediate(async () => {
      try {
        const text = buildEmbeddingText(ipName, elements, combos)
        const vec = await generateEmbedding(text)
        await db.query('UPDATE ip_profiles SET embeddings=? WHERE id=?', [JSON.stringify(vec), ipId])
        console.log(`[Embedding] ${ipName} 向量已更新`)
      } catch(e) {
        console.warn('[Embedding] 生成失败:', e.message)
      }
    })
  } catch (err) {
    await conn.rollback()
    console.error('Save error:', err)
    res.status(500).json({ error: err.message || '入库失败' })
  } finally {
    conn.release()
  }
})

// DELETE /api/knowledge/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM ip_profiles WHERE id=?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/knowledge/:id - 获取单个IP详情（含元素/组合/参考图）
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ip_profiles WHERE id=?', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'IP不存在' })
    const profile = rows[0]
    const [elements] = await db.query('SELECT * FROM ip_elements WHERE ip_id = ?', [profile.id])
    const [combos] = await db.query('SELECT * FROM ip_combos WHERE ip_id = ?', [profile.id])
    const [images] = await db.query(
      'SELECT file_path, sort_order FROM ip_images WHERE ip_id = ? ORDER BY sort_order ASC',
      [profile.id]
    )
    res.json({ success: true, data: { ...profile, elements, combos, images } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/knowledge/:id/font-image - 上传字体参考图
router.post('/:id/font-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传图片' })
    await db.query('UPDATE ip_profiles SET font_ref_image_path=? WHERE id=?', [req.file.path, req.params.id])
    res.json({ success: true, message: '字体参考图已上传' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
