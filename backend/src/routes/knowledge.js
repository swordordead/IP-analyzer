const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const mammoth = require('mammoth')
const { db } = require('../services/db')
const { parseDocument } = require('../services/gemini')

const router = express.Router()

// 文档上传仍用磁盘（mammoth 需要文件路径）
const docStorage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    cb(null, `doc_${Date.now()}_${file.originalname}`)
  }
})
const docUpload = multer({ storage: docStorage, limits: { fileSize: 100 * 1024 * 1024 } })

// 图片上传用内存（直接存 DB）
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// 临时存储：parse 到 save 之间暂存图片 buffer
const tempImageStore = new Map()
const TEMP_TTL = 30 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of tempImageStore) {
    if (now - val.createdAt > TEMP_TTL) tempImageStore.delete(key)
  }
}, 5 * 60 * 1000)

// 从 .docx 中提取图片，返回 buffer 数组（不写磁盘）
async function extractDocImages(docFilePath) {
  const imageBuffers = []
  let idx = 0

  const options = {
    convertImage: mammoth.images.imgElement(async (image) => {
      idx++
      try {
        const buf = await image.readAsBuffer()
        const mediaType = image.contentType || 'image/jpeg'
        imageBuffers.push({ buffer: buf, mediaType })
      } catch(e) {
        console.warn(`[DocImage] 第${idx}张图片提取失败:`, e.message)
      }
      return { src: '' }
    })
  }

  try {
    await mammoth.convertToHtml({ path: docFilePath }, options)
  } catch(e) {
    console.warn('[DocImage] convertToHtml 失败:', e.message)
  }

  const { value: text } = await mammoth.extractRawText({ path: docFilePath })
  return { text, images: imageBuffers }
}

// GET /api/knowledge/list
router.get('/list', async (req, res) => {
  try {
    const [profiles] = await db.query(
      `SELECT p.id, p.name, p.owner, p.icon, p.font_ref_image_path, p.created_at, p.updated_at,
        (p.font_ref_image_data IS NOT NULL) as hasFontImage,
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
  docUpload.single('file')(req, res, (err) => {
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
      images = result.images // buffer 数组
    } catch (e) {
      return res.status(400).json({ error: '文档读取失败，请确认文件是否为有效的 .docx 格式（不能是 .doc 或改后缀的文件）' })
    }

    if (!text || text.length < 50) {
      return res.status(400).json({ error: '文档内容无法读取或内容过少，请检查文档是否有实际文字内容' })
    }

    console.log(`[Parse] 文档字符数: ${text.length}，提取图片: ${images.length} 张，开始 AI 解析...`)
    const parsed = await parseDocument(text)

    // 图片 buffer 暂存内存，生成 token 给前端回传
    const tempToken = crypto.randomBytes(8).toString('hex')
    if (images.length > 0) {
      tempImageStore.set(tempToken, { images, createdAt: Date.now() })
    }
    parsed.tempToken = tempToken
    parsed.imageCount = images.length

    res.json({ success: true, data: parsed })

    // 清理临时文档文件
    try { fs.unlinkSync(req.file.path) } catch(e) {}
  } catch (err) {
    console.error('Parse error:', err)
    res.status(500).json({ error: err.message || '解析失败' })
  }
})

// POST /api/knowledge/save - 确认入库
router.post('/save', async (req, res) => {
  const conn = await db.getConnection()
  try {
    const { ipName, owner, icon, elements, combos, tempToken } = req.body
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

    // 从 tempImageStore 取出图片 buffer 写入数据库
    const stored = tempToken ? tempImageStore.get(tempToken) : null
    if (stored && stored.images.length > 0) {
      for (let i = 0; i < stored.images.length; i++) {
        const img = stored.images[i]
        await conn.query(
          'INSERT INTO ip_images (ip_id, image_data, media_type, sort_order) VALUES (?, ?, ?, ?)',
          [ipId, img.buffer, img.mediaType, i]
        )
      }
      console.log(`[Save] ${ipName} 保存了 ${stored.images.length} 张参考图到数据库`)
      tempImageStore.delete(tempToken)
    }

    await conn.commit()
    res.json({ success: true, ipId, message: `${ipName} 已成功入库` })
  } catch (err) {
    await conn.rollback()
    console.error('Save error:', err)
    res.status(500).json({ error: err.message || '入库失败' })
  } finally {
    conn.release()
  }
})

// GET /api/knowledge/image/:imageId - 从数据库返回图片二进制
router.get('/image/:imageId', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT image_data, media_type FROM ip_images WHERE id=?', [req.params.imageId])
    if (!rows.length || !rows[0].image_data) return res.status(404).json({ error: '图片不存在' })
    res.set('Content-Type', rows[0].media_type || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=86400')
    res.end(Buffer.isBuffer(rows[0].image_data) ? rows[0].image_data : Buffer.from(rows[0].image_data))
  } catch (err) {
    res.status(500).json({ error: err.message })
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
    // 不返回 BLOB 字段给前端
    delete profile.font_ref_image_data
    delete profile.embeddings
    const hasFontImage = !!(rows[0].font_ref_image_data)
    const [elements] = await db.query('SELECT * FROM ip_elements WHERE ip_id = ?', [profile.id])
    const [combos] = await db.query('SELECT * FROM ip_combos WHERE ip_id = ?', [profile.id])
    const [images] = await db.query(
      'SELECT id, sort_order FROM ip_images WHERE ip_id = ? AND image_data IS NOT NULL ORDER BY sort_order ASC',
      [profile.id]
    )
    res.json({ success: true, data: { ...profile, hasFontImage, elements, combos, images } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/knowledge/:id/font-image - 上传字体参考图（存入数据库）
router.post('/:id/font-image', memUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传图片' })
    await db.query(
      'UPDATE ip_profiles SET font_ref_image_data=?, font_ref_media_type=? WHERE id=?',
      [req.file.buffer, req.file.mimetype, req.params.id]
    )
    res.json({ success: true, message: '字体参考图已上传' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/knowledge/:id/font-image-data - 返回字体参考图二进制
router.get('/:id/font-image-data', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT font_ref_image_data, font_ref_media_type FROM ip_profiles WHERE id=?',
      [req.params.id]
    )
    if (!rows.length || !rows[0].font_ref_image_data) return res.status(404).json({ error: '无字体参考图' })
    res.set('Content-Type', rows[0].font_ref_media_type || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=86400')
    res.end(Buffer.isBuffer(rows[0].font_ref_image_data) ? rows[0].font_ref_image_data : Buffer.from(rows[0].font_ref_image_data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
