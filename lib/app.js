// --- API helpers ---
const SUPABASE_URL = 'https://zervceroblktwwacagui.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RIfI7qctop1zzcb5ENHizA_68AamSFy';
let accessToken = null;

async function api(path, options = {}) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Content-Type': 'application/json',
    ...(accessToken ? { 'Authorization': 'Bearer ' + accessToken } : {}),
    ...options.headers
  };
  const res = await fetch(SUPABASE_URL + path, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch(e) { data = text; }
  if (!res.ok) {
    const msg = (data && data.msg) || (data && data.message) || text || ('HTTP ' + res.status);
    return { error: { message: msg, status: res.status }, data: null };
  }
  return { error: null, data: data };
}

// --- State ---
let gender = 'male';
let frontLandmarks = null;
let sideLandmarks = null;
let frontImageData = null;
let sideImageData = null;
let currentUser = null;
let chartInstance = null;

// --- DOM refs ---
const $ = id => document.getElementById(id);
const authSection = $('authSection');
const appSection = $('appSection');
const frontPanel = $('frontPanel');
const sidePanel = $('sidePanel');
const frontImg = $('frontImg');
const sideImg = $('sideImg');
const frontCanvas = $('frontCanvas');
const sideCanvas = $('sideCanvas');
const btnAnalyze = $('btnAnalyze');
const resultsDiv = $('results');
const errorToast = $('errorToast');
const heightInput = $('height');
const historySection = $('historySection');

// --- Toast ---
let toastTimer;
function showToast(msg) {
  errorToast.textContent = msg;
  errorToast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { errorToast.style.display = 'none'; }, 3000);
}

// --- Auth ---
$('authLogin').addEventListener('click', function() { handleAuth('login'); });
$('authSignup').addEventListener('click', function() { handleAuth('signup'); });

async function handleAuth(mode) {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const errEl = $('authError');

  if (!email || !password) {
    errEl.textContent = '请填写邮箱和密码';
    errEl.style.display = 'block';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = '密码至少6位';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  const btn = mode === 'login' ? $('authLogin') : $('authSignup');
  btn.disabled = true;
  btn.textContent = '处理中...';

  let result;
  if (mode === 'signup') {
    result = await api('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: email, password: password }) });
  } else {
    result = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: email, password: password }) });
  }

  btn.disabled = false;
  btn.textContent = mode === 'login' ? '登录' : '注册';

  if (result.error) {
    if (mode === 'login' && result.error.status === 400) {
      errEl.textContent = '账号不存在或密码错误';
    } else {
      errEl.textContent = result.error.message;
    }
    errEl.style.display = 'block';
  } else if (mode === 'signup' && result.data && !result.data.session && result.data.user) {
    errEl.textContent = '注册成功！请点击"登录"按钮登录';
    errEl.style.color = 'var(--success)';
    errEl.style.display = 'block';
    $('authPassword').value = '';
  } else if (result.data && (result.data.access_token || result.data.session)) {
    accessToken = result.data.access_token || (result.data.session && result.data.session.access_token);
    if (result.data.user) {
      onLogin(result.data.user);
    } else {
      const userRes = await api('/auth/v1/user');
      if (userRes.data && !userRes.error) onLogin(userRes.data);
    }
  }
}

$('btnLogout').addEventListener('click', async function() {
  await api('/auth/v1/logout', { method: 'POST' });
  accessToken = null;
  onLogout();
});

async function checkSession() {
  // No persistent session storage for now
}

function onLogin(user) {
  currentUser = user;
  $('userEmail').textContent = user.email;
  authSection.style.display = 'none';
  appSection.style.display = 'block';
  loadHistory();
}

function onLogout() {
  currentUser = null;
  authSection.style.display = 'block';
  appSection.style.display = 'none';
  $('authEmail').value = '';
  $('authPassword').value = '';
}

// --- Gender toggle ---
$('genderToggle').addEventListener('click', function(e) {
  if (e.target.tagName !== 'BUTTON') return;
  gender = e.target.dataset.gender;
  $('genderToggle').querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
  e.target.classList.add('active');
  updateAnalyzeButton();
});

// --- Photo setup ---
function setupPhotoPanel(panel, img, canvas, uploadBtn, cameraBtn, retakeBtn, input, camInput, id) {
  panel.addEventListener('dragover', function(e) { e.preventDefault(); panel.style.borderColor = '#c4943a'; });
  panel.addEventListener('dragleave', function() { if (!img.src) panel.style.borderColor = ''; });
  panel.addEventListener('drop', function(e) {
    e.preventDefault();
    panel.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadPhoto(file, id);
  });
  uploadBtn.addEventListener('click', function(e) { e.stopPropagation(); input.click(); });
  cameraBtn.addEventListener('click', function(e) { e.stopPropagation(); camInput.click(); });
  input.addEventListener('change', function() { if (input.files[0]) loadPhoto(input.files[0], id); });
  camInput.addEventListener('change', function() { if (camInput.files[0]) loadPhoto(camInput.files[0], id); });
  panel.addEventListener('click', function() { if (!img.src) input.click(); });
  retakeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    img.style.display = 'none'; img.src = '';
    canvas.style.display = 'none'; retakeBtn.style.display = 'none';
    panel.classList.remove('has-photo');
    panel.querySelector('.placeholder').style.display = '';
    panel.querySelector('.upload-actions').style.display = '';
    if (id === 'front') { frontLandmarks = null; frontImageData = null; }
    else { sideLandmarks = null; sideImageData = null; }
    updateAnalyzeButton();
    resultsDiv.classList.remove('visible');
  });
}

function loadPhoto(file, id) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = id === 'front' ? frontImg : sideImg;
    const canvas = id === 'front' ? frontCanvas : sideCanvas;
    const panel = id === 'front' ? frontPanel : sidePanel;
    const retakeBtn = id === 'front' ? $('frontRetake') : $('sideRetake');
    img.onload = function() {
      img.style.display = 'block';
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.style.display = 'none';
      retakeBtn.style.display = 'block';
      panel.classList.add('has-photo');
      panel.querySelector('.placeholder').style.display = 'none';
      panel.querySelector('.upload-actions').style.display = 'none';
      if (id === 'front') { frontLandmarks = null; frontImageData = img; }
      else { sideLandmarks = null; sideImageData = img; }
      runPoseDetection(img, canvas, id);
      updateAnalyzeButton();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

setupPhotoPanel(frontPanel, frontImg, frontCanvas,
  $('frontUpload'), $('frontCamera'), $('frontRetake'),
  $('frontInput'), $('frontCamInput'), 'front');
setupPhotoPanel(sidePanel, sideImg, sideCanvas,
  $('sideUpload'), $('sideCamera'), $('sideRetake'),
  $('sideInput'), $('sideCamInput'), 'side');

// --- MediaPipe Pose ---
let poseInstance = null;
function initPose() {
  return new Promise(function(resolve) {
    poseInstance = new Pose({
      locateFile: function(file) { return 'lib/' + file; }
    });
    poseInstance.setOptions({
      modelComplexity: 2, smoothLandmarks: true, enableSegmentation: false,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    poseInstance.onResults(function(results) {
      if (results.poseLandmarks) window._poseResult = results;
    });
    poseInstance.initialize().then(function() { resolve(); });
  });
}

async function runPoseDetection(img, canvas, id) {
  if (!poseInstance) await initPose();
  const offscreen = new Image();
  offscreen.src = img.src;
  await new Promise(function(r) { offscreen.onload = r; });
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = offscreen.naturalWidth;
  tempCanvas.height = offscreen.naturalHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(offscreen, 0, 0);
  window._poseResult = null;
  await poseInstance.send({ image: tempCanvas });
  const result = window._poseResult;
  if (result && result.poseLandmarks) {
    if (id === 'front') frontLandmarks = result.poseLandmarks;
    else sideLandmarks = result.poseLandmarks;
    drawLandmarks(canvas, result.poseLandmarks, id);
  } else {
    showToast((id === 'front' ? '正面' : '侧面') + '照片未检测到人体，请换张照片试试');
  }
}

function drawLandmarks(canvas, landmarks, id) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const w = canvas.width, h = canvas.height;
  const pts = landmarks.map(function(l) { return { x: l.x * w, y: l.y * h }; });
  const chinY = (pts[9].y + pts[10].y) / 2;
  const shoulderMidY = (pts[11].y + pts[12].y) / 2;
  const hipMidY = (pts[23].y + pts[24].y) / 2;
  const neckY = chinY + (shoulderMidY - chinY) * 0.30;
  const waistY = shoulderMidY + (hipMidY - shoulderMidY) * 0.57;
  ctx.strokeStyle = 'rgba(196,148,58,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([8, 4]);
  [neckY, waistY, hipMidY].forEach(function(y) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  });
  ctx.setLineDash([]); ctx.fillStyle = '#c4943a'; ctx.font = '12px system-ui';
  ctx.fillText('颈', 8, neckY - 4);
  ctx.fillText('腰', 8, waistY - 4);
  ctx.fillText('臀', 8, hipMidY - 4);
  [0,7,8,11,12,23,24,25,26].forEach(function(i) {
    ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#c4943a'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  });
  canvas.style.display = 'block';
}

// --- Measurement helpers ---
function getWidthAtY(landmarks, yRatio, w, h) {
  const pts = landmarks.map(function(l) { return { x: l.x * w, y: l.y * h }; });
  const shoulderL = pts[11].x, shoulderR = pts[12].x;
  const hipL = pts[23].x, hipR = pts[24].x;
  return Math.abs((shoulderR + (hipR - shoulderR) * yRatio) - (shoulderL + (hipL - shoulderL) * yRatio));
}

function getDepthAtY(landmarks, yRatio, w, h) {
  const pts = landmarks.map(function(l) { return { x: l.x * w, y: l.y * h }; });
  const shoulderMidY = (pts[11].y + pts[12].y) / 2;
  const hipMidY = (pts[23].y + pts[24].y) / 2;
  const targetY = shoulderMidY + (hipMidY - shoulderMidY) * yRatio;
  const relevantPts = [11, 12, 23, 24, 0];
  let minX = Infinity, maxX = -Infinity;
  relevantPts.forEach(function(i) {
    if (Math.abs(pts[i].y - targetY) < h * 0.35) {
      minX = Math.min(minX, pts[i].x);
      maxX = Math.max(maxX, pts[i].x);
    }
  });
  if (minX === Infinity) return getWidthAtY(landmarks, yRatio, w, h) * 0.7;
  return maxX - minX;
}

function estimateCircumference(frontWidth, sideDepth) {
  if (frontWidth <= 0 || sideDepth <= 0) return 0;
  const a = frontWidth / 2, b = sideDepth / 2;
  return Math.PI * Math.sqrt((a * a + b * b) / 2) * 2;
}

function navyFormula(gender, heightCm, neckCm, waistCm, hipCm) {
  if (gender === 'male') {
    return 86.010 * Math.log10(waistCm - neckCm) - 70.041 * Math.log10(heightCm) + 36.76;
  } else {
    return 163.205 * Math.log10(waistCm + hipCm - neckCm) - 97.684 * Math.log10(heightCm) - 78.387;
  }
}

function getBFCategory(bf, g) {
  if (g === 'male') {
    if (bf < 6)  return ['excellent', '过低'];
    if (bf < 14) return ['excellent', '健美'];
    if (bf < 18) return ['good', '健康'];
    if (bf < 25) return ['fair', '正常'];
    if (bf < 30) return ['poor', '偏高'];
    return ['high', '过高'];
  } else {
    if (bf < 14) return ['excellent', '过低'];
    if (bf < 21) return ['excellent', '健美'];
    if (bf < 25) return ['good', '健康'];
    if (bf < 32) return ['fair', '正常'];
    if (bf < 38) return ['poor', '偏高'];
    return ['high', '过高'];
  }
}

// --- Analysis + Save ---
async function analyze() {
  const heightCm = parseFloat(heightInput.value);
  if (!heightCm || heightCm < 100 || heightCm > 250) {
    showToast('请输入有效身高 (100-250 cm)'); return;
  }
  if (!frontLandmarks || !sideLandmarks) {
    showToast('请确保两张照片都已上传并检测到人体'); return;
  }

  const fw = frontImageData.naturalWidth, fh = frontImageData.naturalHeight;
  const sw = sideImageData.naturalWidth, sh = sideImageData.naturalHeight;

  const frontYs = frontLandmarks.map(function(l) { return l.y * fh; });
  const frontPixelHeight = Math.max(...frontYs) - Math.min(...frontYs);
  const sideYs = sideLandmarks.map(function(l) { return l.y * sh; });
  const sidePixelHeight = Math.max(...sideYs) - Math.min(...sideYs);
  const DETECTION_COVERAGE = 0.94;
  const frontScale = (heightCm * DETECTION_COVERAGE) / frontPixelHeight;
  const sideScale = (heightCm * DETECTION_COVERAGE) / sidePixelHeight;

  const neckFrontW = getWidthAtY(frontLandmarks, 0.05, fw, fh);
  const neckSideD = getDepthAtY(sideLandmarks, 0.05, sw, sh);
  const waistFrontW = getWidthAtY(frontLandmarks, 0.57, fw, fh);
  const waistSideD = getDepthAtY(sideLandmarks, 0.57, sw, sh);
  const hipFrontW = getWidthAtY(frontLandmarks, 0.95, fw, fh);
  const hipSideD = getDepthAtY(sideLandmarks, 0.95, sw, sh);

  const neckCm = estimateCircumference(neckFrontW * frontScale, neckSideD * sideScale);
  const waistCm = estimateCircumference(waistFrontW * frontScale, waistSideD * sideScale);
  const hipCm = estimateCircumference(hipFrontW * frontScale, hipSideD * sideScale);

  if (neckCm < 20 || neckCm > 60 || waistCm < 40 || waistCm > 150) {
    showToast('测量结果异常，请确认照片姿势正确（正面+侧面，站直）'); return;
  }

  let bf = navyFormula(gender, heightCm, neckCm, waistCm, hipCm);
  bf = Math.max(2, Math.min(50, bf));
  const catResult = getBFCategory(bf, gender);
  const category = catResult[0], label = catResult[1];

  const weightKg = parseFloat($('weight').value) || null;
  const ageVal = parseInt($('age').value) || null;
  const fatMass = weightKg ? (weightKg * bf / 100).toFixed(1) : null;
  const leanMass = weightKg ? (weightKg - fatMass).toFixed(1) : null;
  const indicatorPct = Math.min(95, Math.max(5, (bf / 40) * 100));

  resultsDiv.innerHTML =
    '<div class="bf-big-number"><div class="bf-value ' + category + '">' + bf.toFixed(1) + '%</div><div class="bf-label">体脂率 · ' + label + '</div></div>' +
    '<div class="bf-scale"><div class="seg e"></div><div class="seg g"></div><div class="seg f"></div><div class="seg p"></div><div class="seg h"></div></div>' +
    '<div class="bf-indicator"><div class="arrow" style="left:' + indicatorPct + '%">▼</div></div>' +
    '<div class="measurements-grid">' +
    '<div class="meas-card"><div class="val">' + neckCm.toFixed(1) + '</div><div class="lbl">颈围 (cm)</div></div>' +
    '<div class="meas-card"><div class="val">' + waistCm.toFixed(1) + '</div><div class="lbl">腰围 (cm)</div></div>' +
    '<div class="meas-card"><div class="val">' + hipCm.toFixed(1) + '</div><div class="lbl">臀围 (cm)</div></div>' +
    (fatMass ?
      '<div class="meas-card"><div class="val">' + fatMass + ' kg</div><div class="lbl">脂肪重量</div></div>' +
      '<div class="meas-card"><div class="val">' + leanMass + ' kg</div><div class="lbl">去脂体重</div></div>' : '') +
    '<div class="meas-card"><div class="val">' + heightCm + ' cm</div><div class="lbl">身高</div></div></div>' +
    '<div class="disclaimer">⚠️ 本结果基于2D照片+US Navy公式估算，与DEXA等黄金标准存在±3-5%的误差范围。仅用于趋势追踪参考，不能替代专业体测。</div>';

  resultsDiv.classList.add('visible');
  resultsDiv.scrollIntoView({ behavior: 'smooth' });

  // Save to Supabase via fetch
  if (currentUser) {
    const row = {
      user_id: currentUser.id,
      height_cm: heightCm, weight_kg: weightKg, age: ageVal, gender: gender,
      neck_cm: neckCm, waist_cm: waistCm, hip_cm: hipCm,
      body_fat_pct: bf, category: category
    };
    const result = await api('/rest/v1/measurements', {
      method: 'POST',
      body: JSON.stringify(row),
      headers: { 'Prefer': 'return=representation' }
    });
    if (result.error) {
      console.error('Save error:', result.error);
      showToast('保存失败，请检查网络后重试');
    } else {
      showToast('已保存到云端 ✓');
      loadHistory();
    }
  }
}

$('btnAnalyze').addEventListener('click', analyze);

function updateAnalyzeButton() {
  const ready = !!(frontImageData && frontImageData.src && sideImageData && sideImageData.src &&
                   frontLandmarks && sideLandmarks && heightInput.value);
  btnAnalyze.disabled = !ready;
  btnAnalyze.textContent = ready ? '开始分析' :
    (!frontImageData || !frontImageData.src || !sideImageData || !sideImageData.src) ? '请先上传正面和侧面照片' :
    '正在检测人体姿态...';
}
heightInput.addEventListener('input', updateAnalyzeButton);
setInterval(updateAnalyzeButton, 1000);

// --- History ---
async function loadHistory() {
  if (!currentUser) return;

  const result = await api('/rest/v1/measurements?select=*&user_id=eq.' + currentUser.id + '&order=created_at.desc');

  if (result.error) { console.error('Load error:', result.error); return; }

  const data = result.data;
  if (!data || data.length === 0) {
    $('historyTableWrap').innerHTML = '<div class="no-history">暂无历史记录，完成一次测量后自动保存</div>';
    historySection.classList.add('visible');
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    return;
  }

  historySection.classList.add('visible');

  // Trend chart
  const chartData = data.slice().reverse();
  const labels = chartData.map(function(d) { return new Date(d.created_at).toLocaleDateString('zh-CN', { month:'short', day:'numeric' }); });
  const bfValues = chartData.map(function(d) { return d.body_fat_pct; });

  const ctx = $('trendChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '体脂率 %',
        data: bfValues,
        borderColor: '#c4943a',
        backgroundColor: 'rgba(196,148,58,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#c4943a',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: 'rgba(42,42,56,0.5)' } },
        y: {
          ticks: { color: '#888', font: { size: 11 }, callback: function(v) { return v + '%'; } },
          grid: { color: 'rgba(42,42,56,0.5)' },
          min: Math.max(0, Math.min.apply(null, bfValues) - 5),
          max: Math.min(50, Math.max.apply(null, bfValues) + 5),
        }
      }
    }
  });

  // Table
  var rows = '';
  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    rows += '<tr><td>' + new Date(d.created_at).toLocaleDateString('zh-CN') + '</td>' +
      '<td><strong>' + d.body_fat_pct + '%</strong></td>' +
      '<td>' + d.neck_cm + 'cm</td><td>' + d.waist_cm + 'cm</td><td>' + d.hip_cm + 'cm</td>' +
      '<td>' + d.category + '</td>' +
      '<td><button class="delete-btn" data-id="' + d.id + '" title="删除">✕</button></td></tr>';
  }
  $('historyTableWrap').innerHTML = '<table class="history-table"><thead><tr><th>日期</th><th>体脂率</th><th>颈围</th><th>腰围</th><th>臀围</th><th>分类</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';

  // Delete handlers
  $('historyTableWrap').querySelectorAll('.delete-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      const id = btn.dataset.id;
      await api('/rest/v1/measurements?id=eq.' + id + '&user_id=eq.' + currentUser.id, { method: 'DELETE' });
      loadHistory();
    });
  });
}

// --- Init ---
initPose();
checkSession();
