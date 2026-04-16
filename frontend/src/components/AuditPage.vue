<script setup>
import { ref } from 'vue'

const emit = defineEmits(['jump-to-knowledge'])
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const imageFile = ref(null)
const imagePreview = ref(null)
const description = ref('')
const loading = ref(false)
const result = ref(null)
const error = ref(null)
const dragging = ref(false)

function handleImageSelect(e) {
  const file = e.target.files[0]
  if (file) setImage(file)
}

function handleDrop(e) {
  e.preventDefault()
  dragging.value = false
  const file = e.dataTransfer.files[0]
  if (file && file.type.startsWith('image/')) setImage(file)
}

function setImage(file) {
  imageFile.value = file
  const reader = new FileReader()
  reader.onload = (e) => { imagePreview.value = e.target.result }
  reader.readAsDataURL(file)
}

function resetImage() {
  imageFile.value = null
  imagePreview.value = null
}

async function handleAnalyze() {
  if (!description.value.trim()) { error.value = '请填写产品描述'; return }
  loading.value = true
  result.value = null
  error.value = null
  try {
    const formData = new FormData()
    formData.append('description', description.value)
    if (imageFile.value) formData.append('image', imageFile.value)
    const res = await fetch(`${API_BASE}/api/analyze`, { method: 'POST', body: formData })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || '分析失败')
    result.value = data.data
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function riskStyle(level) {
  const map = {
    1: { color: '#2f7a54', bg: 'rgba(47,122,84,0.08)', border: 'rgba(47,122,84,0.3)' },
    2: { color: '#d18d23', bg: 'rgba(209,141,35,0.08)', border: 'rgba(209,141,35,0.3)' },
    3: { color: '#e07820', bg: 'rgba(224,120,32,0.08)', border: 'rgba(224,120,32,0.3)' },
    4: { color: '#c0392b', bg: 'rgba(192,57,43,0.08)', border: 'rgba(192,57,43,0.3)' },
    5: { color: '#8b0000', bg: 'rgba(139,0,0,0.1)',  border: 'rgba(139,0,0,0.4)' },
  }
  return map[level] || map[2]
}

function dimensionColor(r) {
  if (r === '有区别') return { bg: 'rgba(47,122,84,0.08)', color: '#2f7a54', dot: '#2f7a54' }
  if (r === '近似')   return { bg: 'rgba(209,141,35,0.08)', color: '#d18d23', dot: '#d18d23' }
  return { bg: 'rgba(192,57,43,0.08)', color: '#c0392b', dot: '#c0392b' }
}

function verdictStyle(v) {
  if (v === '通过')   return { border: '#2f7a54', bg: 'rgba(47,122,84,0.05)', color: '#2f7a54' }
  if (v === '不通过') return { border: '#c0392b', bg: 'rgba(192,57,43,0.05)', color: '#c0392b' }
  return { border: '#d18d23', bg: 'rgba(209,141,35,0.05)', color: '#d18d23' }
}

function elementTypeLabel(type) {
  const map = { '原创首创': '首创·90%', '原创独创': '独创·禁', '非原创': '非原创·50%', '注册商标': '商标·禁', '原创台词': '台词·禁' }
  return map[type] || type
}

function elementStatusStyle(s) {
  if (s === '通过')   return { bg: 'rgba(47,122,84,0.1)',  color: '#2f7a54' }
  if (s === '不通过') return { bg: 'rgba(192,57,43,0.1)', color: '#c0392b' }
  return { bg: 'rgba(209,141,35,0.1)', color: '#d18d23' }
}

function handleJumpToKnowledge(ipId) {
  emit('jump-to-knowledge', ipId)
}
</script>

<template>
  <div style="display:grid;grid-template-columns:380px 1fr;gap:16px;align-items:start;">

    <!-- 左列：输入 -->
    <div>
      <div class="card" style="padding:18px;">

        <!-- 图片上传 -->
        <div v-if="!imagePreview"
          class="upload-zone"
          :class="{ 'drag-over': dragging }"
          style="padding:22px 16px;margin-bottom:12px;"
          @click="$refs.imgInput.click()"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop="handleDrop"
        >
          <div style="font-size:13px;color:var(--muted);">
            <strong style="color:var(--accent);cursor:pointer;">点击上传</strong> 或拖拽产品图片
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;opacity:.6;">JPG / PNG / WebP · 10MB 以内</div>
        </div>

        <div v-else style="border-radius:10px;overflow:hidden;background:#eee;position:relative;margin-bottom:12px;">
          <img :src="imagePreview" style="width:100%;display:block;max-height:200px;object-fit:cover;" />
          <div style="position:absolute;bottom:0;left:0;right:0;padding:6px 10px;background:rgba(0,0,0,0.45);color:#fff;font-size:11px;">{{ imageFile?.name }}</div>
          <button @click="resetImage" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.4);color:#fff;border:none;cursor:pointer;border-radius:5px;padding:3px 8px;font-size:11px;">重新上传</button>
        </div>

        <input ref="imgInput" type="file" accept="image/*" style="display:none;" @change="handleImageSelect" />

        <label style="display:block;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:5px;">产品描述</label>
        <textarea
          v-model="description"
          placeholder="描述主题、元素、色彩、用途，越详细越准确"
          style="width:100%;border:1.5px solid var(--line);border-radius:8px;padding:8px 11px;font-size:12px;color:var(--ink);background:var(--panel-strong);font-family:inherit;resize:vertical;transition:border .2s;outline:none;min-height:90px;"
          @focus="$event.target.style.borderColor='var(--accent)'"
          @blur="$event.target.style.borderColor='var(--line)'"
        ></textarea>

        <div v-if="error" style="margin-top:8px;padding:8px 10px;border-radius:7px;background:var(--danger-soft);color:var(--danger);font-size:12px;">{{ error }}</div>

        <button
          @click="handleAnalyze"
          :disabled="loading"
          style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--accent),#9b59b6);color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(91,79,207,0.3);transition:all .2s;margin-top:12px;"
        >
          <span v-if="!loading">开始分析</span>
          <span v-else style="display:flex;align-items:center;gap:6px;">
            <span class="spinner" style="width:14px;height:14px;border-width:2px;"></span>分析中...
          </span>
        </button>
      </div>
    </div>

    <!-- 右列：结果 -->
    <div>
      <div v-if="!loading && !result" class="card" style="padding:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--muted);">
        <div style="font-size:13px;opacity:.6;">上传产品图并填写描述后点击开始分析</div>
      </div>

      <div v-if="loading" class="card" style="padding:50px;display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div class="spinner"></div>
        <div style="font-size:12px;color:var(--muted);">AI 分析中，请稍候…</div>
      </div>

      <div v-if="result && !loading">

        <!-- 低置信度提示 -->
        <div v-if="result.lowConfidence" style="padding:10px 12px;border-radius:8px;background:var(--warn-soft);border:1px solid rgba(209,141,35,0.3);margin-bottom:10px;font-size:12px;color:#7a5a00;">
          低置信度：{{ result.lowConfidenceNote }}
        </div>

        <!-- 卡片1：风险等级 + 总体结论（最重要） -->
        <div class="card" style="padding:20px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:12px;padding-left:10px;border-left:3px solid var(--accent);">风险评估</div>

          <div :style="{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderRadius:'12px',background:riskStyle(result.riskLevel.level).bg,border:`2px solid ${riskStyle(result.riskLevel.level).border}`,marginBottom:'12px'}">
            <div>
              <div :style="{fontSize:'36px',fontWeight:'900',color:riskStyle(result.riskLevel.level).color,lineHeight:'1.1'}">{{ result.riskLevel.label }}</div>
              <div style="font-size:14px;color:var(--muted);margin-top:4px;">Lv.{{ result.riskLevel.level }} / 5</div>
            </div>
            <div style="text-align:right;">
              <div :style="{fontSize:'52px',fontWeight:'900',color:riskStyle(result.riskLevel.level).color,lineHeight:'1'}">{{ result.riskLevel.differenceRate }}</div>
              <div style="font-size:13px;color:var(--muted);margin-top:4px;">区别率 · 投诉概率 {{ result.riskLevel.complaintRate }}</div>
            </div>
          </div>

          <!-- 进度条 -->
          <div style="height:6px;border-radius:3px;background:rgba(0,0,0,0.07);overflow:hidden;margin-bottom:10px;">
            <div :style="{height:'100%',borderRadius:'3px',transition:'width .6s',width:result.riskLevel.differenceRate,background:riskStyle(result.riskLevel.level).color}"></div>
          </div>

          <!-- 总体结论 -->
          <div :style="{borderRadius:'10px',padding:'14px 16px',border:`1.5px solid ${verdictStyle(result.verdict).border}`,background:verdictStyle(result.verdict).bg}">
            <div :style="{fontSize:'22px',fontWeight:'800',color:verdictStyle(result.verdict).color,marginBottom:'6px'}">总体结论：{{ result.verdict }}</div>
            <div style="font-size:13px;color:var(--muted);line-height:1.8;">{{ result.verdictReason }}</div>
          </div>

          <div style="margin-top:8px;font-size:10px;color:var(--muted);opacity:.6;line-height:1.5;">本结果为 AI 辅助建议，仅供参考。最终风险定级及审核结论须由安审人员人工确认。</div>
        </div>

        <!-- 卡片2：改款建议 -->
        <div v-if="result.suggestions && result.suggestions.length" class="card" style="padding:20px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:12px;padding-left:10px;border-left:3px solid var(--accent);">改款建议</div>
          <div v-for="(sug, i) in result.suggestions" :key="i"
            style="display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-radius:8px;background:rgba(91,79,207,0.05);margin-bottom:6px;border:1px solid rgba(91,79,207,0.1);"
          >
            <div style="width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">{{ i+1 }}</div>
            <div style="font-size:14px;color:var(--ink);line-height:1.7;">{{ sug }}</div>
          </div>
        </div>

        <!-- 卡片3：7维比对 + 元素规则 + 组合风险 -->
        <div class="card" style="padding:20px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:12px;padding-left:10px;border-left:3px solid var(--accent);">7 维区别比对</div>

          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">
            <div v-for="dim in result.comparison" :key="dim.index"
              :style="{display:'flex',alignItems:'flex-start',gap:'8px',padding:'9px 12px',borderRadius:'8px',background:dimensionColor(dim.result).bg,border:`1px solid ${dimensionColor(dim.result).dot}20`}"
            >
              <div :style="{width:'20px',height:'20px',borderRadius:'50%',flexShrink:'0',marginTop:'1px',border:`2px solid ${dimensionColor(dim.result).dot}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:dimensionColor(dim.result).color}">{{ dim.index }}</div>
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                  <span style="font-size:14px;font-weight:700;color:var(--ink);">{{ dim.dimension }}</span>
                  <span :style="{padding:'2px 7px',borderRadius:'20px',fontSize:'12px',fontWeight:'700',background:dimensionColor(dim.result).bg,color:dimensionColor(dim.result).color}">{{ dim.result }}</span>
                </div>
                <div style="font-size:12px;color:var(--muted);line-height:1.5;">{{ dim.detail }}</div>
              </div>
            </div>
          </div>

          <!-- 元素规则 -->
          <div v-if="result.elements && result.elements.length">
            <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">元素判断（{{ result.elements.length }} 个）</div>
            <div v-for="el in result.elements" :key="el.name"
              style="display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:7px;border:1px solid var(--line);background:var(--panel-strong);margin-bottom:5px;"
            >
              <div :style="{padding:'1px 7px',borderRadius:'20px',fontSize:'10px',fontWeight:'600',flexShrink:'0',marginTop:'2px',...elementStatusStyle(el.status)}">{{ el.status }}</div>
              <div>
                <div style="font-size:12px;font-weight:600;color:var(--ink);">
                  {{ el.name }}
                  <span style="margin-left:5px;padding:1px 6px;border-radius:20px;font-size:10px;background:rgba(91,79,207,0.1);color:var(--accent);">{{ elementTypeLabel(el.type) }}</span>
                </div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.4;">{{ el.reason }}</div>
              </div>
            </div>
          </div>

          <!-- 组合风险 -->
          <div v-if="result.combos && result.combos.some(c => c.triggered)">
            <div style="height:1px;background:var(--line);margin:10px 0;"></div>
            <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">组合风险</div>
            <div v-for="combo in result.combos.filter(c => c.triggered)" :key="combo.ruleType"
              style="padding:8px 10px;border-radius:7px;border-left:3px solid var(--danger);background:var(--danger-soft);margin-bottom:5px;"
            >
              <div style="font-size:11px;font-weight:700;color:var(--danger);margin-bottom:3px;">触发：{{ combo.ruleType }}</div>
              <div style="font-size:11px;color:var(--muted);">{{ combo.description }}</div>
            </div>
          </div>
        </div>

        <!-- 卡片4：IP识别（参考信息） -->
        <div class="card" style="padding:16px;">
          <div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:10px;padding-left:10px;border-left:3px solid var(--accent);">IP 识别</div>
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(91,79,207,0.05);border:1px solid rgba(91,79,207,0.15);border-radius:10px;margin-bottom:10px;">
            <div style="flex:1;">
              <div style="font-size:18px;font-weight:800;color:var(--ink);">{{ result.ip.name }}</div>
              <div style="font-size:13px;color:var(--muted);margin-top:2px;">{{ result.ip.owner }}</div>
            </div>
            <div :style="{padding:'3px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'600',background:result.ip.confidence==='高'?'var(--ok-soft)':'var(--warn-soft)',color:result.ip.confidence==='高'?'var(--ok)':'var(--warn)'}">{{ result.ip.confidence }}置信度</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span :style="{padding:'3px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',background:result.ip.hasDoc?'var(--ok-soft)':'var(--warn-soft)',color:result.ip.hasDoc?'var(--ok)':'var(--warn)'}">
              {{ result.ip.hasDoc ? '有 IP 文档' : '无文档·迁移分析' }}
            </span>
            <span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(91,79,207,0.1);color:var(--accent);">{{ result.productType }}</span>
            <span v-if="result.visualCenter" style="padding:3px 9px;border-radius:20px;font-size:11px;background:rgba(91,79,207,0.05);color:var(--muted);border:1px solid var(--line);">重心：{{ result.visualCenter }}</span>
            <a v-if="result.ip.hasDoc && result.ip.id"
              @click.prevent="handleJumpToKnowledge(result.ip.id)"
              style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;color:var(--accent);border:1px solid rgba(91,79,207,0.25);cursor:pointer;"
            >查看知识库规则</a>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
