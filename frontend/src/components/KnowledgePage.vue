<script setup>
import { ref, onMounted, watch } from 'vue'

const props = defineProps({ highlightIpId: { type: Number, default: null } })

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const ipList = ref([])
const loading = ref(false)
const parsing = ref(false)
const parsedData = ref(null)
const saving = ref(false)
const savedMsg = ref('')
const savedIpId = ref(null)
const fontUploading = ref(false)
const fontMsg = ref('')
const error = ref(null)
const dragging = ref(false)

// 详情 Modal
const detailIp = ref(null)
const detailLoading = ref(false)

// 卡片级字体图上传
const cardFontUploadingId = ref(null)
const cardFontMsgs = ref({})

onMounted(fetchList)

watch(() => props.highlightIpId, (id) => {
  if (!id) return
  setTimeout(() => {
    const el = document.getElementById(`ip-card-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.style.boxShadow = '0 0 0 3px rgba(91,79,207,0.5)'
      setTimeout(() => { el.style.boxShadow = '' }, 2000)
    }
  }, 300)
})

async function fetchList() {
  loading.value = true
  try {
    const res = await fetch(`${API_BASE}/api/knowledge/list`)
    const data = await res.json()
    if (data.success) ipList.value = data.data
  } catch(e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function handleFile(file) {
  if (!file) return
  if (!file.name.endsWith('.docx')) {
    error.value = '仅支持 .docx 格式'
    return
  }
  error.value = null
  parsedData.value = null
  savedMsg.value = ''
  parsing.value = true

  try {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API_BASE}/api/knowledge/parse`, { method: 'POST', body: formData })
    const data = await res.json()
    if (!data.success) throw new Error(data.error)
    parsedData.value = data.data
  } catch(e) {
    error.value = e.message || '解析失败'
  } finally {
    parsing.value = false
  }
}

function handleDrop(e) {
  e.preventDefault()
  dragging.value = false
  const file = e.dataTransfer.files[0]
  if (file) handleFile(file)
}

async function handleSave() {
  if (!parsedData.value) return
  saving.value = true
  try {
    const res = await fetch(`${API_BASE}/api/knowledge/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsedData.value)
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error)
    savedMsg.value = `✅ ${data.message}`
    savedIpId.value = data.ipId
    parsedData.value = null
    await fetchList()
  } catch(e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

async function handleDelete(ip) {
  if (!confirm(`确定删除「${ip.name}」？`)) return
  await fetch(`${API_BASE}/api/knowledge/${ip.id}`, { method: 'DELETE' })
  await fetchList()
}

// 新入库后的字体图上传（原有功能）
async function handleFontImage(file) {
  if (!file || !savedIpId.value) return
  fontUploading.value = true
  fontMsg.value = ''
  try {
    const formData = new FormData()
    formData.append('image', file)
    const res = await fetch(`${API_BASE}/api/knowledge/${savedIpId.value}/font-image`, { method: 'POST', body: formData })
    const data = await res.json()
    if (!data.success) throw new Error(data.error)
    fontMsg.value = '✅ 字体参考图已上传'
    await fetchList()
  } catch(e) {
    fontMsg.value = '❌ ' + (e.message || '上传失败')
  } finally {
    fontUploading.value = false
  }
}

// 卡片级字体图上传（已入库 IP 补传）
async function handleCardFontImage(ip, file) {
  if (!file) return
  cardFontUploadingId.value = ip.id
  cardFontMsgs.value[ip.id] = ''
  try {
    const formData = new FormData()
    formData.append('image', file)
    const res = await fetch(`${API_BASE}/api/knowledge/${ip.id}/font-image`, { method: 'POST', body: formData })
    const data = await res.json()
    if (!data.success) throw new Error(data.error)
    cardFontMsgs.value[ip.id] = '✅ 已上传'
    await fetchList()
    setTimeout(() => { cardFontMsgs.value[ip.id] = '' }, 2000)
  } catch(e) {
    cardFontMsgs.value[ip.id] = '❌ 失败'
    setTimeout(() => { cardFontMsgs.value[ip.id] = '' }, 2000)
  } finally {
    cardFontUploadingId.value = null
  }
}

const previewImage = ref(null)

// 查看 IP 详情
async function handleDetail(ip) {
  detailIp.value = { ...ip, elements: [], combos: [] }
  detailLoading.value = true
  try {
    const res = await fetch(`${API_BASE}/api/knowledge/${ip.id}`)
    const data = await res.json()
    if (data.success) detailIp.value = data.data
  } catch(e) {
    console.error(e)
  } finally {
    detailLoading.value = false
  }
}

function elementTypeColor(type) {
  if (type.includes('独创') || type.includes('台词')) return { bg: 'var(--danger-soft)', color: 'var(--danger)' }
  if (type.includes('商标')) return { bg: 'var(--danger-soft)', color: 'var(--danger)' }
  if (type.includes('首创')) return { bg: 'var(--accent-soft)', color: 'var(--accent)' }
  return { bg: 'rgba(100,100,100,0.08)', color: 'var(--muted)' }
}

function formatDate(dt) {
  return dt ? dt.split('T')[0] : ''
}
</script>

<template>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;">

    <!-- 左列：上传 + 解析预览 -->
    <div>
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;font-size:15px;font-weight:700;">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;"></span>
          上传 IP 分析文档
        </div>

        <div
          class="upload-zone"
          :class="{ 'drag-over': dragging }"
          style="padding:40px 20px;margin-bottom:16px;"
          @click="$refs.docInput.click()"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop="handleDrop"
        >
          <div style="font-size:36px;margin-bottom:10px;">📄</div>
          <div style="font-size:13px;color:var(--muted);">
            <strong style="color:var(--accent);cursor:pointer;">点击上传</strong>或拖拽 Word 文档
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:5px;opacity:.7;">仅支持 .docx · 上传后 AI 自动解析结构化规则</div>
        </div>
        <input ref="docInput" type="file" accept=".docx" style="display:none;" @change="e => handleFile(e.target.files[0])" />

        <div v-if="parsing" style="display:flex;align-items:center;gap:12px;padding:20px;color:var(--muted);font-size:13px;">
          <div class="spinner"></div>AI 正在解析文档…
        </div>

        <div v-if="error" style="padding:10px 12px;border-radius:9px;background:var(--danger-soft);color:var(--danger);font-size:12px;margin-bottom:12px;">
          {{ error }}
        </div>

        <div v-if="parsedData" style="background:var(--panel-strong);border:1.5px solid rgba(91,79,207,0.2);border-radius:14px;padding:18px;margin-bottom:14px;">
          <div style="font-size:14px;font-weight:700;margin-bottom:14px;color:var(--accent);">
            ✨ 解析预览 · {{ parsedData.ipName }}
          </div>

          <div style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">版权方</div>
            <div style="font-size:13px;color:var(--ink);">{{ parsedData.owner }}</div>
          </div>

          <div v-if="parsedData.elements && parsedData.elements.length > 0" style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">
              元素规则（共 {{ parsedData.elements.length }} 条）
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              <span v-for="el in parsedData.elements" :key="el.name"
                :style="{padding:'4px 10px',borderRadius:'20px',fontSize:'12px',border:'1px solid transparent',...elementTypeColor(el.type)}"
                :title="`${el.type}：${el.description}`"
              >{{ el.name }}</span>
            </div>
          </div>

          <div v-if="parsedData.combos && parsedData.combos.length > 0" style="margin-bottom:14px;">
            <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">
              组合风险（共 {{ parsedData.combos.length }} 条）
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              <span v-for="combo in parsedData.combos" :key="combo.description"
                style="padding:4px 10px;border-radius:20px;font-size:12px;background:var(--warn-soft);color:var(--warn);border:1px solid rgba(209,141,35,0.2);"
              >{{ combo.ruleType }}：{{ combo.description.slice(0,30) }}…</span>
            </div>
          </div>

          <div style="display:flex;gap:10px;">
            <button @click="handleSave" :disabled="saving"
              style="flex:1;padding:10px;border-radius:9px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;"
            >{{ saving ? '入库中…' : '✓ 确认无误，正式入库' }}</button>
            <button @click="parsedData = null"
              style="padding:10px 16px;border-radius:9px;border:1.5px solid var(--line);background:transparent;color:var(--muted);font-size:13px;cursor:pointer;"
            >取消</button>
          </div>
        </div>

        <div v-if="savedMsg">
          <div style="padding:12px;border-radius:9px;background:var(--ok-soft);color:var(--ok);font-size:13px;font-weight:600;text-align:center;margin-bottom:14px;">
            {{ savedMsg }}
          </div>
          <div style="border:1.5px dashed var(--line);border-radius:12px;padding:16px;">
            <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px;">可选：上传 IP 原创字体参考图</div>
            <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.5;opacity:.8;">
              如该 IP 有独特字体设计，上传参考图后，AI 审核时可做字体图图比对（更精准）
            </div>
            <label style="display:inline-block;padding:7px 16px;border-radius:8px;border:1.5px solid var(--line);background:var(--panel-strong);font-size:12px;color:var(--muted);cursor:pointer;">
              <span v-if="!fontUploading">📷 选择字体参考图</span>
              <span v-else>上传中…</span>
              <input type="file" accept="image/*" style="display:none;" :disabled="fontUploading" @change="e => handleFontImage(e.target.files[0])" />
            </label>
            <div v-if="fontMsg" :style="{ marginTop:'8px',fontSize:'12px',color: fontMsg.startsWith('✅') ? 'var(--ok)' : 'var(--danger)' }">
              {{ fontMsg }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右列：知识库列表 -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2 style="font-size:18px;font-weight:700;">已入库 IP</h2>
        <span style="font-size:12px;color:var(--muted);">共 {{ ipList.length }} 个 IP</span>
      </div>

      <div v-if="loading" style="display:flex;align-items:center;gap:12px;color:var(--muted);font-size:13px;">
        <div class="spinner"></div>加载中…
      </div>

      <div v-if="!loading && ipList.length === 0" style="text-align:center;color:var(--muted);padding:40px 0;font-size:13px;opacity:.7;">
        暂无数据，请上传 IP 分析文档
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;">
        <div v-for="ip in ipList" :key="ip.id"
          :id="`ip-card-${ip.id}`"
          style="background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:18px;position:relative;transition:box-shadow .3s;"
        >
          <div style="font-size:22px;margin-bottom:6px;">{{ ip.icon || '🎭' }}</div>
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;color:var(--ink);">{{ ip.name }}</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">{{ ip.owner }}</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">
            更新：{{ formatDate(ip.updated_at) }}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px;">
            <span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;background:var(--accent-soft);color:var(--accent);">
              {{ ip.element_count }} 条元素规则
            </span>
            <span v-if="ip.combo_count > 0" style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;background:var(--warn-soft);color:var(--warn);">
              {{ ip.combo_count }} 条组合规则
            </span>
            <span v-if="ip.font_ref_image_data || ip.hasFontImage" style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(47,122,84,0.1);color:#2f7a54;">
              有字体图
            </span>
            <span v-if="ip.image_count > 0" style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(14,115,200,0.1);color:#0e73c8;">
              {{ ip.image_count }} 张参考图
            </span>
          </div>

          <!-- 操作区 -->
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <button @click="handleDetail(ip)"
              style="padding:3px 10px;border-radius:6px;border:1px solid rgba(91,79,207,0.3);background:rgba(91,79,207,0.06);color:var(--accent);font-size:11px;cursor:pointer;"
            >查看详情</button>

            <label :style="{padding:'3px 10px',borderRadius:'6px',border:'1px solid var(--line)',background:'var(--panel-strong)',color:'var(--muted)',fontSize:'11px',cursor:'pointer',opacity: cardFontUploadingId === ip.id ? 0.6 : 1}">
              <span v-if="cardFontUploadingId === ip.id">上传中…</span>
              <span v-else>{{ (ip.font_ref_image_data || ip.hasFontImage) ? '更新字体图' : '上传字体图' }}</span>
              <input type="file" accept="image/*" style="display:none;" :disabled="cardFontUploadingId === ip.id" @change="e => handleCardFontImage(ip, e.target.files[0])" />
            </label>

            <span v-if="cardFontMsgs[ip.id]" :style="{fontSize:'10px',color: cardFontMsgs[ip.id].startsWith('✅') ? 'var(--ok)' : 'var(--danger)'}">
              {{ cardFontMsgs[ip.id] }}
            </span>

            <button @click="handleDelete(ip)"
              style="margin-left:auto;padding:3px 10px;border-radius:6px;border:1px solid var(--line);background:transparent;color:var(--muted);font-size:11px;cursor:pointer;"
            >删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 详情 Modal -->
  <teleport to="body">
    <div v-if="detailIp"
      @click.self="detailIp = null"
      style="position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:24px;"
    >
      <div style="background:var(--panel);border-radius:20px;width:100%;max-width:640px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <!-- Modal 头部 -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 22px 16px;border-bottom:1px solid var(--line);flex-shrink:0;">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--ink);">{{ detailIp.icon || '🎭' }} {{ detailIp.name }}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px;">{{ detailIp.owner }}</div>
          </div>
          <button @click="detailIp = null"
            style="width:28px;height:28px;border-radius:50%;border:none;background:var(--panel-strong);color:var(--muted);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;"
          >×</button>
        </div>

        <!-- Modal 内容 -->
        <div style="overflow-y:auto;padding:20px 22px;flex:1;">
          <div v-if="detailLoading" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:40px;color:var(--muted);">
            <div class="spinner"></div>加载中…
          </div>

          <div v-else>
            <!-- 参考图网格 -->
            <div v-if="detailIp.images && detailIp.images.length" style="margin-bottom:20px;">
              <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">
                参考图（{{ detailIp.images.length }} 张）
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;">
                <div v-for="(img, i) in detailIp.images" :key="i"
                  @click="previewImage = `${API_BASE}/api/knowledge/image/${img.id}`"
                  style="border-radius:8px;overflow:hidden;cursor:pointer;border:1px solid var(--line);aspect-ratio:1;"
                >
                  <img :src="`${API_BASE}/api/knowledge/image/${img.id}`" loading="lazy"
                    style="width:100%;height:100%;object-fit:cover;display:block;" />
                </div>
              </div>
            </div>

            <!-- 元素规则 -->
            <div v-if="detailIp.elements && detailIp.elements.length">
              <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">
                元素规则（{{ detailIp.elements.length }} 条）
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px;">
                <div v-for="el in detailIp.elements" :key="el.id"
                  style="padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel-strong);"
                >
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="font-size:13px;font-weight:600;color:var(--ink);">{{ el.element_name }}</span>
                    <span :style="{padding:'1px 8px',borderRadius:'20px',fontSize:'10px',fontWeight:'600',...elementTypeColor(el.element_type)}">{{ el.element_type }}</span>
                  </div>
                  <div v-if="el.description" style="font-size:11px;color:var(--muted);line-height:1.5;">{{ el.description }}</div>
                </div>
              </div>
            </div>

            <!-- 组合风险 -->
            <div v-if="detailIp.combos && detailIp.combos.length">
              <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">
                组合风险（{{ detailIp.combos.length }} 条）
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <div v-for="combo in detailIp.combos" :key="combo.id"
                  style="padding:10px 12px;border-radius:10px;border-left:3px solid var(--warn);background:var(--warn-soft);"
                >
                  <div style="font-size:11px;font-weight:700;color:var(--warn);margin-bottom:3px;">{{ combo.rule_type }}</div>
                  <div style="font-size:11px;color:var(--muted);line-height:1.5;">{{ combo.description }}</div>
                </div>
              </div>
            </div>

            <div v-if="!detailIp.elements?.length && !detailIp.combos?.length" style="text-align:center;padding:30px 0;color:var(--muted);font-size:13px;opacity:.6;">
              暂无规则数据
            </div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
  <!-- 全屏图片预览 -->
  <teleport to="body">
    <div v-if="previewImage"
      @click="previewImage = null"
      style="position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;"
    >
      <img :src="previewImage" style="max-width:90vw;max-height:90vh;border-radius:10px;object-fit:contain;" />
    </div>
  </teleport>
</template>
